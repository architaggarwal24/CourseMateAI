"""Courses, kept PDFs and page-linked citations (Phase 3 Stage 3B, docs/study-power.md section 5)."""
import pytest
from langchain_core.documents import Document

import state
from conftest import make_pdf_bytes
from rag.multi_index import MultiIndex
from services.context_service import retrieve
from test_api import upload

BIO = "11111111-aaaa-4aaa-8aaa-111111111111"
CHEM = "22222222-bbbb-4bbb-8bbb-222222222222"
BIO_PDF = make_pdf_bytes("Mitochondria produce ATP through cellular respiration in the cell. " * 30)
CHEM_PDF = make_pdf_bytes("Covalent bonds share electron pairs between atoms in a molecule. " * 30)


@pytest.fixture()
def two_docs(make_user):
    c, uid = make_user()
    assert upload(c, BIO, BIO_PDF, name="biology.pdf").status_code == 202
    assert upload(c, CHEM, CHEM_PDF, name="chemistry.pdf").status_code == 202
    return c, uid


@pytest.fixture()
def answers(monkeypatch):
    seen = {}

    def fake(q, ctx, hist):
        seen["context"] = ctx
        return "Mitochondria make ATP [1]."
    monkeypatch.setattr("routers.study.chat_with_context", fake)
    return seen


def _course(c, docs=(BIO, CHEM), name="Life sciences"):
    r = c.post("/courses", json={"name": name, "document_ids": list(docs)})
    assert r.status_code == 200, r.text
    return r.json()


# ═════════════════════════ kept PDFs ════════════════════════════════════════
def test_the_original_pdf_is_kept_and_served_only_to_its_owner(two_docs, make_user):
    c, _ = two_docs
    doc = c.get(f"/documents/{BIO}").json()
    assert doc["pdf_available"] is True and doc["pinned"] is False
    r = c.get(f"/documents/{BIO}/file")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content == BIO_PDF
    assert r.headers["content-disposition"].startswith("inline")
    other, _ = make_user()
    assert other.get(f"/documents/{BIO}/file").status_code == 404


def test_a_document_from_before_pdfs_were_kept_asks_for_a_reupload(two_docs):
    c, _ = two_docs
    h = c.get(f"/documents/{BIO}").json()["file_hash"]
    state.documents.pdf_path(h).unlink()
    r = c.get(f"/documents/{BIO}/file")
    assert r.status_code == 404 and r.json()["error"]["code"] == "pdf_unavailable" and r.json()["error"]["action"] == "reupload"
    assert c.get(f"/documents/{BIO}").json()["pdf_available"] is False
    upload(c, BIO, BIO_PDF, name="biology.pdf")                           # the same file again: no re-index, PDF back
    assert c.get(f"/documents/{BIO}/file").content == BIO_PDF


def test_the_kept_pdf_goes_with_the_last_document_that_has_it(two_docs):
    c, uid = two_docs
    h = c.get(f"/documents/{BIO}").json()["file_hash"]
    state.documents.delete_user_documents(uid)
    assert not state.documents.pdf_path(h).exists()


# ═════════════════════════ citations ════════════════════════════════════════
def test_retrieval_numbers_its_passages_with_document_and_page(two_docs):
    c, uid = two_docs
    import asyncio
    index = asyncio.run(state.documents.get_index(BIO, uid))
    found = retrieve(index, "How do mitochondria produce ATP?", 3)
    first = found.citations[0]
    assert (first["n"], first["doc_id"], first["doc_name"]) == (1, BIO, "biology.pdf")
    assert first["page"] in (1, 2) and first["label"] == f"biology.pdf · p.{first['page']}"
    assert "Mitochondria" in first["text"] and len(first["snippet"]) <= 221
    assert found.numbered_context().startswith(f"[1] (biology.pdf · p.{first['page']})\n")


def test_chat_answers_carry_their_citations(two_docs, answers):
    c, _ = two_docs
    r = c.post("/chat", json={"question": "How do mitochondria produce ATP?", "session_id": BIO, "history": []}).json()
    assert r["content"] == "Mitochondria make ATP [1]."
    assert r["citations"][0]["doc_id"] == BIO and r["citations"][0]["page"] >= 1
    assert answers["context"].startswith("[1] (biology.pdf · p.")                   # the model sees the numbers


# ═════════════════════════ courses ══════════════════════════════════════════
def test_create_list_rename_reorder_and_delete_a_course(two_docs):
    c, _ = two_docs
    course = _course(c)
    assert [d["filename"] for d in course["documents"]] == ["biology.pdf", "chemistry.pdf"] and course["ready"] == 2
    assert [x["id"] for x in c.get("/courses").json()["courses"]] == [course["id"]]
    r = c.put(f"/courses/{course['id']}", json={"name": "  Biochem  ", "document_ids": [CHEM, BIO]}).json()
    assert r["name"] == "Biochem" and [d["id"] for d in r["documents"]] == [CHEM, BIO]
    assert c.put(f"/courses/{course['id']}", json={"document_ids": [CHEM]}).json()["ready"] == 1
    assert c.get(f"/documents/{CHEM}").json()["pinned"] is True and c.get(f"/documents/{BIO}").json()["pinned"] is False
    assert c.delete(f"/courses/{course['id']}").json() == {"ok": True}
    assert c.get(f"/courses/{course['id']}").status_code == 404
    assert c.get(f"/documents/{CHEM}").status_code == 200                               # documents stay


def test_courses_are_checked_and_private(two_docs, make_user):
    c, _ = two_docs
    assert c.post("/courses", json={"name": "   "}).status_code == 400
    assert c.post("/courses", json={"name": "X", "document_ids": ["33333333-cccc-4ccc-8ccc-333333333333"]}).status_code == 404
    course = _course(c)
    other, _ = make_user()
    assert other.get(f"/courses/{course['id']}").status_code == 404
    assert other.post("/courses", json={"name": "Mine", "document_ids": [BIO]}).status_code == 404   # not their document
    assert other.post("/chat", json={"question": "atp?", "session_id": course["id"], "history": []}).status_code in (403, 404)


def test_a_course_id_works_wherever_a_document_id_does(two_docs, answers):
    c, uid = two_docs
    course = _course(c)
    doc = c.get(f"/documents/{course['id']}").json()
    assert doc["kind"] == "course" and doc["filename"] == "Life sciences" and doc["file_hash"] == f"course:{course['id']}"
    assert doc["status"] == "ready" and doc["documents"] == [BIO, CHEM]
    r = c.post("/chat", json={"question": "How do mitochondria produce ATP and covalent bonds share electrons?",
                              "session_id": course["id"], "history": []}).json()
    assert {x["doc_id"] for x in r["citations"]} == {BIO, CHEM}                          # retrieval across documents
    assert {x["doc_name"] for x in r["citations"]} == {"biology.pdf", "chemistry.pdf"}
    assert "biology.pdf" in answers["context"] and "chemistry.pdf" in answers["context"]


def test_studying_a_course_counts_for_the_course(two_docs, monkeypatch):
    c, uid = two_docs
    course = _course(c)
    questions = [{"id": 1, "question": "Q1?", "options": ["a", "b"], "correct_answer": "a", "explanation": "e", "concept": "ATP"}]

    async def fake_quiz(context, num_questions, question_type):
        return {"questions": [dict(q) for q in questions]}
    monkeypatch.setattr("routers.study.generate_quiz_async", fake_quiz)
    r = c.post("/quiz", json={"topic": "mitochondria produce ATP cellular respiration", "num_questions": 1, "question_type": "MCQ",
                              "session_id": course["id"]})
    assert r.status_code == 200, r.text
    qid = r.json()["quiz_id"]
    c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "b"})
    m = state.store.fetchall("SELECT doc_hash FROM concept_mastery WHERE user_id = ?", (uid,))
    assert [x["doc_hash"] for x in m] == [f"course:{course['id']}"]
    item = c.get("/review/queue").json()["items"][0]
    assert item["document"] == {"session_id": course["id"], "name": "Life sciences"}     # the card names the course
    p = c.get(f"/courses/{course['id']}/progress").json()
    assert p["concepts"]["seen"] == 1 and p["concepts"]["weakest"] == ["ATP"] and p["answers"]["accuracy"] == 0
    assert p["review"]["cards"] == 1 and [d["filename"] for d in p["documents"]] == ["biology.pdf", "chemistry.pdf"]


def test_the_review_of_a_course_includes_its_documents_cards(two_docs):
    c, uid = two_docs
    course = _course(c, docs=(BIO,))
    bio = c.get(f"/documents/{BIO}").json()["file_hash"]
    chem = c.get(f"/documents/{CHEM}").json()["file_hash"]
    for h, front in ((bio, "What makes ATP?"), (chem, "What is a covalent bond?"), (f"course:{course['id']}", "Course card?")):
        state.review_service.add_cards(uid, h, [{"front": front, "back": "x"}])
    fronts = {i["front"] for i in c.get(f"/review/queue?session_id={course['id']}").json()["items"]}
    assert fronts == {"What makes ATP?", "Course card?"}                                  # not the other document's
    assert {i["front"] for i in c.get(f"/review/queue?session_id={CHEM}").json()["items"]} == {"What is a covalent bond?"}


def test_an_empty_course_says_so(two_docs, answers):
    c, _ = two_docs
    course = _course(c, docs=())
    r = c.post("/chat", json={"question": "atp?", "session_id": course["id"], "history": []})
    assert r.status_code == 409 and r.json()["error"]["code"] == "course_empty"


def test_a_course_id_is_not_an_upload_target(two_docs):
    c, _ = two_docs
    course = _course(c)
    assert upload(c, course["id"], BIO_PDF).status_code == 400


def test_course_documents_never_expire_for_being_idle_and_go_last(two_docs):
    c, uid = two_docs
    _course(c, docs=(BIO,))
    state.store.execute("UPDATE documents SET last_used_at = '2000-01-01T00:00:00.000+00:00' WHERE user_id = ?", (uid,))
    state.documents.cleanup()
    ids = {d["id"] for d in state.documents.list_documents(uid)}
    assert ids == {BIO}                                                                  # the loose one expired
    assert [r["id"] for r in state.documents.repo.oldest_removable(5, user_id=uid)] == [BIO]


def test_courses_and_the_pdf_viewer_need_the_sage_plan(two_docs, monkeypatch, answers):
    c, _ = two_docs
    course = _course(c)
    monkeypatch.setenv("DEFAULT_TIER", "scholar")
    for r in (c.get("/courses"), c.get(f"/courses/{course['id']}/progress"), c.get(f"/documents/{BIO}/file"),
              c.post("/chat", json={"question": "atp?", "session_id": course["id"], "history": []})):
        assert r.status_code == 403 and r.json()["error"]["code"] == "feature_locked", r.text
    assert c.post("/chat", json={"question": "How do mitochondria make ATP?", "session_id": BIO, "history": []}).status_code == 200


# ═════════════════════════ merging indexes ══════════════════════════════════
class _Store:
    def __init__(self, hits):
        self.hits = hits

    def search_scored(self, query, k=5, **kw):
        return self.hits[:k]


def test_a_course_index_merges_documents_by_similarity_and_tags_each_hit():
    a = _Store([(Document(page_content="a1", metadata={"page": 0, "source": "x"}), 0.9),
                (Document(page_content="a2", metadata={"page": 3}), 0.4)])
    b = _Store([(Document(page_content="b1", metadata={"page": 1}), 0.7)])
    hits = MultiIndex([("A", "a.pdf", a), ("B", "b.pdf", b)]).search_scored("q", k=2)
    assert [(d.page_content, d.metadata["doc_id"], d.metadata["source"]) for d, _ in hits] == [("a1", "A", "a.pdf"), ("b1", "B", "b.pdf")]
    assert a.hits[0][0].metadata == {"page": 0, "source": "x"}                           # the member's own chunk is untouched


def test_every_relevant_document_gets_a_voice_even_against_near_duplicates():
    a = _Store([(Document(page_content=f"a{i}", metadata={"page": i}), 0.9 - i * 0.01) for i in range(5)])
    b = _Store([(Document(page_content="b0", metadata={"page": 0}), 0.8)])
    far = _Store([(Document(page_content="z0", metadata={"page": 0}), 0.2)])
    hits = MultiIndex([("A", "a.pdf", a), ("B", "b.pdf", b), ("Z", "z.pdf", far)]).search_scored("q", k=3)
    assert [d.page_content for d, _ in hits] == ["a0", "a1", "b0"]            # B is heard; the unrelated Z is not


def test_the_arena_fights_on_a_whole_course(two_docs, monkeypatch):
    from arena_v2_support import FakeLLM
    c, uid = two_docs
    course = _course(c)
    fake = FakeLLM()
    monkeypatch.setattr("routers.arena.generate_boss_persona_async", fake.boss)
    monkeypatch.setattr("core_brains.boss_brain.generate_battle_quiz_async", fake.quiz)
    r = c.post("/arena/battles", json={"session_id": course["id"], "topic": "mitochondria", "difficulty": "easy"})
    assert r.status_code == 200, r.text
    row = state.store.fetchone("SELECT doc_hash FROM arena_battles WHERE id = ?", (r.json()["battle_id"],))
    assert row["doc_hash"] == f"course:{course['id']}"
