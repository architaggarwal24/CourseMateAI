"""Model routing per plan and job, fallbacks, costs and the per-document quiz bank (Phase 3 Stage 4b,
docs/model-routing.md)."""
import asyncio
from datetime import datetime, timezone

import pytest

import state
from conftest import make_pdf_bytes
from core_brains import llm_connection as lc
from core_brains import model_router as mr
from core_brains import usage_meter
from test_api import upload

KEYS = (("gemini", "AIza-server"), ("claude", "sk-ant-server"))
SID = "99999999-aaaa-4aaa-8aaa-999999999999"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for v in ("LLM_FAST", "LLM_STRONG", "LLM_PREMIUM", "LOCAL_LLM", "LOCAL_LLM_BASE_URL", "LOCAL_LLM_TIMEOUT",
              "MODEL_ROUTES_JSON", "MODEL_PRICES_JSON", "USD_TO_INR", "QUIZ_BANK"):
        monkeypatch.delenv(v, raising=False)
    for t in ("usage_daily", "model_usage_daily", "quiz_bank_served", "quiz_bank"):
        state.store.execute(f"DELETE FROM {t}")
    yield
    usage_meter.end()
    lc.clear_request_key()


def _labels(targets):
    return [f"{t.slot}={t.label}" for t in targets]


# ═════════════════════════ the plan ═════════════════════════════════════════
def test_with_no_slots_set_every_job_uses_the_first_server_key():
    assert _labels(mr.plan("strong", "sage", KEYS)) == ["strong=gemini:default"]
    assert _labels(mr.plan("small", "apprentice", KEYS)) == ["fast=gemini:default"]
    assert mr.plan("strong", "sage", ()) == []                                            # no server AI at all


def test_each_plan_and_job_gets_its_slots_in_order(monkeypatch):
    monkeypatch.setenv("LLM_FAST", "gemini:gemini-3.5-flash-lite")
    monkeypatch.setenv("LLM_STRONG", "gemini:gemini-3.8-flash")
    monkeypatch.setenv("LLM_PREMIUM", "claude:claude-sonnet-5-5")
    monkeypatch.setenv("LOCAL_LLM", "ollama:qwen3:8b")
    assert _labels(mr.plan("small", "apprentice", KEYS)) == ["local=ollama:qwen3:8b", "fast=gemini:gemini-3.5-flash-lite"]
    assert _labels(mr.plan("strong", "apprentice", KEYS)) == ["fast=gemini:gemini-3.5-flash-lite", "strong=gemini:gemini-3.8-flash"]
    assert _labels(mr.plan("strong", "scholar", KEYS)) == ["strong=gemini:gemini-3.8-flash", "fast=gemini:gemini-3.5-flash-lite"]
    assert _labels(mr.plan("strong", "archmage", KEYS))[0] == "premium=claude:claude-sonnet-5-5"
    assert _labels(mr.plan("small", "archmage", KEYS)) == ["fast=gemini:gemini-3.5-flash-lite", "local=ollama:qwen3:8b"]
    local = mr.plan("small", "sage", KEYS)[0]
    assert (local.base_url, local.trusted, local.timeout) == ("http://localhost:11434", True, 25.0)


def test_routes_can_be_overridden_and_a_slot_without_a_key_is_skipped(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM", "ollama:llama3.2:3b")
    monkeypatch.setenv("LLM_PREMIUM", "openai:gpt-5.4-mini")              # no OpenAI key on this server
    monkeypatch.setenv("MODEL_ROUTES_JSON", '{"apprentice": {"strong": ["local", "fast", "nonsense"]}}')
    assert _labels(mr.plan("strong", "apprentice", KEYS)) == ["local=ollama:llama3.2:3b", "fast=gemini:default"]
    assert _labels(mr.plan("strong", "archmage", KEYS)) == ["strong=gemini:default"]          # premium skipped, dupes dropped
    monkeypatch.setenv("MODEL_ROUTES_JSON", "{broken")
    assert _labels(mr.plan("strong", "apprentice", KEYS)) == ["fast=gemini:default"]


def test_a_local_openai_compatible_server_needs_its_url(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM", "openai-compatible:llama-3.1-8b")
    assert mr.slot_target("local", KEYS) is None
    monkeypatch.setenv("LOCAL_LLM_BASE_URL", "http://localhost:1234/v1")
    monkeypatch.setenv("LOCAL_LLM_TIMEOUT", "9")
    t = mr.slot_target("local", KEYS)
    assert (t.provider, t.model, t.base_url, t.timeout) == ("openai-compatible", "llama-3.1-8b", "http://localhost:1234/v1", 9.0)


def test_the_servers_own_local_model_builds_even_where_users_cant_pick_it(monkeypatch):
    monkeypatch.setenv("ENABLE_OLLAMA", "false")
    llm = lc._build_llm("ollama", mr.NO_KEY, "qwen3:8b", "http://localhost:11434", trusted=True)
    assert str(llm.openai_api_base).rstrip("/") == "http://localhost:11434/v1"
    llm = lc._build_llm("openai-compatible", mr.NO_KEY, "m", "http://192.168.1.20:1234/v1", trusted=True)  # a LAN box
    assert str(llm.openai_api_base) == "http://192.168.1.20:1234/v1"
    with pytest.raises(ValueError):
        lc._build_llm("openai-compatible", "k", "m", "http://192.168.1.20:1234/v1")               # a user's URL: refused


# ═════════════════════════ who answers a request ════════════════════════════
def test_your_own_key_is_never_routed(monkeypatch):
    monkeypatch.setattr(lc, "_server_keys", lambda: KEYS)
    lc.set_request_key("sk-mine", "openai", "gpt-5.4-mini")
    usage_meter.begin(1, byok=True, tier="apprentice")
    assert _labels(lc.request_targets()) == ["request=openai:gpt-5.4-mini"]
    usage_meter.begin(1, byok=False, tier="sage")
    assert _labels(lc.request_targets()) == ["strong=gemini:default"]
    with mr.llm_job("small"):
        assert lc.request_targets()[0].slot == "fast"
    usage_meter.end()
    assert _labels(lc.request_targets()) == ["request=openai:gpt-5.4-mini"]                       # no meter: as before


class _Stub:
    def __init__(self, name, log, fail=None, slow=0.0):
        self.name, self.log, self.fail, self.slow = name, log, fail, slow
        self._provider, self._model_name = name, "m"

    async def generate_async(self, messages, max_attempts=None):
        self.log.append(self.name)
        if self.slow:
            await asyncio.sleep(self.slow)
        if self.fail:
            raise self.fail
        return f"from {self.name}"

    async def stream_async(self, messages):
        self.log.append(self.name)
        if self.fail:
            raise self.fail
        for p in ("a", "b"):
            yield p


def _stubs(monkeypatch, **behaviour):
    log = []
    monkeypatch.setattr(lc, "get_or_create_client",
                        lambda key, provider, model, base_url=None, trusted=False: _Stub(provider, log, **behaviour.get(provider, {})))
    return log


def test_a_failing_or_slow_model_hands_the_call_to_the_next(monkeypatch, make_user):
    _, uid = make_user()
    monkeypatch.setattr(lc, "_server_keys", lambda: KEYS)
    monkeypatch.setenv("LOCAL_LLM", "ollama:qwen3:8b")
    monkeypatch.setenv("LOCAL_LLM_TIMEOUT", "0.05")
    log = _stubs(monkeypatch, ollama={"slow": 1.0})
    usage_meter.begin(uid, byok=False, tier="apprentice")
    assert asyncio.run(lc.ask_llm_quick_async(["hi"])) == "from gemini"                    # local too slow -> fast
    assert log == ["ollama", "gemini"]
    log = _stubs(monkeypatch, gemini={"fail": lc.QuotaExceededError("gemini")})
    monkeypatch.setenv("LLM_STRONG", "claude:claude-haiku-4-5-20251001")
    usage_meter.begin(uid, byok=False, tier="apprentice")
    assert asyncio.run(lc.ask_llm_async(["hi"])) == "from claude"                         # fast refused -> strong
    log = _stubs(monkeypatch, gemini={"fail": RuntimeError("x")}, claude={"fail": RuntimeError("down")})
    with pytest.raises(RuntimeError, match="down"):
        asyncio.run(lc.ask_llm_async(["hi"]))                                             # the last one's error
    falls = state.store.fetchall("SELECT provider, fallbacks FROM model_usage_daily WHERE fallbacks > 0 ORDER BY provider")
    assert [(r["provider"], r["fallbacks"]) for r in falls] == [("gemini", 2), ("ollama", 1)]


def test_a_stream_falls_back_only_before_its_first_piece(monkeypatch):
    log = _stubs(monkeypatch, gemini={"fail": RuntimeError("x")})
    targets = [mr.Target("fast", "gemini", "k", None, None), mr.Target("strong", "claude", "k", None, None)]

    async def run():
        return [p async for p in lc.stream_llm_with_key(["m"], targets=targets)]
    assert asyncio.run(run()) == ["a", "b"] and log == ["gemini", "claude"]


# ═════════════════════════ costs ════════════════════════════════════════════
def test_calls_are_costed_per_model_and_reported(monkeypatch, make_user):
    _, uid = make_user()
    monkeypatch.setenv("MODEL_PRICES_JSON", '{"gemini:gemini-3.8-flash": [0.3, 2.5], "claude:*": [1, 5]}')
    monkeypatch.setenv("USD_TO_INR", "88")
    svc = state.usage_service
    svc.record(uid, calls=1, tokens_in=1_000_000, tokens_out=100_000, provider="gemini", model="gemini-3.8-flash", job="strong")
    svc.record(uid, calls=1, tokens_in=2000, tokens_out=1000, provider="claude", model="claude-haiku-4-5-20251001", job="strong")
    svc.record(uid, calls=1, tokens_in=5000, tokens_out=5000, provider="ollama", model="qwen3:8b", job="small")
    svc.record(uid, calls=1, tokens_in=5000, tokens_out=5000, provider="nvidia-nim", model="meta/llama", job="strong")
    svc.record(uid, calls=1, tokens_in=10**6, tokens_out=10**6, provider="claude", model="x", job="strong", byok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    row = state.store.fetchone("SELECT cost_micro_usd FROM usage_daily WHERE user_id = ? AND day = ?", (uid, day))
    assert row["cost_micro_usd"] == 300_000 + 250_000 + 2000 + 5000                          # local, unpriced and own key: 0
    c = svc.costs(7)
    assert c["total_usd"] == pytest.approx(0.557) and c["total_inr"] == pytest.approx(49.02)
    assert c["unpriced"] == ["nvidia-nim:meta/llama"]
    assert c["models"][0]["model"] == "gemini-3.8-flash" and c["top_users"][0]["user_id"] == uid


def test_the_admin_command_prints_costs_and_routes(monkeypatch, make_user):
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("admin_cli2", Path(__file__).resolve().parent.parent / "scripts" / "admin.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    _, uid = make_user()
    monkeypatch.setenv("MODEL_PRICES_JSON", '{"gemini:*": [1, 1]}')
    state.usage_service.record(uid, calls=3, tokens_in=1000, tokens_out=1000, provider="gemini", model="g", job="strong")
    lines = []
    cli.main(["costs", "--days", "7"], out=lines.append)
    assert lines[0].startswith("Last 7 days: $0.0020") and "gemini:g" in lines[1]
    lines.clear()
    cli.main(["routes"], out=lines.append)
    assert len(lines) == 8 and lines[0].startswith("apprentice small")


# ═════════════════════════ the quiz bank ════════════════════════════════════
QUESTIONS = [{"question": f"Question {i} about mitochondria?", "options": ["a", "b"], "correct_answer": "a",
              "explanation": "because", "concept": "ATP"} for i in range(1, 7)]


@pytest.fixture()
def quiz_gen(monkeypatch):
    calls = []

    async def fake_quiz(context, num_questions, question_type):
        start = len(calls) * 3
        calls.append(num_questions)
        return {"questions": [dict(q, question=q["question"].replace("Question", f"Q{start + i}")) for i, q in enumerate(QUESTIONS[:num_questions])]}
    monkeypatch.setattr("routers.study.generate_quiz_async", fake_quiz)
    return calls


PDF = make_pdf_bytes("Mitochondria produce ATP through cellular respiration. " * 40)
QUIZ = {"topic": "mitochondria produce ATP cellular respiration", "num_questions": 3, "question_type": "MCQ", "session_id": SID}


def test_the_same_pdf_quizzes_other_users_from_the_bank(make_user, quiz_gen):
    a, _ = make_user()
    upload(a, SID, PDF)
    assert a.post("/quiz", json=QUIZ).status_code == 200
    assert quiz_gen == [3]
    b, _ = make_user()
    sid_b = "88888888-aaaa-4aaa-8aaa-888888888888"
    upload(b, sid_b, PDF)                                                           # same file, another account
    r = b.post("/quiz", json={**QUIZ, "session_id": sid_b})
    assert r.status_code == 200 and quiz_gen == [3]                                 # no AI call
    texts = [q["question"] for q in r.json()["content"]["questions"]]
    assert len(texts) == 3 and all(t.startswith("Q") for t in texts)
    assert [q["id"] for q in r.json()["content"]["questions"]] == [1, 2, 3]
    assert "correct_answer" not in r.json()["content"]["questions"][0]             # still graded on the server
    r2 = b.post("/quiz", json={**QUIZ, "session_id": sid_b, "topic": QUIZ["topic"] + " "})   # the same topic, seen all
    state.generation_cache.clear()
    r3 = b.post("/quiz", json={**QUIZ, "session_id": sid_b})
    assert r2.status_code == r3.status_code == 200 and quiz_gen == [3, 3]          # B had them all: a new batch


def test_the_bank_can_be_switched_off(make_user, quiz_gen, monkeypatch):
    monkeypatch.setenv("QUIZ_BANK", "0")
    a, _ = make_user()
    upload(a, SID, PDF)
    a.post("/quiz", json=QUIZ)
    assert state.store.fetchone("SELECT COUNT(*) AS n FROM quiz_bank")["n"] == 0


def test_the_bank_keeps_each_question_once_and_serves_unseen_ones(make_user):
    _, uid = make_user()
    bank = state.quiz_bank
    ids = bank.add("h", "Cells", "MCQ", QUESTIONS[:4])
    assert len(ids) == 4 and bank.add("h", "cells ", "MCQ", QUESTIONS[:2]) == ids[:2]     # same texts, same rows
    assert bank.size("h", "CELLS", "MCQ") == 4 and bank.size("h", "cells", "True/False") == 0
    assert bank.take(uid, "h", "cells", "MCQ", 5) is None                                    # not enough: nothing marked
    first = bank.take(uid, "h", "cells", "MCQ", 3)
    assert len(first) == 3 and bank.take(uid, "h", "cells", "MCQ", 2) is None              # only one unseen left
    assert len(bank.take(uid, "h", "cells", "MCQ", 1)) == 1
