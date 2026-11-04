"""Plans, quotas, usage metering and invite codes (Phase 3 Stage 4a, docs/plans.md)."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from langchain_core.messages import AIMessage, HumanMessage

import state
from conftest import make_pdf_bytes
from core_brains import usage_meter
from core_brains.llm_connection import LLMClient
from services import entitlements
from test_api import upload

DOC = ["11111111-aaaa-4aaa-8aaa-11111111111{}".format(i) for i in range(6)]


def _pdf(i):
    return make_pdf_bytes(f"Document number {i} talks about mitochondria and ATP. " * 20)


@pytest.fixture(autouse=True)
def _clean():
    for t in ("usage_daily", "user_plans", "invite_redemptions", "invite_codes"):
        state.store.execute(f"DELETE FROM {t}")
    yield


@pytest.fixture()
def managed(make_user, monkeypatch):
    """A user on the server's own AI (no key of theirs), so the plan's AI quotas apply."""
    def _make(tier="apprentice"):
        monkeypatch.setenv("DEFAULT_TIER", tier)
        c, uid = make_user()
        state.db.save_api_key(uid, None, None, None, None)
        return c, uid
    return _make


@pytest.fixture()
def answers(monkeypatch):
    monkeypatch.setattr("routers.study.chat_with_context", lambda q, ctx, hist: "ATP is made in mitochondria.")


def _used(uid, calls=0, tokens=0, byok_calls=0, byok_tokens=0):
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    state.store.execute("INSERT INTO usage_daily (user_id, day, ai_calls, byok_calls, tokens_in, tokens_out, byok_tokens) "
                        "VALUES (?,?,?,?,?,0,?)", (uid, day, calls, byok_calls, tokens, byok_tokens))


# ═════════════════════════ the catalogue ════════════════════════════════════
def test_the_plans_are_public_with_inr_prices_limits_and_features(client):
    r = client.get("/plans").json()
    by = {p["tier"]: p for p in r["plans"]}
    assert [p["tier"] for p in r["plans"]] == ["apprentice", "scholar", "sage", "archmage"]
    assert [(by[t]["price_month"], by[t]["price_year"]) for t in by] == [(0, 0), (149, 1490), (299, 2990), (599, 5990)]
    assert by["apprentice"]["limits"] == {"documents": 3, "pdf_mb": 10, "ai_calls_day": 25, "tokens_month": 300_000, "courses": 0}
    assert by["sage"]["limits"]["courses"] == 10 and by["archmage"]["limits"]["ai_calls_day"] == 1200
    assert "review_queue" not in by["apprentice"]["features"] and "review_queue" in by["scholar"]["features"]
    assert {"courses", "concept_map", "exam_mode"} <= set(by["sage"]["features"])
    assert r["currency"] == "INR" and r["payments_enabled"] is False and r["invite_only"] is False


def test_limits_can_be_tuned_from_the_environment(monkeypatch):
    monkeypatch.setenv("PLAN_LIMITS_JSON", '{"scholar": {"ai_calls_day": 200, "bogus": 1}}')
    assert entitlements.limits("scholar")["ai_calls_day"] == 200 and "bogus" not in entitlements.limits("scholar")
    monkeypatch.setenv("PLAN_LIMITS_JSON", "not json")
    assert entitlements.limits("scholar")["ai_calls_day"] == 150


def test_a_plan_row_wins_over_the_default_until_it_expires(managed):
    c, uid = managed("apprentice")
    assert entitlements.tier_for(uid) == "apprentice"
    state.invite_service.set_plan(uid, "sage", days=3)
    assert entitlements.tier_for(uid) == "sage" and c.get("/entitlements").json()["tier"] == "sage"
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    state.store.execute("UPDATE user_plans SET expires_at = ? WHERE user_id = ?", (past, uid))
    assert entitlements.tier_for(uid) == "apprentice"


# ═════════════════════════ metering ═════════════════════════════════════════
class _Fake:
    def __init__(self, reply):
        self.reply = reply

    async def ainvoke(self, messages):
        return self.reply


def _client(reply):
    c = LLMClient.__new__(LLMClient)
    c.max_retries, c._provider, c._structured_unsupported, c._model_name = 1, "gemini", False, "m"
    c.llm = _Fake(reply)
    return c


def test_every_model_call_is_counted_for_the_user_with_its_tokens(managed):
    _, uid = managed()
    usage_meter.begin(uid, byok=False)
    try:
        real = AIMessage(content="ok", usage_metadata={"input_tokens": 120, "output_tokens": 30, "total_tokens": 150})
        asyncio.run(_client(real).generate_async([HumanMessage(content="hi")]))
        asyncio.run(_client(AIMessage(content="x" * 400)).generate_async([HumanMessage(content="y" * 80)]))    # no counts: estimated
    finally:
        usage_meter.end()
    row = state.store.fetchone("SELECT * FROM usage_daily WHERE user_id = ?", (uid,))
    assert (row["ai_calls"], row["tokens_in"], row["tokens_out"], row["byok_calls"]) == (2, 120 + 20, 30 + 100, 0)
    asyncio.run(_client(real).generate_async([HumanMessage(content="hi")]))                                 # no meter: not counted
    assert state.store.fetchone("SELECT ai_calls FROM usage_daily WHERE user_id = ?", (uid,))["ai_calls"] == 2


def test_a_streamed_answer_keeps_its_meter_after_the_request(managed):
    _, uid = managed()
    meter = usage_meter.Meter(uid, byok=True)

    async def gen():
        usage_meter.add_call()
        yield "a"

    async def consume():
        usage_meter.end()                                               # the request's dependencies are gone
        return [x async for x in usage_meter.carry(gen(), meter)]
    assert asyncio.run(consume()) == ["a"]
    row = state.store.fetchone("SELECT ai_calls, byok_calls FROM usage_daily WHERE user_id = ?", (uid,))
    assert (row["ai_calls"], row["byok_calls"]) == (1, 1)


# ═════════════════════════ AI quotas ════════════════════════════════════════
def test_todays_ai_calls_are_capped_by_the_plan(managed, answers):
    c, uid = managed("apprentice")
    upload(c, DOC[0], _pdf(0))
    assert c.post("/chat", json={"question": "atp?", "session_id": DOC[0], "history": []}).status_code == 200
    _used(uid, calls=25)
    r = c.post("/chat", json={"question": "atp?", "session_id": DOC[0], "history": []})
    e = r.json()["error"]
    assert r.status_code == 429 and e["code"] == "plan_limit" and e["action"] == "plans"
    assert (e["details"]["limit"], e["details"]["allowed"], e["details"]["upgrade_tier"]) == ("ai_calls_day", 25, "scholar")
    assert e["details"]["resets_at"].endswith("00:00:00+00:00")
    # a fight already started is never cut off: its next question isn't quota-checked
    assert c.get("/arena/battles/nope/question").status_code != 429


def test_this_months_tokens_are_capped_by_the_plan(managed, answers):
    c, uid = managed("scholar")
    upload(c, DOC[0], _pdf(0))
    _used(uid, tokens=3_000_000)
    r = c.post("/chat", json={"question": "atp?", "session_id": DOC[0], "history": []})
    assert r.status_code == 429 and r.json()["error"]["details"]["limit"] == "tokens_month"
    assert r.json()["error"]["details"]["upgrade_tier"] == "sage"


def test_calls_on_your_own_key_are_outside_the_quota(make_user, monkeypatch, answers):
    monkeypatch.setenv("DEFAULT_TIER", "apprentice")
    c, uid = make_user()                                                  # registered with a key of their own
    upload(c, DOC[0], _pdf(0))
    _used(uid, calls=60, byok_calls=60)
    assert c.post("/chat", json={"question": "atp?", "session_id": DOC[0], "history": []}).status_code == 200
    u = c.get("/account/usage").json()
    assert u["used"]["ai_calls_day"] == 0 and u["own_key"] == {"active": True, "exempt": True, "calls_today": 60, "tokens_month": 0}
    monkeypatch.setenv("QUOTA_BYOK_EXEMPT", "0")
    assert c.post("/chat", json={"question": "atp?", "session_id": DOC[0], "history": []}).status_code == 429


# ═════════════════════════ documents, size, courses ═════════════════════════
def test_the_plan_caps_documents_and_deleting_one_frees_a_place(managed):
    c, uid = managed("apprentice")
    for i in range(3):
        assert upload(c, DOC[i], _pdf(i)).status_code == 202
    r = upload(c, DOC[3], _pdf(3))
    assert r.status_code == 403 and r.json()["error"]["details"]["limit"] == "documents"
    assert "3 documents" in r.json()["error"]["message"]
    assert upload(c, DOC[0], _pdf(5)).status_code == 202                  # replacing one adds nothing
    assert c.delete(f"/documents/{DOC[1]}").status_code == 200
    assert c.get(f"/documents/{DOC[1]}").status_code == 404
    assert upload(c, DOC[3], _pdf(3)).status_code == 202
    other, _ = managed("apprentice")
    assert other.delete(f"/documents/{DOC[0]}").status_code == 404        # not theirs


def test_the_plan_caps_pdf_size(managed, monkeypatch):
    c, _ = managed("apprentice")
    monkeypatch.setenv("PLAN_LIMITS_JSON", '{"apprentice": {"pdf_mb": 0}}')
    r = upload(c, DOC[0], _pdf(0))
    assert r.status_code == 403 and r.json()["error"]["details"]["limit"] == "pdf_mb"


def test_the_plan_caps_courses(managed, monkeypatch):
    c, _ = managed("sage")
    monkeypatch.setenv("PLAN_LIMITS_JSON", '{"sage": {"courses": 1}}')
    assert c.post("/courses", json={"name": "One"}).status_code == 200
    r = c.post("/courses", json={"name": "Two"})
    assert r.status_code == 403 and r.json()["error"]["details"]["upgrade_tier"] == "archmage"


# ═════════════════════════ invite codes ═════════════════════════════════════
def _signup(client, name, **extra):
    return client.post("/auth/register", json={"email": f"{name}@example.com", "password": "correct-horse-1",
                                               "username": name, "full_name": name.title(),
                                               "api_key": "sk-test-aaaaaaaa", "llm_provider": "gemini", **extra})


def test_invite_only_signup_needs_a_code_that_grants_its_plan(client, monkeypatch):
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: (True, ""))
    monkeypatch.setenv("INVITE_ONLY", "1")
    monkeypatch.setenv("DEFAULT_TIER", "apprentice")
    assert client.get("/plans").json()["invite_only"] is True
    r = _signup(client, "nocode")
    assert r.status_code == 400 and r.json()["error"]["code"] == "invite_invalid" and r.json()["error"]["details"]["field"] == "invite_code"
    assert _signup(client, "badcode", invite_code="NOPE-1234").status_code == 400
    code = state.invite_service.create("sage", days=30, max_uses=1)["code"]
    r = _signup(client, "tester", invite_code=code.lower())
    assert r.status_code == 200, r.text
    uid = r.json()["user_id"]
    plan = state.store.fetchone("SELECT * FROM user_plans WHERE user_id = ?", (uid,))
    assert plan["tier"] == "sage" and plan["source"] == "invite" and plan["source_ref"] == code
    left = datetime.fromisoformat(plan["expires_at"]) - datetime.now(timezone.utc)
    assert timedelta(days=29) < left <= timedelta(days=30)
    assert state.invite_service.get(code)["uses"] == 1
    r = _signup(client, "late", invite_code=code)
    assert r.status_code == 400 and "used up" in r.json()["error"]["message"]


def test_redeeming_a_code_upgrades_extends_and_never_downgrades(managed):
    c, uid = managed("apprentice")
    svc = state.invite_service
    scholar = svc.create("scholar", days=10, max_uses=5)["code"]
    r = c.post("/account/redeem", json={"code": scholar})
    assert r.status_code == 200 and r.json()["tier"] == "scholar" and r.json()["source"] == "invite"
    assert c.post("/account/redeem", json={"code": scholar}).json()["error"]["message"] == "You've already used this invite code."
    more = svc.create("scholar", days=10, max_uses=5)["code"]
    exp = datetime.fromisoformat(c.post("/account/redeem", json={"code": more}).json()["expires_at"])
    assert exp - datetime.now(timezone.utc) > timedelta(days=19)          # the time adds up
    svc.set_plan(uid, "sage", days=5)
    low = svc.create("scholar", days=10)["code"]
    assert "lower plan" in c.post("/account/redeem", json={"code": low}).json()["error"]["message"]
    gone = svc.create("archmage", days=10)["code"]
    svc.revoke(gone)
    assert c.post("/account/redeem", json={"code": gone}).status_code == 400
    old = svc.create("archmage", days=10, valid_days=1)["code"]
    state.store.execute("UPDATE invite_codes SET expires_at = '2000-01-01T00:00:00+00:00' WHERE code = ?", (old,))
    assert "expired" in c.post("/account/redeem", json={"code": old}).json()["error"]["message"]


# ═════════════════════════ the server's own AI ══════════════════════════════
def test_signup_without_a_provider_uses_the_servers_ai_when_it_has_one(client, monkeypatch):
    monkeypatch.setattr("routers.auth.managed_ai_available", lambda: False)
    r = client.post("/auth/register", json={"email": "m@example.com", "password": "correct-horse-1", "username": "managed1",
                                            "full_name": "M", "llm_provider": ""})
    assert r.status_code == 400 and r.json()["error"]["details"]["field"] == "llm_provider"
    monkeypatch.setattr("routers.auth.managed_ai_available", lambda: True)
    r = client.post("/auth/register", json={"email": "m@example.com", "password": "correct-horse-1", "username": "managed1",
                                            "full_name": "M", "llm_provider": ""})
    assert r.status_code == 200, r.text
    assert client.get("/auth/api-key").json()["has_key"] is False
    assert client.get("/account/usage").json()["own_key"]["active"] is False


def test_a_user_can_go_back_to_the_servers_ai(make_user, monkeypatch):
    c, uid = make_user()
    monkeypatch.setattr("routers.auth.managed_ai_available", lambda: False)
    assert c.delete("/auth/api-key").status_code == 400
    monkeypatch.setattr("routers.auth.managed_ai_available", lambda: True)
    assert c.delete("/auth/api-key").status_code == 200
    assert c.get("/auth/api-key").json()["has_key"] is False


# ═════════════════════════ the usage page ═══════════════════════════════════
def test_the_usage_page_shows_the_plan_limits_and_use(managed):
    c, uid = managed("scholar")
    upload(c, DOC[0], _pdf(0))
    _used(uid, calls=12, tokens=4000)
    u = c.get("/account/usage").json()
    assert (u["tier"], u["tier_name"], u["source"], u["expires_at"]) == ("scholar", "Scholar", "default", None)
    assert u["limits"]["ai_calls_day"] == 150
    assert u["used"] == {"ai_calls_day": 12, "tokens_month": 4000, "documents": 1, "courses": 0}
    assert u["history"][-1]["ai_calls"] == 12 and u["resets"]["tokens_month"].endswith("T00:00:00+00:00")
    assert c.get("/account/usage").status_code == 200
    from conftest import api_client
    import main
    assert api_client(main.app).get("/account/usage").status_code == 401


# ═════════════════════════ the admin command ════════════════════════════════
def test_the_admin_command_makes_codes_and_sets_plans(managed):
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("admin_cli", Path(__file__).resolve().parent.parent / "scripts" / "admin.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    lines = []
    cli.main(["invite", "create", "--tier", "sage", "--code", "beta-sage", "--days", "14", "--uses", "3"], out=lines.append)
    assert lines[-1].startswith("BETA-SAGE  sage  14 days  3 uses")
    cli.main(["invite", "list"], out=lines.append)
    assert "BETA-SAGE" in lines[-1] and "0/3 used" in lines[-1]
    _, uid = managed("apprentice")
    email = state.db.get_user_by_id(uid)["email"]
    cli.main(["plan", "set", email, "archmage", "--days", "7"], out=lines.append)
    assert entitlements.tier_for(uid) == "archmage"
    cli.main(["plan", "clear", str(uid)], out=lines.append)
    assert entitlements.tier_for(uid) == "apprentice"
    cli.main(["invite", "revoke", "BETA-SAGE"], out=lines.append)
    assert lines[-1] == "revoked"
    with pytest.raises(SystemExit):
        cli.main(["plan", "set", "nobody@example.com", "sage"], out=lines.append)
