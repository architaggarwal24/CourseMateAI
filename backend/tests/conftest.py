"""Shared fixtures.

Tests run against a throw-away data/upload directory (never your real data/) and a
fake embedding model, so they need no network, no GPU and no 1.3 GB model download.
"""
import os
import sys
import types
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# ── Environment must be set BEFORE main.py is imported ───────────────────────
_TMP = tempfile.mkdtemp(prefix="coursemate_tests_")
os.environ["COURSEMATE_DATA_DIR"] = str(Path(_TMP) / "data")
os.environ["COURSEMATE_UPLOAD_DIR"] = str(Path(_TMP) / "uploads")
os.environ["COURSEMATE_SKIP_WARMUP"] = "1"
os.environ["JWT_SECRET"] = "test-jwt-secret-" + "x" * 32
os.environ["ENCRYPTION_KEY"] = "uHw8Qy3m5y1m1N2s0Wc2n8cE0ZxqkC0m3dJX1xGk0aA="   # valid Fernet key (test only)
os.environ.pop("ALLOW_INSECURE_DEV_KEY", None)

# ── Fake embeddings so FAISS works offline ───────────────────────────────────
# langchain_huggingface (and torch) may not be installed in CI; stub the import.
if "langchain_huggingface" not in sys.modules:
    try:
        import langchain_huggingface  # noqa: F401
    except Exception:
        stub = types.ModuleType("langchain_huggingface")
        stub.HuggingFaceEmbeddings = object
        sys.modules["langchain_huggingface"] = stub

from fakes import BagOfWordsEmbeddings  # noqa: E402

_FAKE = BagOfWordsEmbeddings()   # unit-norm, so cosine similarity is meaningful (see fakes.py)

import rag.embeddings as _emb          # noqa: E402
import rag.vectorstore as _vs          # noqa: E402

_emb.get_embedding_model = lambda *a, **k: _FAKE
_vs.get_embedding_model = lambda *a, **k: _FAKE

API_PREFIX = "/api/v1"


def api_client(app, **kwargs):
    """TestClient whose relative URLs resolve under /api/v1, e.g. client.post("/chat") -> /api/v1/chat."""
    from fastapi.testclient import TestClient
    return TestClient(app, base_url=f"http://testserver{API_PREFIX}", **kwargs)


def make_pdf_bytes(text: str = "Mitosis is cell division. " * 40, pages: int = 2) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    import io
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for p in range(pages):
        y = 800
        for line in range(0, len(text), 90):
            c.drawString(40, y, text[line:line + 90])
            y -= 14
            if y < 60:
                break
        c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="session")
def app_module():
    import main
    return main


@pytest.fixture()
def client(app_module):
    from fastapi.testclient import TestClient
    import state
    # fresh limiter state so rate limits from one test don't leak into the next
    try:
        state.limiter.reset()
    except Exception:
        pass
    with api_client(app_module.app) as c:
        yield c


_counter = {"n": 0}


@pytest.fixture()
def make_user(app_module, monkeypatch):
    """Create a user (bypassing the paid API-key validation call) and return an
    authenticated TestClient plus the user's id."""
    from fastapi.testclient import TestClient
    import state

    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: (True, ""))
    clients = []

    def _make(name=None):
        _counter["n"] += 1
        n = _counter["n"]
        name = name or f"user{n}"
        c = api_client(app_module.app)
        c.__enter__()
        clients.append(c)
        r = c.post("/auth/register", json={
            "email": f"{name}@example.com", "password": "correct-horse-1",
            "username": name, "full_name": name.title(),
            "api_key": f"sk-test-{name}-aaaaaaaa", "llm_provider": "gemini",
        })
        assert r.status_code == 200, r.text
        return c, r.json()["user_id"]

    try:
        state.limiter.reset()
    except Exception:
        pass
    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture()
def pdf_bytes():
    return make_pdf_bytes()


@pytest.fixture(autouse=True)
def _no_real_llm_for_rewriting(app_module, monkeypatch):
    """Follow-up rewriting makes its own (small) LLM call. Tests never reach a real provider: by default it
    fails, which exercises the fallback; tests that care patch routers.study.ask_llm_quick_async."""
    async def unavailable(messages):
        raise RuntimeError("no real LLM in tests")
    monkeypatch.setattr("routers.study.ask_llm_quick_async", unavailable)


@pytest.fixture(autouse=True)
def _clean_state(app_module):
    """Every test starts with no sessions and an empty upload directory."""
    import shutil
    import state
    from config import UPLOAD_DIR
    state.vector_stores.clear()
    state.db.execute("DELETE FROM documents")
    for p in UPLOAD_DIR.glob("*"):
        shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
    state.generation_cache.clear()
    yield
