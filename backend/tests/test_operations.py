"""Operational basics: request ids, structured logs (and what they never contain), LLM metrics,
/health vs /ready."""
import io
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core_brains.llm_connection as lc
import state
from config.settings import load_settings
from conftest import api_client
from errors import register_handlers
from observability import RequestContextMiddleware, install_metrics_endpoint, llm_metrics, redact
from observability.logs import JsonFormatter, configure_logging
from test_api import upload

SID = "55555555-5555-4555-8555-555555555555"


@pytest.fixture()
def log_lines():
    """Everything logged during the test, as parsed JSON objects (via the real JSON formatter)."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    old_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)

    def lines():
        return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    yield lines
    root.removeHandler(handler)
    root.setLevel(old_level)


# ── request id ────────────────────────────────────────────────────────────────
def test_every_response_has_a_request_id_and_errors_carry_the_same_one(app_module):
    c = api_client(app_module.app)
    ok, bad = c.get("/health"), c.get("/shop")
    assert ok.headers["X-Request-ID"] and bad.headers["X-Request-ID"] != ok.headers["X-Request-ID"]
    assert bad.status_code == 401 and bad.json()["error"]["request_id"] == bad.headers["X-Request-ID"]
    assert c.get("/does-not-exist").json()["error"]["request_id"]                        # framework 404 too
    assert c.post("/auth/login", json={}).json()["error"]["request_id"]                  # validation error too


def test_a_sane_incoming_request_id_is_kept_and_a_hostile_one_is_replaced(app_module):
    c = api_client(app_module.app)
    r = c.get("/health", headers={"X-Request-ID": "proxy-req-12345"})
    assert r.headers["X-Request-ID"] == "proxy-req-12345"
    r = c.get("/health", headers={"X-Request-ID": 'x"}\ninjected {"level":"CRITICAL"}'})
    assert r.headers["X-Request-ID"] != 'x"}\ninjected {"level":"CRITICAL"}' and len(r.headers["X-Request-ID"]) == 32


def test_the_request_id_is_also_on_unexpected_errors():
    app = FastAPI()
    register_handlers(app)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret /srv/app/path sk-LEAK0123456789")
    r = TestClient(app, raise_server_exceptions=False).get("/boom", headers={"X-Request-ID": "req-from-caller-1"})
    assert r.status_code == 500
    assert r.headers["X-Request-ID"] == "req-from-caller-1" and r.json()["error"]["request_id"] == "req-from-caller-1"


def test_one_access_line_per_request_without_the_query_string(app_module, log_lines):
    c = api_client(app_module.app)
    rid = c.get("/health?token=hunter2hunter2", headers={"X-Request-ID": "access-line-1"}).headers["X-Request-ID"]
    mine = [l for l in log_lines() if l.get("request_id") == rid]
    assert len(mine) == 1
    line = mine[0]
    assert (line["event"], line["method"], line["path"], line["status"]) == ("request", "GET", "/api/v1/health", 200)
    assert line["duration_ms"] >= 0 and "hunter2" not in json.dumps(line)


# ── the JSON log format ───────────────────────────────────────────────────────
def _format(**kw):
    record = logging.LogRecord("t", logging.INFO, __file__, 1, kw.pop("msg", "hello"), (), kw.pop("exc_info", None))
    for k, v in kw.items():
        setattr(record, k, v)
    return json.loads(JsonFormatter().format(record))


def test_log_lines_are_json_with_structured_fields():
    line = _format(msg="hello", event="x", count=3)
    assert set(line) >= {"ts", "level", "logger", "msg", "event", "count"} and line["ts"].endswith("Z")
    assert line["count"] == 3 and "request_id" not in line


def test_keys_and_secrets_are_redacted_from_every_line():
    configure_logging(secrets=["my-very-secret-jwt-value"])
    try:
        text = ("openai sk-proj-abcdefghijklmnop1234 google AIzaSyA1234567890abcdefghijkl Bearer abcdef1234567890 "
                "api_key=plainvalue123 my-very-secret-jwt-value")
        out = _format(msg=text)["msg"]
        for leaked in ("sk-proj", "AIzaSy", "abcdef1234567890", "plainvalue123", "my-very-secret-jwt-value"):
            assert leaked not in out
        assert redact("no secrets here") == "no secrets here"
    finally:
        from config import settings
        configure_logging(secrets=[settings.jwt_secret, settings.encryption_key])


def test_exception_lines_carry_the_type_and_frames_but_not_what_was_being_processed():
    from pydantic import BaseModel, ValidationError

    class M(BaseModel):
        text: int
    try:
        M(text="the student's private document text")
    except ValidationError:
        import sys
        line = _format(msg="failed", exc_info=sys.exc_info())
    assert line["exc_type"] == "ValidationError" and "exc_message" not in line
    assert "private document text" not in json.dumps(line) and line["stack"]
    try:
        raise OSError("disk full")
    except OSError:
        import sys
        assert _format(exc_info=sys.exc_info())["exc_message"] == "disk full"
    try:
        raise RuntimeError("provider said: here is your prompt")      # could quote the prompt: type and frames only
    except RuntimeError:
        import sys
        line = _format(exc_info=sys.exc_info())
        assert line["exc_type"] == "RuntimeError" and "prompt" not in json.dumps(line)


# ── a failing LLM call ────────────────────────────────────────────────────────
@pytest.fixture()
def failing_llm(monkeypatch):
    class Failing:
        def invoke(self, messages):
            raise RuntimeError("upstream exploded: here is the prompt text sk-ABCDEFGH12345678")
    monkeypatch.setattr(lc, "_build_llm", lambda **kw: Failing())
    monkeypatch.setattr(lc.time, "sleep", lambda s: None)
    lc._client_cache.clear()
    llm_metrics.reset()
    yield
    lc._client_cache.clear()


def test_a_failing_llm_call_writes_one_structured_line_with_its_request_id(make_user, pdf_bytes, failing_llm, log_lines):
    c, _ = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID})
    assert r.status_code >= 500
    rid = r.headers["X-Request-ID"]
    assert r.json()["error"]["request_id"] == rid

    failed = [l for l in log_lines() if l.get("event") == "llm_call_failed"]
    assert len(failed) == 1                                       # one line for the call, not one per retry
    line = failed[0]
    assert line["request_id"] == rid and line["level"] == "ERROR"
    assert (line["provider"], line["operation"], line["error_class"]) == ("gemini", "generate", "other")
    assert line["error_type"] == "RuntimeError" and line["duration_ms"] >= 0 and line["model"]
    everything = json.dumps(log_lines())
    assert "prompt text" not in everything and "sk-ABCDEFGH" not in everything


def test_llm_error_classes_are_told_apart(failing_llm, log_lines):
    from core_brains.llm_connection import LLMClient
    client = LLMClient(api_key="k", provider="gemini")
    for message, expected in (("429 Too Many Requests", "quota"), ("Incorrect API key provided", "auth"),
                              ("Connection refused", "unreachable")):
        client.llm.invoke = lambda m, _msg=message: (_ for _ in ()).throw(RuntimeError(_msg))
        with pytest.raises(Exception):
            client.generate(["hi"])
        assert [l["error_class"] for l in log_lines() if l.get("event") == "llm_call_failed"][-1] == expected


# ── metrics ───────────────────────────────────────────────────────────────────
def test_llm_metrics_count_time_and_classify(failing_llm):
    from core_brains.llm_connection import LLMClient
    client = LLMClient(api_key="k", provider="gemini")
    with pytest.raises(RuntimeError):
        client.generate(["hi"])

    class Fine:
        content = "an answer"
    client.llm.invoke = lambda m: Fine()
    assert client.generate(["hi"]) == "an answer"

    snap = llm_metrics.snapshot()
    assert snap["calls"] == {("gemini", "error"): 1, ("gemini", "ok"): 1}
    assert snap["errors"] == {("gemini", "other"): 1}
    text = llm_metrics.render()
    assert 'coursemate_llm_calls_total{provider="gemini",status="ok"} 1' in text
    assert 'coursemate_llm_errors_total{provider="gemini",error_class="other"} 1' in text
    assert 'coursemate_llm_call_duration_seconds_count{provider="gemini",status="error"} 1' in text
    assert 'le="+Inf"' in text and "sk-" not in text


def test_an_unknown_provider_never_becomes_a_label():
    from observability.metrics import provider_label
    assert provider_label("gemini") == "gemini" and provider_label("anything-a-user-typed") == "unknown"


def test_metrics_endpoint_is_off_by_default_and_served_when_enabled(app_module):
    assert load_settings({"JWT_SECRET": "x" * 32, "ENCRYPTION_KEY": "uHw8Qy3m5y1m1N2s0Wc2n8cE0ZxqkC0m3dJX1xGk0aA="}).metrics_enabled is False
    assert TestClient(app_module.app).get("/metrics").status_code == 404
    assert load_settings({"JWT_SECRET": "x" * 32, "ENCRYPTION_KEY": "uHw8Qy3m5y1m1N2s0Wc2n8cE0ZxqkC0m3dJX1xGk0aA=",
                          "METRICS_ENABLED": "true"}).metrics_enabled is True

    app = FastAPI()
    install_metrics_endpoint(app)
    llm_metrics.reset()
    llm_metrics.record("gemini", 0.3, None)
    r = TestClient(app).get("/metrics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert 'coursemate_llm_calls_total{provider="gemini",status="ok"} 1' in r.text
    assert "/metrics" not in json.dumps(app_module.app.openapi())


# ── liveness vs readiness ─────────────────────────────────────────────────────
def test_health_is_liveness_only_and_never_touches_the_database(app_module, monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("database is down")
    monkeypatch.setattr(state.store, "fetchone", broken)
    r = api_client(app_module.app).get("/health")
    assert r.status_code == 200 and r.json() == {"status": "healthy"}


def test_ready_needs_the_database_and_the_embedding_model(app_module, monkeypatch):
    c = api_client(app_module.app)
    monkeypatch.setattr("routers.health.embedding_model_loaded", lambda: False)
    r = c.get("/ready")
    assert r.status_code == 503 and r.json()["error"]["code"] == "not_ready"
    assert r.json()["error"]["details"]["checks"] == {"database": "ok", "embedding_model": "loading"}

    monkeypatch.setattr("routers.health.embedding_model_loaded", lambda: True)
    r = c.get("/ready")
    assert r.status_code == 200 and r.json()["status"] == "ready"
    assert r.json()["checks"] == {"database": "ok", "embedding_model": "ok"}

    def broken(*a, **k):
        raise RuntimeError("database is down")
    monkeypatch.setattr("routers.health.store", type("S", (), {"fetchone": staticmethod(broken)}))
    r = c.get("/ready")
    assert r.status_code == 503 and r.json()["error"]["details"]["checks"]["database"] == "failing"


async def test_a_stream_the_reader_abandons_is_neither_a_failure_nor_logged(log_lines):
    from core_brains.llm_connection import LLMClient

    class Chunk:
        def __init__(self, text):
            self.content = text

    class Streaming:
        async def astream(self, messages):
            for t in ("one", "two", "three"):
                yield Chunk(t)

    llm_metrics.reset()
    client = LLMClient(api_key="k", provider="gemini")
    client.llm = Streaming()
    agen = client.stream_async(["hi"])
    assert await anext(agen) == "one"
    await agen.aclose()                                           # the browser went away
    assert llm_metrics.snapshot()["calls"] == {} and not [l for l in log_lines() if l.get("event") == "llm_call_failed"]

    client2 = LLMClient(api_key="k", provider="gemini")
    client2.llm = Streaming()
    assert [p async for p in client2.stream_async(["hi"])] == ["one", "two", "three"]
    assert llm_metrics.snapshot()["calls"] == {("gemini", "ok"): 1}
