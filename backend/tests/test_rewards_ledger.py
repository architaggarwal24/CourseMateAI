"""Auditable rewards (append-only reward_events + cached totals) and per-user local days."""
import shutil
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest

import state
from database.migrate import MIGRATIONS_DIR, migrate
from services.progression.db import SQLiteStore
from services.progression.progression import level_from_total_xp
from services.progression import time_utils

PASSWORD = "correct-horse-1"


def _race(n, fn):
    """Release n threads at the same instant so the race window is actually hit."""
    barrier = threading.Barrier(n)

    def run(i):
        barrier.wait()
        return fn(i)
    with ThreadPoolExecutor(n) as ex:
        return list(ex.map(run, range(n)))


def _assert_ledger_matches_cache(uid):
    """The cached totals are exactly what the events add up to."""
    cached = state.store.get_progress(str(uid))
    derived = state.store.ledger_totals(str(uid))
    assert (cached["total_xp"], cached["coins"], cached["current_level"]) == \
           (derived["total_xp"], derived["coins"], derived["level"])
    return derived


def _events(uid, kind=None):
    sql = "SELECT * FROM reward_events WHERE user_id = ?" + (" AND kind = ?" if kind else "") + " ORDER BY id"
    return state.store.fetchall(sql, (str(uid), kind) if kind else (str(uid),))


def _grant(uid, xp=0, coins=0, key=None):
    return state.store.record_reward_event(str(uid), "adjustment", xp, coins, "test-setup",
                                           idempotency_key=key or f"grant:{uid}:{xp}:{coins}")


def _complete_a_quest(uid):
    quests = state.quest_service.get_or_create_daily_quests(str(uid))
    q = quests[0]
    state.store.execute("UPDATE daily_quests SET completed = 1, current_count = target_count "
                        "WHERE user_id = ? AND quest_type = ? AND quest_date_utc = ?",
                        (str(uid), q["quest_type"], q["quest_date_utc"]))
    return q


# ═════════════════════════ the ledger itself ═════════════════════════════════
def test_an_event_updates_the_cached_totals_and_level_in_one_step(make_user):
    c, uid = make_user()
    out = _grant(uid, xp=5_000, coins=40)
    assert out["applied"] and out["level"] == level_from_total_xp(5_000) > 1
    assert _assert_ledger_matches_cache(uid) == {"total_xp": 5_000, "coins": 40, "level": out["level"], "events": 1}
    ev = _events(uid)[0]
    assert (ev["kind"], ev["xp"], ev["coins"], ev["source_id"]) == ("adjustment", 5_000, 40, "test-setup")
    assert ev["idempotency_key"] and ev["created_at"]


def test_the_same_idempotency_key_never_applies_twice(make_user):
    c, uid = make_user()
    assert _grant(uid, coins=10, key="once")["applied"]
    again = _grant(uid, coins=10, key="once")
    assert again == {"applied": False, "reason": "duplicate", "total_xp": 0, "coins": 10, "level": 1}
    assert _assert_ledger_matches_cache(uid)["coins"] == 10 and len(_events(uid)) == 1


def test_an_unaffordable_event_is_refused_and_leaves_no_trace(make_user):
    c, uid = make_user()
    _grant(uid, coins=30)
    out = state.store.record_reward_event(str(uid), "shop_purchase", 0, -31, "x", idempotency_key=f"poor:{uid}")
    assert out["applied"] is False and out["reason"] == "insufficient_funds"
    assert len(_events(uid)) == 1 and _assert_ledger_matches_cache(uid)["coins"] == 30
    # the refused attempt did not burn its key: it can be retried once the user can pay
    _grant(uid, coins=5, key=f"topup:{uid}")
    assert state.store.record_reward_event(str(uid), "shop_purchase", 0, -31, "x", idempotency_key=f"poor:{uid}")["applied"]


def test_events_cannot_be_edited_or_deleted(make_user):
    c, uid = make_user()
    _grant(uid, xp=10)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        state.store.execute("UPDATE reward_events SET xp = 999999 WHERE user_id = ?", (str(uid),))
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        state.store.execute("DELETE FROM reward_events WHERE user_id = ?", (str(uid),))
    assert _assert_ledger_matches_cache(uid)["total_xp"] == 10


def test_xp_coins_and_level_can_no_longer_be_written_in_place(make_user):
    c, uid = make_user()
    state.store.ensure_user(str(uid))
    for field in ("total_xp", "coins", "current_level"):
        with pytest.raises(ValueError):
            state.store.update_progress_fields(str(uid), {field: 1})
    assert not hasattr(state.store, "add_xp_coins") and not hasattr(state.store, "spend_coins")


def test_a_failure_inside_a_transaction_rolls_back_event_and_totals(make_user):
    c, uid = make_user()
    _grant(uid, coins=5)
    with pytest.raises(RuntimeError):
        with state.store.transaction():
            _grant(uid, xp=100, coins=100, key=f"doomed:{uid}")
            raise RuntimeError("boom")
    assert len(_events(uid)) == 1
    assert _assert_ledger_matches_cache(uid)["coins"] == 5
    assert state.store.get_progress(str(uid))["total_xp"] == 0


def test_deleting_the_account_removes_its_events(make_user):
    c, uid = make_user()
    _grant(uid, xp=10)
    assert c.delete("/auth/delete-account").status_code == 200
    assert state.store.fetchall("SELECT 1 FROM reward_events WHERE user_id = ?", (str(uid),)) == []


def test_existing_balances_become_an_opening_event_when_the_migration_runs(tmp_path):
    older = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS_DIR, older)
    (older / "0004_reward_events_and_timezones.sql").unlink()
    (older / "0005_quizzes.sql").unlink()                      # (a gap would be rejected)
    (older / "0006_arena_battles.sql").unlink()
    (older / "0007_arena_v2.sql").unlink()
    db = tmp_path / "x.db"
    assert migrate(db, older) == [1, 2, 3]
    c = sqlite3.connect(db)
    c.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('a@x.io','a','A','h')")
    c.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('b@x.io','b','B','h')")
    c.execute("INSERT INTO user_progress (user_id, total_xp, coins, created_at, updated_at) VALUES (1, 700, 55, '2026-01-01', '2026-01-01')")
    c.execute("INSERT INTO user_progress (user_id, created_at, updated_at) VALUES (2, '2026-01-01', '2026-01-01')")
    c.commit(); c.close()
    assert migrate(db) == [4, 5, 6, 7]
    c = sqlite3.connect(db)
    assert c.execute("SELECT user_id, kind, xp, coins FROM reward_events").fetchall() == [(1, "opening_balance", 700, 55)]
    assert [r[0] for r in c.execute("SELECT timezone FROM users")] == ["UTC", "UTC"]      # backfill


# ═════════════════════════ concurrent claims ═════════════════════════════════
def test_one_key_raced_from_many_threads_and_two_server_processes_pays_once(make_user):
    """Independent SQLiteStore objects share nothing but the file - like two worker processes."""
    c, uid = make_user()
    stores = [SQLiteStore(state.store.db_path) for _ in range(4)]
    wins = _race(24, lambda i: stores[i % 4].record_reward_event(
        str(uid), "quest_claim", 100, 20, "q", idempotency_key=f"u{uid}:quest:2030-01-01:q")["applied"])
    assert wins.count(True) == 1
    d = _assert_ledger_matches_cache(uid)
    assert (d["total_xp"], d["coins"], d["events"]) == (100, 20, 1)


def test_quest_cannot_be_claimed_twice_in_parallel_and_pays_one_event(make_user):
    c, uid = make_user()
    q = _complete_a_quest(uid)
    results = _race(12, lambda i: c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json())
    assert sum(1 for r in results if r.get("ok")) == 1
    paid = _events(uid, "quest_claim")
    assert len(paid) == 1 and paid[0]["source_id"] == q["quest_type"]
    assert (paid[0]["xp"], paid[0]["coins"]) == (q["reward_xp"], q["reward_coins"])
    quest_gain = _assert_ledger_matches_cache(uid)
    assert quest_gain["total_xp"] >= q["reward_xp"]


def test_claim_response_shape_is_unchanged(make_user):
    c, uid = make_user()
    q = _complete_a_quest(uid)
    body = c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json()
    assert body["ok"] is True and body["xp_gained"] == q["reward_xp"] and body["coins_gained"] == q["reward_coins"]
    assert {"source", "totals", "level_up", "new_achievements"} <= set(body)
    assert c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json() == \
        {"ok": False, "reason": "Already claimed"}


def test_a_claimed_quest_cannot_be_paid_again_even_if_its_row_is_reset(make_user):
    """The idempotency key, not just the 'claimed' flag, stops a second payout."""
    c, uid = make_user()
    q = _complete_a_quest(uid)
    assert c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json()["ok"]
    state.store.execute("UPDATE daily_quests SET claimed = 0 WHERE user_id = ? AND quest_type = ?",
                        (str(uid), q["quest_type"]))
    assert c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json() == \
        {"ok": False, "reason": "Already claimed"}
    assert len(_events(uid, "quest_claim")) == 1
    _assert_ledger_matches_cache(uid)


def test_parallel_purchases_write_exactly_one_event(make_user):
    c, uid = make_user()
    from services.progression.catalog import flatten_catalog
    price = int(next(i for i in flatten_catalog() if i["id"] == "potion_health_small")["price"])
    _grant(uid, xp=20_000, coins=price)                                 # level >= 5, coins for exactly ONE potion
    results = _race(12, lambda i: state.shop_service.purchase(str(uid), "potion_health_small"))
    assert sum(1 for r in results if r["ok"]) == 1
    buys = _events(uid, "shop_purchase")
    assert len(buys) == 1 and (buys[0]["coins"], buys[0]["source_id"]) == (-price, "potion_health_small")
    assert _assert_ledger_matches_cache(uid)["coins"] == 0


def test_a_non_consumable_is_paid_for_once_even_across_processes(make_user):
    c, uid = make_user()
    from services.progression.catalog import flatten_catalog
    item = next(i for i in flatten_catalog() if not i.get("consumable") and int(i["price"]) > 0
                and int(i["level_required"]) <= 30 and i["type"] == "armor")
    _grant(uid, xp=500_000, coins=int(item["price"]) * 5)
    other = SQLiteStore(state.store.db_path)
    wins = _race(10, lambda i: (state.shop_service if i % 2 else type(state.shop_service)(other)).purchase(str(uid), item["id"]))
    assert all(r["ok"] for r in wins)                                   # "Already owned" is still ok:true
    assert len(_events(uid, "shop_purchase")) == 1
    assert _assert_ledger_matches_cache(uid)["coins"] == int(item["price"]) * 4


def test_daily_cap_and_events_agree_under_parallel_awards(make_user):
    c, uid = make_user()
    results = _race(20, lambda i: state.reward_service.award(str(uid), "boss_defeat", accuracy=1, difficulty=2, combo_count=10))
    assert sum(1 for r in results if r["ok"]) == 5                      # DAILY_CAPS["boss_defeat"]
    boss = _events(uid, "boss_defeat")
    assert len(boss) == 5 and len({e["idempotency_key"] for e in boss}) == 5
    assert sum(e["xp"] for e in boss) == sum(r["xp_gained"] for r in results if r["ok"])
    _assert_ledger_matches_cache(uid)


def test_every_reward_path_writes_an_event_and_the_totals_still_add_up(make_user):
    c, uid = make_user()
    rs = state.reward_service
    for action in ("quiz_complete", "arena_round_complete", "boss_defeat", "chat_bundle_5",
                   "notes_generation", "flashcard_complete"):
        assert rs.award(str(uid), action, accuracy=1.0)["ok"]
    q = _complete_a_quest(uid)
    assert c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json()["ok"]
    kinds = {e["kind"] for e in _events(uid)}
    assert {"quiz_complete", "arena_round_complete", "boss_defeat", "quest_claim"} <= kinds
    assert "achievement" in kinds                                       # first quiz / boss unlock achievements
    d = _assert_ledger_matches_cache(uid)
    assert d["total_xp"] > 0 and d["events"] == len(_events(uid))


def test_achievements_pay_once_even_when_checked_in_parallel(make_user):
    c, uid = make_user()
    state.store.ensure_user(str(uid))
    state.store.increment_progress(str(uid), "total_quizzes_completed", 5)
    _race(10, lambda i: state.achievement_service.check_and_unlock(str(uid)))
    ach = _events(uid, "achievement")
    assert ach and len({e["source_id"] for e in ach}) == len(ach)       # one event per achievement
    unlocked = state.store.get_unlocked_achievement_ids(str(uid))
    assert {e["source_id"] for e in ach} == unlocked
    _assert_ledger_matches_cache(uid)


# ═════════════════════════ per-user time zones ═════════════════════════════════
def _login_with(c, uid, tz):
    user = state.db.get_user_by_id(uid)
    r = c.post("/auth/login", json={"email": user["email"], "password": PASSWORD, "timezone": tz})
    assert r.status_code == 200, r.text


def _tz(uid):
    return state.db.get_user_by_id(uid)["timezone"]


def test_timezone_is_stored_at_signup_and_refreshed_at_login(app_module, monkeypatch):
    from conftest import api_client
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: (True, ""))
    state.limiter.reset()
    with api_client(app_module.app) as c:
        r = c.post("/auth/register", json={
            "email": "tzuser@example.com", "password": PASSWORD, "username": "tzuser", "full_name": "Tz User",
            "api_key": "sk-test-tz-aaaaaaaa", "llm_provider": "gemini", "timezone": "Asia/Kolkata"})
        assert r.status_code == 200, r.text
        uid = r.json()["user_id"]
        assert _tz(uid) == "Asia/Kolkata"
        _login_with(c, uid, "Europe/Berlin")
        assert _tz(uid) == "Europe/Berlin"


def test_missing_or_bogus_timezone_never_breaks_login_or_changes_the_stored_one(make_user):
    c, uid = make_user()
    assert _tz(uid) == "UTC"                                            # no timezone sent at signup -> UTC
    _login_with(c, uid, "Asia/Kolkata")
    for bad in (None, "", "Mars/Olympus", "../../etc/passwd", "x" * 500):
        state.limiter.reset()                                           # login is limited to 5 per minute
        _login_with(c, uid, bad)
        assert _tz(uid) == "Asia/Kolkata"


# 2026-03-10 18:00 UTC = 23:30 in Kolkata (still Mar 10 there);  19:45 UTC = 01:15 Mar 11 in Kolkata
LATE_EVENING_UTC = datetime(2026, 3, 10, 18, 0, tzinfo=timezone.utc)
ONE_AM_KOLKATA_UTC = datetime(2026, 3, 10, 19, 45, tzinfo=timezone.utc)


@pytest.fixture()
def clock(monkeypatch):
    now = {"t": LATE_EVENING_UTC}
    monkeypatch.setattr(time_utils, "utc_now", lambda: now["t"])
    return now


def test_local_today_follows_the_users_zone():
    t = ONE_AM_KOLKATA_UTC
    assert t.astimezone(timezone.utc).date().isoformat() == "2026-03-10"
    orig = time_utils.utc_now
    time_utils.utc_now = lambda: t
    try:
        assert time_utils.local_today("Asia/Kolkata").isoformat() == "2026-03-11"
        assert time_utils.local_today("UTC").isoformat() == "2026-03-10"
        assert time_utils.local_today("America/Los_Angeles").isoformat() == "2026-03-10"
        assert time_utils.local_today("not/a-zone").isoformat() == "2026-03-10"      # falls back to UTC
    finally:
        time_utils.utc_now = orig


def test_a_user_in_kolkata_studying_at_0100_local_is_on_the_new_local_day(make_user, clock):
    ist_c, ist = make_user("kolkata")
    utc_c, utc = make_user("greenwich")
    _login_with(ist_c, ist, "Asia/Kolkata")
    rs, store = state.reward_service, state.store

    def study(uid):
        return rs.award(str(uid), "boss_defeat", accuracy=1.0)

    # 23:30 on Mar 10 (local) - both users use up today's whole boss cap and start a streak
    for uid in (ist, utc):
        assert all(study(uid)["ok"] for _ in range(5))
        assert study(uid)["capped"] is True
        assert store.get_progress(str(uid))["streak_days"] == 1
        assert store.get_progress(str(uid))["last_active_utc"] == "2026-03-10"
    assert {q["quest_date_utc"] for q in state.quest_service.get_or_create_daily_quests(str(ist))} == {"2026-03-10"}

    # 01:15 on Mar 11 in Kolkata (19:45 UTC, still Mar 10 in UTC)
    clock["t"] = ONE_AM_KOLKATA_UTC
    first = study(ist)
    assert first["ok"] is True and first["streak_days"] == 2           # new local day: cap reset, streak +1
    assert store.get_progress(str(ist))["last_active_utc"] == "2026-03-11"
    assert {q["quest_date_utc"] for q in state.quest_service.get_or_create_daily_quests(str(ist))} == {"2026-03-11"}
    assert store.get_daily_action(str(ist), "2026-03-11", "boss_defeat")["count"] == 1
    assert store.get_daily_action(str(ist), "2026-03-10", "boss_defeat")["count"] == 5
    # the event for that reward is keyed by the LOCAL day
    assert _events(ist, "boss_defeat")[-1]["source_id"] == "2026-03-11:1"

    # the UTC user, at the very same instant, is still on Mar 10: capped, same streak
    again = study(utc)
    assert again["capped"] is True
    assert store.get_progress(str(utc))["streak_days"] == 1
    assert {q["quest_date_utc"] for q in state.quest_service.get_or_create_daily_quests(str(utc))} == {"2026-03-10"}
    _assert_ledger_matches_cache(ist)
    _assert_ledger_matches_cache(utc)


def test_shop_once_a_day_limit_uses_the_local_day(make_user, clock):
    c, uid = make_user("shopper")
    _login_with(c, uid, "Asia/Kolkata")
    _grant(uid, xp=20_000, coins=100_000)
    shop = state.shop_service
    assert shop.purchase(str(uid), "potion_streak_shield")["ok"] is True
    assert shop.purchase(str(uid), "potion_streak_shield")["ok"] is False      # once per local day
    clock["t"] = ONE_AM_KOLKATA_UTC                                            # new local day in Kolkata
    assert shop.purchase(str(uid), "potion_streak_shield")["ok"] is True
    _assert_ledger_matches_cache(uid)
