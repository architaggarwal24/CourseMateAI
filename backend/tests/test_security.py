"""Security pass (Phase 3 Stage 4d, docs/security.md): rate limits everywhere it matters, the account's keys
(email, password, deletion) need the password, per-account login throttling, headers, error-report scrubbing."""
import pytest
from fastapi.routing import APIRoute

import state
from auth.login_throttle import LoginThrottle

PASSWORD = "correct-horse-1"
# Routes that change something but need no limit of their own: logging out only ends your own session.
UNLIMITED_OK = {("POST", "/api/v1/auth/logout")}


def _routes(app):
    for inc in app.routes:
        router = getattr(inc, "original_router", None)
        prefix = "/api/v1" if router is not None else ""
        for r in (router.routes if router is not None else [inc]):
            if isinstance(r, APIRoute):
                yield prefix + r.path, r


def test_every_route_that_changes_something_is_rate_limited(app_module):
    limits = state.limiter._route_limits
    missing = []
    for path, r in _routes(app_module.app):
        for m in r.methods - {"GET", "HEAD"}:
            if (m, path) not in UNLIMITED_OK and not limits.get(f"{r.endpoint.__module__}.{r.endpoint.__name__}"):
                missing.append(f"{m} {path}")
    assert not missing, missing


def test_changing_the_email_needs_the_current_password(make_user):
    c, _ = make_user()
    r = c.post("/auth/update-profile", json={"email": "new@example.com"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "current_password_required"
    r = c.post("/auth/update-profile", json={"email": "new@example.com", "current_password": "nope-nope"})
    assert r.status_code == 401 and r.json()["error"]["details"]["field"] == "current_password"
    assert c.post("/auth/update-profile", json={"email": "new@example.com", "current_password": PASSWORD}).status_code == 200
    assert c.post("/auth/update-profile", json={"full_name": "Just A Name"}).status_code == 200   # the rest needs none


def test_deleting_the_account_needs_the_password(make_user):
    c, uid = make_user()
    assert c.request("DELETE", "/auth/delete-account").status_code == 422
    r = c.request("DELETE", "/auth/delete-account", json={"password": "wrong-wrong"})
    assert r.status_code == 401 and state.db.get_user_by_id(uid) is not None
    assert c.request("DELETE", "/auth/delete-account", json={"password": PASSWORD}).status_code == 200
    assert state.db.get_user_by_id(uid) is None


def test_many_wrong_passwords_lock_that_account_for_a_while(make_user, client, monkeypatch):
    c, uid = make_user("lockme")
    t = {"now": 1000.0}
    monkeypatch.setattr(state, "login_throttle", LoginThrottle(max_failures=3, window=60, clock=lambda: t["now"]))
    monkeypatch.setattr("routers.auth.login_throttle", state.login_throttle)
    monkeypatch.setattr(state.limiter, "enabled", False)                 # the per-client limit is another test
    bad = {"email": "lockme@example.com", "password": "wrong-password"}
    assert [client.post("/auth/login", json=bad).status_code for _ in range(3)] == [401, 401, 401]
    r = client.post("/auth/login", json={**bad, "password": PASSWORD})           # even the right one, for now
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert client.post("/auth/login", json={"email": "other@example.com", "password": "x" * 9}).status_code == 401
    t["now"] += 61
    assert client.post("/auth/login", json={**bad, "password": PASSWORD}).status_code == 200
    assert state.login_throttle.retry_after("lockme@example.com") == 0


def test_responses_carry_the_security_headers(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_error_reports_carry_no_secrets():
    from observability.monitoring import scrub_event
    event = {
        "request": {"headers": {"Cookie": "session_token=abc", "Authorization": "Bearer x", "X-Razorpay-Signature": "s",
                                "User-Agent": "ua"}, "cookies": {"session_token": "abc"}, "data": {"password": "p"},
                    "query_string": "token=abc"},
        "user": {"id": 7, "email": "a@b.c", "ip_address": "1.2.3.4"},
        "exception": {"values": [{"value": "401 for key sk-proj-ABCDEFGHIJKLMNOPQRSTUV and AIzaSyA1234567890abcdefghijklmnop"}]},
        "extra": {"api_key": "sk-ant-api03-xxxxxxxxxxxxxxxxxxxx", "note": "fine"},
        "breadcrumbs": {"values": [{"message": "Fernet gAAAAABmZ5TestTestTestTest=="}]},
    }
    out = scrub_event(event, {})
    h = out["request"]["headers"]
    assert "Cookie" not in h and "Authorization" not in h and "X-Razorpay-Signature" not in h and h["User-Agent"] == "ua"
    assert "cookies" not in out["request"] and "data" not in out["request"] and "query_string" not in out["request"]
    assert out["user"] == {"id": 7}
    text = str(out)
    assert "sk-proj-ABC" not in text and "AIzaSy" not in text and "sk-ant" not in text and "gAAAAA" not in text
    assert out["extra"]["note"] == "fine" and "[redacted]" in text


def test_monitoring_is_off_without_a_dsn(monkeypatch):
    from observability import monitoring
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert monitoring.init_monitoring() is False


def test_a_provider_error_never_echoes_a_key():
    import providers
    from key_service import _explain_error
    ok, msg = _explain_error(providers.get_provider("openai"), "m", None,
                             RuntimeError("odd failure for key sk-proj-ABCDEFGHIJKLMNOPQRST"), "a-different-key")
    assert ok is False and "sk-proj" not in msg and "[redacted]" in msg


def test_a_wildcard_cors_origin_is_never_allowed():
    import os
    from config.settings import load_settings
    env = {**os.environ, "ALLOWED_ORIGIN": "*"}
    assert "*" not in load_settings(env).allowed_origins
    env["ALLOWED_ORIGIN"] = "https://coursemate.example, https://www.coursemate.example"
    assert {"https://coursemate.example", "https://www.coursemate.example"} <= set(load_settings(env).allowed_origins)
