"""End-to-end API tests for the bugs/exploits found in the audit."""
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from conftest import api_client, make_pdf_bytes
import state

SID1 = "11111111-1111-4111-8111-111111111111"
SID2 = "22222222-2222-4222-8222-222222222222"


def upload(client, sid, data, name="notes.pdf", wait=True):
    """POST /upload (answers 202 at once). By default also wait for the background indexing to finish,
    like a user who polls the document status until it says "ready"."""
    r = client.post("/upload", files={"file": (name, data, "application/pdf")}, data={"session_id": sid})
    if wait and r.status_code == 202:
        assert state.documents.wait_idle(), "indexing did not finish"
    return r


# ═════════════════════════════ CHAT / HISTORY ════════════════════════════════
@pytest.fixture()
def fake_llm(app_module, monkeypatch):
    calls = {}
    monkeypatch.setattr("routers.study.chat_with_context",
                        lambda q, ctx, hist: calls.update(history=hist) or "stub answer")
    return calls


def test_chat_works_and_returns_clean_sources(make_user, pdf_bytes, fake_llm):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1, "history": []})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content"] == "stub answer"
    assert body["sources"] and all("/" not in s and "\\" not in s for s in body["sources"])


def test_chat_survives_malformed_history_and_trims_it(make_user, pdf_bytes, fake_llm):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    hist = ["not a dict", 5, None, {"role": "system", "content": "evil"}, {"role": "user"},
            {"role": "user", "content": "x" * 10_000}, {"role": "assistant", "content": "ok"}]
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1, "history": hist})
    assert r.status_code == 200, r.text
    sent = fake_llm["history"]
    assert [t["role"] for t in sent] == ["user", "assistant"]
    assert len(sent[0]["content"]) == 4000


def test_chat_error_does_not_leak_internals(make_user, app_module, pdf_bytes, monkeypatch):
    monkeypatch.setattr("routers.study.chat_with_context",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("secret /srv/app/path sk-LEAK")))
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    assert r.status_code == 500
    assert "sk-LEAK" not in r.text and "/srv/app" not in r.text


def test_bad_provider_key_is_400_not_401(make_user, app_module, pdf_bytes, monkeypatch):
    """401 would make the frontend log the user out."""
    from core_brains.llm_connection import InvalidApiKeyError

    def boom(*a):
        raise InvalidApiKeyError("gemini")
    monkeypatch.setattr("routers.study.chat_with_context", boom)
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    assert r.status_code == 400 and "API key" in r.json()["error"]["message"]
    assert (r.json()["error"]["code"], r.json()["error"]["action"]) == ("provider_key_rejected", "settings")


def test_cannot_chat_in_or_read_history_of_another_users_session(make_user, app_module, pdf_bytes, fake_llm):
    a, _ = make_user()
    b, _ = make_user()
    upload(a, SID1, pdf_bytes)
    a.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    assert b.post("/chat", json={"question": "What is mitosis?", "session_id": SID1}).status_code == 403
    assert b.get(f"/history/session/{SID1}").status_code == 403
    # Dropping the in-memory cache must NOT weaken ownership: the documents table still says it's A's.
    state.vector_stores.pop(SID1, None)
    assert b.get(f"/history/session/{SID1}").status_code == 403
    # After the document has really expired, the history stays private (it is filtered by user_id in SQL).
    state.documents._remove([state.documents.repo.get(SID1)])
    r = b.get(f"/history/session/{SID1}")
    assert r.status_code == 200 and r.json()["history"] == []
    assert len(a.get(f"/history/session/{SID1}").json()["history"]) >= 1


def test_chat_does_not_block_the_event_loop(make_user, app_module, pdf_bytes, monkeypatch):
    """A slow LLM call must not stop other requests being served."""
    import time
    started = threading.Event()

    def slow(q, ctx, hist):
        started.set(); time.sleep(1.5); return "slow"
    monkeypatch.setattr("routers.study.chat_with_context", slow)
    # NOTE: both requests must go through the SAME TestClient. Each TestClient owns its
    # own event loop, so using two clients could never reveal a blocked loop.
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)

    with ThreadPoolExecutor(2) as ex:
        f = ex.submit(lambda: c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1}))
        assert started.wait(5)
        t0 = time.time()
        assert c.get("/health").status_code == 200
        elapsed = time.time() - t0
        assert f.result().status_code == 200
    assert elapsed < 1.0, f"health check waited {elapsed:.2f}s behind the LLM call"


def test_quiz_and_notes_bad_top_k_is_400(make_user, pdf_bytes):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    q = {"topic": "mitosis", "num_questions": 3, "question_type": "MCQ", "session_id": SID1}
    assert c.post("/quiz", json={**q, "top_k": 0}).status_code == 400
    assert c.post("/notes", json={"topic": "mitosis", "detail_level": "Simple", "session_id": SID1, "top_k": 99}).status_code == 400
    assert c.post("/quiz", json={**q, "topic": "   "}).status_code == 400


def test_flashcard_count_is_bounded(make_user, app_module, pdf_bytes, monkeypatch):
    seen = {}
    monkeypatch.setattr("routers.study.generate_flashcards",
                        lambda ctx, topic, num_cards=10: seen.update(n=num_cards) or {"cards": [], "total": 0, "topic": topic})
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    r = c.post("/flashcards", json={"topic": "mitosis", "session_id": SID1, "num_cards": 100000})
    assert r.status_code == 200, r.text
    assert seen["n"] == 30


# ═════════════════════════════ AUTH ══════════════════════════════════════════
def test_deleted_account_token_stops_working(make_user, app_module):
    from fastapi.testclient import TestClient
    c, uid = make_user()
    token = c.cookies.get("session_token")
    assert c.get("/auth/me").status_code == 200
    assert c.delete("/auth/delete-account").json()["success"]
    ghost = api_client(app_module.app, cookies={"session_token": token})
    assert ghost.get("/auth/me").status_code == 401
    assert ghost.get("/profile").json()["guest_mode"] is True          # not a resurrected user
    row = state.store.fetchone("SELECT 1 AS x FROM user_progress WHERE user_id = ?", (str(uid),))
    assert row is None                                                  # no ghost progress rows


def test_delete_account_removes_everything(make_user, app_module, pdf_bytes, fake_llm):
    c, uid = make_user()
    upload(c, SID1, pdf_bytes)
    c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    from config import UPLOAD_DIR
    assert any((UPLOAD_DIR / "indexes").glob("*"))
    assert c.delete("/auth/delete-account").status_code == 200

    assert state.db.query("SELECT 1 FROM activity_log WHERE user_id = ?", [uid]) == []
    assert state.db.query("SELECT 1 FROM users WHERE id = ?", [uid]) == []
    assert SID1 not in state.vector_stores
    assert state.db.query("SELECT 1 FROM documents WHERE id = ?", [SID1]) == []
    assert not list((UPLOAD_DIR / "indexes").glob("*")) and not list((UPLOAD_DIR / "sources").glob("*"))
    for table in ("arena_battles", "arena_scores", "arena_personal_bests"):
        assert state.store.fetchall(f"SELECT 1 FROM {table} WHERE user_id = ?", (uid,)) == []


def test_email_change_is_normalised_so_login_still_works(make_user):
    c, _ = make_user("emailtest")
    assert c.post("/auth/update-profile", json={"email": "New.Address@Example.COM"}).status_code == 200
    assert c.get("/auth/me").json()["email"] == "new.address@example.com"       # fresh from DB, not stale JWT
    from fastapi.testclient import TestClient
    import main
    r = api_client(main.app).post("/auth/login", json={"email": "New.Address@Example.com", "password": "correct-horse-1"})
    assert r.status_code == 200


@pytest.mark.parametrize("payload", [
    {"email": "not-an-email"}, {"username": "a b"}, {"username": "<script>"},
    {"username": "x" * 50}, {"full_name": "n" * 500},
])
def test_profile_updates_are_validated(make_user, payload):
    c, _ = make_user()
    assert c.post("/auth/update-profile", json=payload).status_code == 400


def test_usernames_are_case_insensitively_unique(make_user, app_module, monkeypatch):
    make_user("Alice")
    from fastapi.testclient import TestClient
    r = api_client(app_module.app).post("/auth/register", json={
        "email": "other@example.com", "password": "correct-horse-1", "username": "alice",
        "full_name": "Imposter", "api_key": "sk-test-zzzzzzzz", "llm_provider": "gemini"})
    assert r.status_code == 400


def test_overlong_passwords_are_a_400_not_a_500(make_user, app_module):
    from fastapi.testclient import TestClient
    cl = api_client(app_module.app)
    long_pw = "p" * 100
    r = cl.post("/auth/register", json={"email": "longpw@example.com", "password": long_pw, "username": "longpw",
                                        "full_name": "L", "api_key": "sk-test-long-aaaaaaaa", "llm_provider": "gemini"})
    assert r.status_code == 400
    assert cl.post("/auth/login", json={"email": "longpw@example.com", "password": long_pw}).status_code == 401


def test_register_rejects_bad_form_before_paying_for_a_key_check(app_module, monkeypatch):
    from fastapi.testclient import TestClient
    called = []
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: called.append(1) or (True, ""))
    r = api_client(app_module.app).post("/auth/register", json={
        "email": "nope", "password": "short", "username": "ab", "full_name": "",
        "api_key": "sk-x", "llm_provider": "gemini"})
    assert r.status_code == 400 and not called


def test_rate_limit_response_matches_what_the_frontend_expects(app_module):
    from fastapi.testclient import TestClient
    state.limiter.reset()
    cl = api_client(app_module.app)
    last = None
    for _ in range(7):
        last = cl.post("/auth/login", json={"email": "nobody@example.com", "password": "whatever1"})
    assert last.status_code == 429
    err = last.json()["error"]                                        # frontend reads error.code / error.message
    assert (err["code"], err["action"]) == ("rate_limited", "retry") and err["message"]
    assert err["details"] == {"retry_after_seconds": 60}
    assert last.headers["Retry-After"] == "60"


# ═════════════════════════════ ENCRYPTION KEY ════════════════════════════════
def test_encryption_key_is_mandatory(monkeypatch):
    import key_service
    monkeypatch.setattr(key_service, "_fernet_instance", None)
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
        key_service.encrypt_key("sk-abc")


def test_legacy_fallback_requires_explicit_opt_in(monkeypatch):
    import key_service
    monkeypatch.setattr(key_service, "_fernet_instance", None)
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("ALLOW_INSECURE_DEV_KEY", "true")
    assert key_service.decrypt_key(key_service.encrypt_key("sk-abc")) == "sk-abc"
    monkeypatch.setattr(key_service, "_fernet_instance", None)


def test_encrypt_roundtrip_with_real_key():
    import key_service
    assert key_service.decrypt_key(key_service.encrypt_key("sk-secret-123")) == "sk-secret-123"
