"""Documents are durable (table = source of truth), uploads return at once, indexing runs in the background."""
import asyncio
import io
import json
import threading
import time
from pathlib import Path

import pytest
from langchain_core.documents import Document

import state
from conftest import make_pdf_bytes
from database.documents import DocumentRepository, utc_ago
from services import document_service
from services.document_service import INTERRUPTED, DocumentService
from test_api import SID1, SID2, fake_llm, upload  # noqa: F401  (fake_llm is a fixture)

SID3 = "33333333-3333-4333-8333-333333333333"
SID4 = "44444444-4444-4444-8444-444444444444"
CHAT = {"question": "What is mitosis?"}


def chat(client, sid):
    return client.post("/chat", json={**CHAT, "session_id": sid})


def status(client, sid):
    r = client.get(f"/documents/{sid}")
    assert r.status_code == 200, r.text
    return r.json()


def wait_for(client, sid, wanted, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if status(client, sid)["status"] in wanted:
            return status(client, sid)
        time.sleep(0.01)
    raise AssertionError(f"{sid} never reached {wanted}: {status(client, sid)}")


class Gate:
    """Replaces VectorStore so a test can hold the indexing step open and count concurrent builds."""

    def __init__(self, monkeypatch):
        self.release = threading.Event()
        self.lock = threading.Lock()
        self.running = self.peak = self.built = 0
        real = document_service.VectorStore
        gate = self

        class GatedVectorStore:
            load = staticmethod(real.load)

            def __init__(self, chunks):
                with gate.lock:
                    gate.running += 1
                    gate.peak = max(gate.peak, gate.running)
                gate.release.wait(10)
                self._real = real(chunks)
                with gate.lock:
                    gate.running -= 1
                    gate.built += 1

            def __getattr__(self, name):
                return getattr(self._real, name)

        monkeypatch.setattr(document_service, "VectorStore", GatedVectorStore)


# ═══════════════════════════ upload is non-blocking ═══════════════════════════
def test_upload_returns_at_once_while_indexing_continues_and_shows_stages(make_user, pdf_bytes, fake_llm, monkeypatch):
    gate = Gate(monkeypatch)
    c, _ = make_user()

    t0 = time.monotonic()
    r = upload(c, SID1, pdf_bytes, wait=False)
    assert r.status_code == 202 and time.monotonic() - t0 < 2          # answered while indexing hasn't even started
    body = r.json()
    assert body["session_id"] == SID1 and body["reused"] is False
    assert body["document"]["id"] == SID1 and body["document"]["filename"] == "notes.pdf"

    doc = wait_for(c, SID1, {"indexing"})                              # stage visible while the build is held open
    assert doc["chunks"] is None and doc["error"] is None
    # ...and the document can't be used yet, with a message the UI can show and an action to retry
    r = chat(c, SID1)
    err = r.json()["error"]
    assert r.status_code == 409 and (err["code"], err["action"]) == ("document_not_ready", "retry")
    assert err["details"] == {"status": "indexing"}

    gate.release.set()
    assert state.documents.wait_idle()
    doc = status(c, SID1)
    assert doc["status"] == "ready" and doc["chunks"] > 0 and doc["embedding_model"] == state.documents.embedding_model
    assert chat(c, SID1).status_code == 200


def test_stages_pass_through_queued_reading_indexing_ready(make_user, pdf_bytes, monkeypatch):
    seen = []
    real = state.documents.repo.transition

    def spy(doc_id, file_hash, expected, new):
        ok = real(doc_id, file_hash, expected, new)
        if ok:
            seen.append(new)
        return ok

    monkeypatch.setattr(state.documents.repo, "transition", spy)
    c, _ = make_user()
    assert upload(c, SID1, pdf_bytes).json()["document"]["status"] == "queued"
    assert seen == ["reading", "indexing"] and status(c, SID1)["status"] == "ready"


def test_indexing_concurrency_is_limited_and_the_rest_wait_queued(make_user, monkeypatch):
    gate = Gate(monkeypatch)
    limit = state.documents._pool._size
    assert limit == 2                                                  # INDEX_CONCURRENCY default
    c, _ = make_user()
    ids = [f"7000000{i}-7000-4000-8000-000000000000" for i in range(limit + 2)]
    for i, sid in enumerate(ids):
        assert upload(c, sid, make_pdf_bytes(f"document number {i} " * 40), wait=False).status_code == 202
    deadline = time.monotonic() + 5
    while gate.running < limit and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.2)                                                    # give a wrongly unlimited pool time to over-run
    states = sorted(status(c, sid)["status"] for sid in ids)
    assert states.count("indexing") == limit and states.count("queued") == 2
    assert gate.peak == limit
    gate.release.set()
    assert state.documents.wait_idle()
    assert {status(c, sid)["status"] for sid in ids} == {"ready"}


# ═══════════════════════════ durability ═══════════════════════════════════════
def test_upload_succeeds_and_keeps_its_files(make_user, pdf_bytes):
    c, uid = make_user()
    r = upload(c, SID1, pdf_bytes)
    assert r.status_code == 202, r.text
    row = state.documents.repo.get(SID1)
    assert (row["status"], row["user_id"], row["filename"]) == ("ready", uid, "notes.pdf")
    assert row["chunks"] > 0 and row["embedding_model"] and row["file_hash"]
    from config import UPLOAD_DIR
    assert (UPLOAD_DIR / row["index_path"]).is_dir()                   # the index survived
    assert not list((UPLOAD_DIR / "sources").glob("*"))                # source PDF removed after indexing
    assert state.vector_stores[SID1]["user_id"] == str(uid)            # and it is cached


def test_documents_stay_usable_after_a_restart(make_user, pdf_bytes, fake_llm):
    c, uid = make_user()
    upload(c, SID1, pdf_bytes)
    state.vector_stores.clear()                                        # a new process has an empty cache...
    state.documents.startup()                                          # ...and reconciles the table at boot
    assert status(c, SID1)["status"] == "ready"
    assert chat(c, SID1).status_code == 200                            # loaded lazily from disk on first use
    assert SID1 in state.vector_stores

    # Nothing lives only in this process: a brand-new service on the same database + folder works too.
    from config import settings
    fresh = DocumentService(
        DocumentRepository(state.db), {}, upload_dir=settings.upload_dir, embedding_model=settings.embedding_model,
        concurrency=1, max_per_user=10, max_documents=100, expiry_hours=24)
    assert asyncio.run(fresh.get_index(SID1, uid)) is not None


def test_a_job_interrupted_by_a_restart_is_resumed(make_user, pdf_bytes):
    c, uid = make_user()
    from database.documents import utc_now  # noqa: F401
    data = pdf_bytes
    h = __import__("hashlib").sha256(data).hexdigest()
    state.documents.repo.upsert_queued(SID1, uid, "half.pdf", h)
    state.documents.repo.transition(SID1, h, "queued", "reading")
    state.documents.repo.transition(SID1, h, "reading", "indexing")    # the old process died here
    state.documents.sources_dir.mkdir(parents=True, exist_ok=True)
    state.documents._source_path(SID1, h).write_bytes(data)
    assert state.documents.startup()["resumed"] == 1
    assert state.documents.wait_idle()
    assert status(c, SID1)["status"] == "ready"


def test_an_interrupted_job_whose_file_is_gone_is_marked_failed(make_user):
    c, uid = make_user()
    state.documents.repo.upsert_queued(SID1, uid, "lost.pdf", "f" * 64)
    assert state.documents.startup()["interrupted"] == 1
    doc = status(c, SID1)
    assert doc["status"] == "failed" and doc["error"] == INTERRUPTED


def _legacy_session(sid, owner):
    """Write a session the way the app did before the documents table existed."""
    from config import UPLOAD_DIR
    from rag.vectorstore import VectorStore
    VectorStore([Document(page_content="Mitosis is cell division.", metadata={"source": "old.pdf", "page": 1})]) \
        .save(str(UPLOAD_DIR / f"{sid}_index_1"))
    meta = {"filename": "old.pdf", "file_hash": "ab" * 32, "chunks": 1, "index_dir": f"{sid}_index_1",
            "created_at": "2026-01-02T03:04:05"}
    if owner is not None:
        meta["user_id"] = str(owner)
    (UPLOAD_DIR / f"{sid}_meta.json").write_text(json.dumps(meta))


def test_sessions_saved_before_the_table_existed_are_imported_once(make_user, fake_llm):
    c, uid = make_user()
    _legacy_session(SID1, uid)
    assert state.documents.startup()["imported"] == 1
    doc = status(c, SID1)
    assert (doc["status"], doc["filename"], doc["chunks"]) == ("ready", "old.pdf", 1)
    assert doc["created_at"].startswith("2026-01-0")                    # original creation time kept
    assert chat(c, SID1).status_code == 200
    assert state.documents.startup()["imported"] == 0                  # idempotent


def test_ownerless_sessions_are_not_imported(make_user):
    _legacy_session(SID1, None)
    assert state.documents.startup()["imported"] == 0
    assert state.documents.repo.get(SID1) is None


# ═══════════════════════════ embedding model ══════════════════════════════════
def test_documents_indexed_with_another_embedding_model_are_marked_needs_reindex(make_user, pdf_bytes, fake_llm, monkeypatch):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    old_model = status(c, SID1)["embedding_model"]

    monkeypatch.setattr(state.documents, "embedding_model", "BAAI/bge-small-en-v1.5")   # the setting was changed
    assert state.documents.startup()["needs_reindex"] == 1
    assert status(c, SID1)["status"] == "needs_reindex"
    err = chat(c, SID1).json()["error"]
    assert (err["code"], err["action"]) == ("document_needs_reindex", "reupload")

    # Uploading the same file again re-indexes it with the new model (no old index is reused).
    r = upload(c, SID1, pdf_bytes)
    assert r.status_code == 202 and r.json()["reused"] is False
    doc = status(c, SID1)
    assert doc["status"] == "ready" and doc["embedding_model"] == "BAAI/bge-small-en-v1.5" != old_model
    assert chat(c, SID1).status_code == 200


def test_a_stale_model_is_also_caught_without_a_restart(make_user, pdf_bytes, monkeypatch):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    monkeypatch.setattr(state.documents, "embedding_model", "other-model")
    r = chat(c, SID1)
    assert r.status_code == 409 and r.json()["error"]["code"] == "document_needs_reindex"
    assert status(c, SID1)["status"] == "needs_reindex"


# ═══════════════════════════ reuse by file hash ═══════════════════════════════
def test_same_file_by_the_same_user_reuses_the_existing_index(make_user, pdf_bytes, fake_llm, monkeypatch):
    gate = Gate(monkeypatch)
    gate.release.set()
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    assert gate.built == 1

    r = upload(c, SID2, pdf_bytes, name="same-content-other-name.pdf", wait=False)
    body = r.json()
    assert r.status_code == 202 and body["reused"] is True
    assert body["session_id"] == SID2 and body["document"]["status"] == "ready"     # instantly usable, own id
    assert body["document"]["filename"] == "same-content-other-name.pdf"
    assert gate.built == 1                                                         # nothing was embedded again
    one, two = state.documents.repo.get(SID1), state.documents.repo.get(SID2)
    assert one["index_path"] == two["index_path"] and one["file_hash"] == two["file_hash"]
    assert chat(c, SID1).status_code == 200 and chat(c, SID2).status_code == 200

    # The shared index outlives the first document and goes away with the last one.
    from config import UPLOAD_DIR
    state.documents._remove([state.documents.repo.get(SID1)])
    assert (UPLOAD_DIR / two["index_path"]).is_dir() and chat(c, SID2).status_code == 200
    state.documents._remove([state.documents.repo.get(SID2)])
    assert not (UPLOAD_DIR / two["index_path"]).exists()


def test_reuse_never_crosses_users(make_user, pdf_bytes, monkeypatch):
    gate = Gate(monkeypatch)
    gate.release.set()
    a, _ = make_user()
    b, _ = make_user()
    upload(a, SID1, pdf_bytes)
    r = upload(b, SID2, pdf_bytes)
    assert r.json()["reused"] is False and gate.built == 2
    assert state.documents.repo.get(SID1)["index_path"] != state.documents.repo.get(SID2)["index_path"]


def test_uploading_the_same_file_again_while_it_is_processing_does_not_start_a_second_build(make_user, pdf_bytes, monkeypatch):
    gate = Gate(monkeypatch)
    c, _ = make_user()
    upload(c, SID1, pdf_bytes, wait=False)
    wait_for(c, SID1, {"indexing"})
    r = upload(c, SID1, pdf_bytes, wait=False)
    assert r.json()["reused"] is True
    gate.release.set()
    assert state.documents.wait_idle() and gate.built == 1


def test_reupload_replaces_old_index_only(make_user, pdf_bytes):
    c, _ = make_user()
    assert upload(c, SID1, pdf_bytes).status_code == 202
    from config import UPLOAD_DIR
    first = {p.name for p in (UPLOAD_DIR / "indexes").glob("*")}
    assert upload(c, SID1, make_pdf_bytes("Photosynthesis makes sugar. " * 40)).status_code == 202
    second = {p.name for p in (UPLOAD_DIR / "indexes").glob("*")}
    assert len(second) == 1 and second != first                        # old index gone, exactly one new one
    assert Path(state.vector_stores[SID1]["store_path"]).is_dir()


# ═══════════════════════════ failures ═════════════════════════════════════════
def test_image_only_pdf_fails_with_a_helpful_message(make_user, fake_llm):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    cv = canvas.Canvas(buf)
    cv.showPage()
    cv.save()                                                          # blank page, no text layer
    c, _ = make_user()
    r = upload(c, SID1, buf.getvalue())
    assert r.status_code == 202                                        # accepted; the problem shows up in the status
    doc = status(c, SID1)
    assert doc["status"] == "failed" and "text" in doc["error"].lower()
    err = chat(c, SID1).json()["error"]
    assert (err["code"], err["action"]) == ("document_failed", "reupload") and "text" in err["message"].lower()


def test_unexpected_indexing_errors_are_hidden_and_retry_on_reupload(make_user, pdf_bytes, monkeypatch):
    real = document_service.VectorStore

    def boom(chunks):
        raise RuntimeError("secret /srv/app/internal path sk-LEAK")

    monkeypatch.setattr(document_service, "VectorStore", boom)
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    doc = status(c, SID1)
    assert doc["status"] == "failed" and "sk-LEAK" not in json.dumps(doc) and "/srv" not in json.dumps(doc)
    monkeypatch.setattr(document_service, "VectorStore", real)
    upload(c, SID1, pdf_bytes)                                         # same file again = try again
    assert status(c, SID1)["status"] == "ready"


# ═══════════════════════════ status + list endpoints ══════════════════════════
def test_list_and_status_only_show_my_documents(make_user, pdf_bytes):
    a, _ = make_user()
    b, _ = make_user()
    upload(a, SID1, pdf_bytes)
    upload(a, SID2, make_pdf_bytes("Osmosis moves water. " * 40), name="two.pdf")
    upload(b, SID3, pdf_bytes)
    mine = a.get("/documents").json()["documents"]
    assert {d["id"] for d in mine} == {SID1, SID2} and all("index_path" not in d and "user_id" not in d for d in mine)
    assert [d["id"] for d in b.get("/documents").json()["documents"]] == [SID3]
    r = b.get(f"/documents/{SID1}")                                    # not found rather than "forbidden": no probing
    assert r.status_code == 404 and r.json()["error"]["code"] == "document_not_found"
    assert a.get("/documents/never-uploaded-id").status_code == 404


def test_polling_status_does_not_keep_a_document_alive(make_user, pdf_bytes):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    old = utc_ago(days=3)
    state.db.execute("UPDATE documents SET last_used_at = ? WHERE id = ?", (old, SID1))
    status(c, SID1)
    c.get("/documents")
    assert state.documents.repo.get(SID1)["last_used_at"] == old


# ═══════════════════════════ validation, ownership ════════════════════════════
@pytest.mark.parametrize("bad", ["*", "../../tmp/x", "a b", "short", "x" * 80])
def test_upload_rejects_unsafe_session_ids(make_user, pdf_bytes, bad):
    c, _ = make_user()
    assert upload(c, bad, pdf_bytes).status_code == 400


def test_star_session_id_cannot_wipe_other_users_files(make_user, pdf_bytes):
    a, _ = make_user()
    b, _ = make_user()
    assert upload(a, SID1, pdf_bytes).status_code == 202
    from config import UPLOAD_DIR
    before = sorted(p.name for p in (UPLOAD_DIR / "indexes").glob("*"))
    assert upload(b, "*", pdf_bytes).status_code == 400
    assert sorted(p.name for p in (UPLOAD_DIR / "indexes").glob("*")) == before


def test_cannot_overwrite_someone_elses_session(make_user, pdf_bytes):
    a, uid_a = make_user()
    b, _ = make_user()
    assert upload(a, SID1, pdf_bytes).status_code == 202
    r = upload(b, SID1, make_pdf_bytes("evil replacement text " * 50))
    assert r.status_code == 403
    assert state.documents.repo.get(SID1)["user_id"] == uid_a
    assert state.vector_stores[SID1]["user_id"] == str(uid_a)


def test_upload_validation(make_user, pdf_bytes):
    c, _ = make_user()
    assert upload(c, SID1, pdf_bytes, name="NOTES.PDF").status_code == 202      # case-insensitive ext
    assert upload(c, SID2, b"%PDF-1.4 but garbage", name="x.txt").status_code == 400
    assert upload(c, SID2, b"", name="x.pdf").status_code == 400
    assert upload(c, SID2, b"not a pdf at all", name="x.pdf").status_code == 400
    assert state.documents.repo.get(SID2) is None                      # rejected uploads leave no row behind


# ═══════════════════════════ caps and expiry operate on the table ═════════════
def test_per_user_cap_does_not_evict_other_users(make_user, pdf_bytes, monkeypatch):
    monkeypatch.setattr(state.documents, "max_per_user", 2)
    a, uid_a = make_user()
    b, _ = make_user()
    assert upload(b, SID4, pdf_bytes).status_code == 202
    ids = [f"5555555{i}-5555-4555-8555-555555555555" for i in range(4)]
    for i, sid in enumerate(ids):
        assert upload(a, sid, make_pdf_bytes(f"content {i} " * 40)).status_code == 202
    assert state.documents.repo.get(SID4) is not None                  # user B untouched
    mine = [d["id"] for d in state.documents.repo.list_for_user(uid_a)]
    assert len(mine) == 2 and set(mine) == set(ids[-2:])               # least recently used went first
    from config import UPLOAD_DIR
    assert len(list((UPLOAD_DIR / "indexes").glob("*"))) == 3          # evicted documents' indexes are deleted


def test_global_cap_evicts_least_recently_used(make_user, pdf_bytes, monkeypatch):
    monkeypatch.setattr(state.documents, "max_documents", 2)
    c, _ = make_user()
    for i, sid in enumerate((SID1, SID2, SID3)):
        upload(c, sid, make_pdf_bytes(f"topic {i} " * 40))
    assert {d["id"] for d in c.get("/documents").json()["documents"]} == {SID2, SID3}


def test_idle_expiry_uses_last_use_not_upload_time(make_user, pdf_bytes, fake_llm):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    state.db.execute("UPDATE documents SET created_at = ? WHERE id = ?", (utc_ago(days=3), SID1))   # uploaded long ago...
    assert state.documents.cleanup()["total_removed"] == 0                                          # ...but used just now
    assert chat(c, SID1).status_code == 200

    state.db.execute("UPDATE documents SET last_used_at = ? WHERE id = ?", (utc_ago(days=3), SID1))
    assert state.documents.cleanup()["expired_documents"] == 1
    assert state.documents.repo.get(SID1) is None and SID1 not in state.vector_stores
    from config import UPLOAD_DIR
    assert not list((UPLOAD_DIR / "indexes").glob("*"))
    assert chat(c, SID1).json()["error"]["code"] == "session_expired"


def test_documents_still_being_processed_are_never_expired(make_user, pdf_bytes, monkeypatch):
    gate = Gate(monkeypatch)
    c, _ = make_user()
    upload(c, SID1, pdf_bytes, wait=False)
    wait_for(c, SID1, {"indexing"})
    state.db.execute("UPDATE documents SET last_used_at = ? WHERE id = ?", (utc_ago(days=30), SID1))
    assert state.documents.cleanup()["total_removed"] == 0
    gate.release.set()
    assert state.documents.wait_idle() and status(c, SID1)["status"] == "ready"


def test_deleting_a_document_while_it_indexes_discards_the_result(make_user, pdf_bytes, monkeypatch):
    gate = Gate(monkeypatch)
    c, _ = make_user()
    upload(c, SID1, pdf_bytes, wait=False)
    wait_for(c, SID1, {"indexing"})
    state.documents._remove([state.documents.repo.get(SID1)])          # e.g. evicted by a cap meanwhile
    gate.release.set()
    assert state.documents.wait_idle()
    from config import UPLOAD_DIR
    assert state.documents.repo.get(SID1) is None
    assert not list((UPLOAD_DIR / "indexes").glob("*")) and not list((UPLOAD_DIR / "sources").glob("*"))


def test_readiness_reports_ready_documents(make_user, pdf_bytes, monkeypatch):
    monkeypatch.setattr("routers.health.embedding_model_loaded", lambda: True)
    c, _ = make_user()
    before = c.get("/ready").json()["active_sessions"]
    upload(c, SID1, pdf_bytes)
    assert c.get("/ready").json()["active_sessions"] == before + 1
