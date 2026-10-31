"""Every failure uses one shape: {"error": {"code", "message", "action", "details", "request_id"}}."""
import pathlib
import re

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from errors import AppError, register_handlers
from conftest import api_client
from test_api import fake_llm, upload  # noqa: F401  (fixture + helper shared with test_api)

SID1 = "11111111-1111-4111-8111-111111111111"
STREAMING_ENDPOINTS = {"/api/v1/chat/stream"}
ACTIONS = {"settings", "relogin", "retry", "reupload", None}


def err(r):
    body = r.json()
    assert set(body) == {"error"}, f"bare/extra keys in error body: {body}"     # never a top-level "detail"
    e = body["error"]
    assert set(e) == {"code", "message", "action", "details", "request_id"}, e
    assert isinstance(e["code"], str) and e["code"] and isinstance(e["message"], str) and e["message"]
    assert e["action"] in ACTIONS
    return e


# ── the cases the frontend reacts to ──────────────────────────────────────────
def test_unauthenticated(app_module):
    e = err(api_client(app_module.app).get("/shop"))
    assert (e["code"], e["action"]) == ("unauthenticated", "relogin")


def test_session_expired_when_no_document(make_user, fake_llm):
    c, _ = make_user()
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    assert r.status_code == 400
    e = err(r)
    assert (e["code"], e["action"]) == ("session_expired", "reupload")


def test_invalid_session_id_is_session_expired(make_user):
    c, _ = make_user()
    r = c.get("/arena/battles/active", params={"session_id": "bad id!"})
    assert r.status_code == 400
    assert (err(r)["code"], err(r)["action"]) == ("session_expired", "reupload")


def test_provider_quota_carries_usage_url(make_user, pdf_bytes, monkeypatch):
    from core_brains.llm_connection import QuotaExceededError

    def boom(*a):
        raise QuotaExceededError("gemini")
    monkeypatch.setattr("routers.study.chat_with_context", boom)
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    assert r.status_code == 429
    e = err(r)
    assert e["code"] == "provider_quota" and e["action"] == "settings"
    assert e["details"]["provider"] == "gemini" and e["details"]["usage_url"].startswith("https://")
    assert "Google Gemini" in e["message"]


def test_rejected_provider_key_and_unreachable_provider(make_user, pdf_bytes, monkeypatch):
    from core_brains.llm_connection import InvalidApiKeyError, ProviderUnreachableError
    c, _ = make_user()
    upload(c, SID1, pdf_bytes)
    for exc, status, code, action in [
        (InvalidApiKeyError("gemini"), 400, "provider_key_rejected", "settings"),      # 400, never 401
        (ProviderUnreachableError("gemini"), 502, "provider_unreachable", "retry"),
    ]:
        def boom(*a, _e=exc):
            raise _e
        monkeypatch.setattr("routers.study.chat_with_context", boom)
        r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
        assert r.status_code == status
        assert (err(r)["code"], err(r)["action"]) == (code, action)


def test_other_users_session_is_forbidden(make_user, pdf_bytes, fake_llm):
    a, _ = make_user()
    upload(a, SID1, pdf_bytes)
    b, _ = make_user()
    r = b.post("/chat", json={"question": "What is mitosis?", "session_id": SID1})
    assert r.status_code == 403 and err(r)["code"] == "forbidden"


def test_upload_problems_say_reupload(make_user):
    c, _ = make_user()
    r = c.post("/upload", files={"file": ("a.pdf", b"definitely not a pdf", "application/pdf")}, data={"session_id": SID1})
    assert r.status_code == 400
    assert (err(r)["code"], err(r)["action"]) == ("invalid_file", "reupload")
    r = c.post("/upload", files={"file": ("a.txt", b"x", "text/plain")}, data={"session_id": SID1})
    assert (err(r)["code"], err(r)["action"]) == ("invalid_file", "reupload")


def test_credentials_and_input_errors_are_coded(app_module, make_user):
    cl = api_client(app_module.app)
    r = cl.post("/auth/login", json={"email": "nobody@example.com", "password": "whatever1"})
    assert r.status_code == 401 and err(r)["code"] == "invalid_credentials"
    c, _ = make_user()
    r = c.post("/chat", json={"question": "hi", "session_id": SID1})
    assert r.status_code == 400 and err(r)["code"] == "invalid_input"


# ── validation: per-field details, no echoed input ────────────────────────────
def test_validation_errors_list_each_field_without_echoing_values(make_user):
    c, _ = make_user()
    r = c.post("/chat", json={"question": 12345})                    # wrong type + missing session_id
    assert r.status_code == 422
    e = err(r)
    assert e["code"] == "validation_error"
    fields = {f["field"]: f for f in e["details"]["fields"]}
    assert {"question", "session_id"} <= set(fields)
    assert all(set(f) == {"field", "in", "message", "type"} and f["in"] == "body" for f in fields.values())
    r = c.post("/auth/login", json={"email": "a@b.co", "password": 99999999})
    assert r.status_code == 422 and "99999999" not in r.text


# ── framework / handler behaviour on an isolated app ──────────────────────────
@pytest.fixture()
def mini():
    app = FastAPI()
    register_handlers(app)

    @app.get("/app-error")
    def _a():
        raise AppError("custom_code", "A safe sentence.", status_code=409, action="retry",
                       details={"x": 1}, headers={"X-Test": "1"})

    @app.get("/plain-4xx")
    def _b():
        raise HTTPException(status_code=403, detail="Not yours")

    @app.get("/plain-dict")
    def _c():
        raise HTTPException(status_code=429, detail={"message": "Slow down", "usage_url": "https://u"})

    @app.get("/plain-5xx")
    def _d():
        raise HTTPException(status_code=500, detail="db password is hunter2 at /srv/app")

    @app.get("/boom")
    def _e():
        raise RuntimeError("secret /srv/app/path sk-LEAK")

    return TestClient(app, raise_server_exceptions=False)


def test_app_error_serialises_all_fields_and_headers(mini):
    r = mini.get("/app-error")
    assert r.status_code == 409 and r.headers["X-Test"] == "1"
    assert r.json() == {"error": {"code": "custom_code", "message": "A safe sentence.", "action": "retry", "details": {"x": 1},
                                  "request_id": None}}


def test_plain_http_exceptions_are_wrapped_never_bare(mini):
    e = err(mini.get("/plain-4xx"))
    assert (e["code"], e["message"]) == ("forbidden", "Not yours")
    e = err(mini.get("/plain-dict"))
    assert e["message"] == "Slow down" and e["details"] == {"usage_url": "https://u"} and e["code"] == "rate_limited"
    r = mini.get("/does-not-exist")
    assert r.status_code == 404 and err(r)["code"] == "not_found"
    r = mini.post("/plain-4xx")
    assert r.status_code == 405 and err(r)["code"] == "method_not_allowed"


def test_unexpected_errors_leak_nothing(mini):
    for path in ("/boom", "/plain-5xx"):
        r = mini.get(path)
        assert r.status_code == 500
        e = err(r)
        assert (e["code"], e["action"], e["details"]) == ("internal", "retry", None)
        assert not re.search(r"sk-LEAK|/srv/app|hunter2|RuntimeError|Traceback", r.text)


# ── guards so the contract can't silently regress ─────────────────────────────
def test_no_code_raises_a_bare_http_exception():
    root = pathlib.Path(__file__).resolve().parent.parent
    offenders = []
    for p in root.rglob("*.py"):
        rel = p.relative_to(root).as_posix()
        if rel.startswith(("tests/", ".venv/", "venv/", "static/")) or rel == "errors.py":
            continue
        if re.search(r"raise\s+(?:fastapi\.)?HTTPException\(", p.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(rel)
    assert not offenders, f"use AppError / errors.py factories instead: {offenders}"


def test_every_endpoint_declares_a_json_response_model(app_module):
    spec = app_module.app.openapi()
    missing = []
    for path, item in spec["paths"].items():
        for method, op in item.items():
            ok = next(code for code in op["responses"] if code.startswith("2"))
            content = op["responses"][ok]["content"]
            if path in STREAMING_ENDPOINTS:                       # Server-Sent Events, not a JSON body
                assert "text/event-stream" in content, path
                continue
            schema = content["application/json"]["schema"]
            if not schema or schema == {}:
                missing.append(f"{method.upper()} {path}")
    assert not missing, missing
