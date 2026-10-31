"""Economy / progression: exploits and race conditions found in the audit."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

from services.progression.catalog import flatten_catalog
from services.progression.ownership import can_use_item
from services.progression.progression import level_from_total_xp
from services.progression.time_utils import utc_today, iso_date
import state

ITEMS = {i["id"]: i for i in flatten_catalog()}
PAID_BONUS_ITEMS = [i for i in ITEMS.values()
                    if int(i["price"]) > 0 and i["type"] in ("armor", "headgear", "weapon", "pet", "title")
                    and (i.get("bonus") or {}).get("xp_pct")]


_give_n = {"n": 0}


def _grant(store, uid, xp=0, coins=0):
    """Test setup: give XP / coins the only legitimate way - as a ledger event."""
    _give_n["n"] += 1
    return store.record_reward_event(uid, "adjustment", xp, coins, "test-setup",
                                     idempotency_key=f"test-grant:{uid}:{_give_n['n']}")


def _give(store, uid, level=10, coins=0):
    store.ensure_user(uid)
    xp = 0
    while level_from_total_xp(xp) < level:
        xp += 50
    _grant(store, uid, xp=xp, coins=coins)


def _parallel(n, fn):
    with ThreadPoolExecutor(n) as ex:
        return list(ex.map(lambda _: fn(), range(n)))


# ═════════════════════════ equipment exploit ═════════════════════════════════
def test_catalog_has_paid_bonus_items_to_test_with():
    assert PAID_BONUS_ITEMS, "test setup: expected at least one paid item with an xp bonus"


def test_cannot_equip_unowned_paid_items_via_avatar_update(make_user, app_module):
    c, uid = make_user()
    item = PAID_BONUS_ITEMS[0]
    slot = item["type"]
    r = c.post("/avatar/update", json={"equipped": {slot: item["id"]}})
    assert r.status_code == 200
    assert r.json()["equipped"].get(slot) != item["id"]
    assert state.reward_service.get_equipment_bonuses(str(uid))["xp_pct"] == 0


def test_cannot_equip_unowned_paid_items_via_hero_forge(make_user, app_module):
    c, uid = make_user()
    item = next(i for i in PAID_BONUS_ITEMS if i["type"] == "weapon") if any(i["type"] == "weapon" for i in PAID_BONUS_ITEMS) else PAID_BONUS_ITEMS[0]
    body = {"outfit_id": "", "headgear": "", "weapon": "", "pet": ""}
    key = {"armor": "outfit_id"}.get(item["type"], item["type"])
    if item["type"] in ("title",):
        pytest.skip("hero forge has no title slot")
    body[key] = item["id"]
    r = c.post("/avatar/hero-forge-save", json=body)
    assert r.status_code == 200
    eq = r.json()["equipped"]
    assert item["id"] not in eq.values()


def test_owned_and_free_items_can_be_equipped(make_user, app_module):
    c, uid = make_user()
    r = c.post("/avatar/hero-forge-save", json={"outfit_id": "armor_gi_white", "headgear": "hat_headband_red"})
    eq = r.json()["equipped"]
    assert eq["armor"] == "armor_gi_white" and eq["headgear"] == "hat_headband_red"
    # starter tee (hero forge's default) is allowed
    assert c.post("/avatar/hero-forge-save", json={"outfit_id": "armor_shirt_basic"}).json()["equipped"]["armor"] == "armor_shirt_basic"
    # a paid item becomes equippable once owned
    item = PAID_BONUS_ITEMS[0]
    state.store.modify_avatar(str(uid), lambda eq, ow: ow.append(item["id"]))
    slot = item["type"]
    r = c.post("/avatar/update", json={"equipped": {slot: item["id"]}})
    assert r.json()["equipped"][slot] == item["id"]


def test_wrong_slot_and_junk_values_are_ignored(make_user):
    c, _ = make_user()
    r = c.post("/avatar/update", json={"equipped": {"weapon": "armor_gi_white", "bogus_slot": "x",
                                                    "skin_id": "<script>alert(1)</script>"}})
    eq = r.json()["equipped"]
    assert "weapon" not in eq and "bogus_slot" not in eq
    assert eq.get("skin_id", "") != "<script>alert(1)</script>"


def test_previously_saved_fake_equipment_no_longer_pays_out(make_user, app_module):
    """Rows written by the old unchecked endpoints must not keep giving bonuses."""
    c, uid = make_user()
    item = PAID_BONUS_ITEMS[0]
    state.store.modify_avatar(str(uid), lambda eq, ow: eq.update({item["type"]: item["id"]}))
    assert state.reward_service.get_equipment_bonuses(str(uid))["xp_pct"] == 0


def test_shop_equip_rejects_potions_and_unowned(make_user, app_module):
    c, uid = make_user()
    _give(state.store, str(uid), level=10, coins=10_000)
    assert c.post("/shop/equip", json={"item_id": "potion_health_small"}).json()["ok"] is False
    assert c.post("/shop/equip", json={"item_id": PAID_BONUS_ITEMS[0]["id"]}).json()["ok"] is False


# ═════════════════════════ rewards ═══════════════════════════════════════════
def test_daily_cap_cannot_be_beaten_by_parallel_requests(make_user, app_module):
    c, uid = make_user()
    rs = state.reward_service
    results = _parallel(30, lambda: rs.award(str(uid), "boss_defeat", accuracy=1, difficulty=2, combo_count=10))
    assert sum(1 for r in results if r["ok"]) == 5          # DAILY_CAPS["boss_defeat"]
    assert sum(1 for r in results if r.get("capped")) == 25
    prog = state.store.get_progress(str(uid))
    assert prog["total_bosses_defeated"] == 5               # no lost counter updates either


def test_parallel_awards_do_not_lose_xp(make_user, app_module):
    c, uid = make_user()
    rs = state.reward_service
    results = _parallel(10, lambda: rs.award(str(uid), "quiz_complete", accuracy=1.0))
    ok = [r for r in results if r["ok"]]
    expected = sum(r["xp_gained"] for r in ok)
    prog = state.store.get_progress(str(uid))
    # XP == sum of every award (+ any achievement bonuses), never less
    assert prog["total_xp"] >= expected
    assert prog["current_level"] == level_from_total_xp(prog["total_xp"])


@pytest.mark.parametrize("bad", [
    dict(accuracy=-5, difficulty=-9, combo_count=-4),
    dict(accuracy=1e9, difficulty=1e9, combo_count=10**9),
    dict(accuracy=float("nan"), difficulty=float("inf"), combo_count=1),
])
def test_client_supplied_numbers_are_clamped(make_user, app_module, bad):
    c, uid = make_user()
    r = state.reward_service.award(str(uid), "boss_defeat", **bad)
    assert r["ok"] and 0 <= r["xp_gained"] < 5000 and r["coins_gained"] < 2000


def test_award_endpoint_rejects_unknown_actions_and_nan_json(make_user):
    c, uid = make_user()
    assert c.post("/rewards/award", json={"action_type": "free_money"}).status_code == 400
    r = c.post("/rewards/award", content='{"action_type":"quiz_complete","accuracy":NaN}',
               headers={"content-type": "application/json"})
    assert r.status_code in (403, 422)        # never a reward: quiz_complete isn't claimable from the browser


def test_achievement_xp_updates_the_level(make_user, app_module):
    """Bonus XP from achievements used to leave current_level stale."""
    c, uid = make_user()
    store = state.store
    store.ensure_user(str(uid))
    out = _grant(store, str(uid), xp=5_000)
    assert out["level"] == level_from_total_xp(5_000) > 1
    assert store.get_progress(str(uid))["current_level"] == out["level"]


# ═════════════════════════ shop races ════════════════════════════════════════
def test_parallel_purchases_cannot_double_spend(make_user, app_module, monkeypatch):
    import time
    c, uid = make_user()
    store, shop = state.store, state.shop_service
    price = int(ITEMS["potion_health_small"]["price"])
    _give(store, str(uid), level=10, coins=price)             # exactly one purchase affordable

    # Simulate a slow database: widens the check→spend window so an unprotected
    # implementation reliably double-spends (a busy production server does the same).
    real = store.get_avatar
    monkeypatch.setattr(store, "get_avatar", lambda *a, **k: (time.sleep(0.03), real(*a, **k))[1])
    results = _race(10, lambda i: shop.purchase(str(uid), "potion_health_small"))
    assert sum(1 for r in results if r["ok"]) == 1
    assert store.get_progress(str(uid))["coins"] == 0
    assert store.get_inventory_quantity(str(uid), "potion_health_small") == 1


def test_purchase_survives_concurrent_hud_polling(make_user, app_module):
    """get_shop_state's free-item grant used to overwrite a purchase made in between."""
    c, uid = make_user()
    store, shop = state.store, state.shop_service
    _give(store, str(uid), level=30, coins=1_000_000)
    target = next(i["id"] for i in ITEMS.values()
                  if not i.get("consumable") and int(i["price"]) > 0 and int(i["level_required"]) <= 30 and i["type"] == "armor")

    def poll(): return shop.get_shop_state(str(uid))
    with ThreadPoolExecutor(8) as ex:
        polls = [ex.submit(poll) for _ in range(40)]
        buy = ex.submit(lambda: shop.purchase(str(uid), target))
        [p.result() for p in polls]
        assert buy.result()["ok"]
    owned = json.loads(store.get_avatar(str(uid))["owned_json"])
    assert target in owned


def test_stack_limit_holds_under_parallel_purchases(make_user, app_module):
    c, uid = make_user()
    store, shop = state.store, state.shop_service
    _give(store, str(uid), level=10, coins=100_000)
    _parallel(12, lambda: shop.purchase(str(uid), "potion_health_small"))
    assert store.get_inventory_quantity(str(uid), "potion_health_small") <= 3


def test_potion_cannot_be_used_twice_in_parallel(make_user, app_module):
    c, uid = make_user()
    store = state.store
    store.ensure_user(str(uid))
    store.add_inventory_item(str(uid), "potion_xp_boost", quantity=1)
    codes = _parallel(8, lambda: c.post("/items/use", json={"item_id": "potion_xp_boost"}).status_code)
    assert codes.count(200) == 1
    assert store.get_inventory_quantity(str(uid), "potion_xp_boost") == 0


def test_daily_once_only_purchase_is_not_burned_by_failed_buy(make_user, app_module):
    c, uid = make_user()
    store, shop = state.store, state.shop_service
    _give(store, str(uid), level=20, coins=0)
    assert shop.purchase(str(uid), "potion_streak_shield")["ok"] is False     # can't afford
    _grant(store, str(uid), coins=10_000)
    assert shop.purchase(str(uid), "potion_streak_shield")["ok"] is True       # allowance not consumed by the failure
    assert shop.purchase(str(uid), "potion_streak_shield")["ok"] is False      # but only once per day


# ═════════════════════════ quests ════════════════════════════════════════════
def test_quest_cannot_be_claimed_twice_in_parallel(make_user, app_module):
    c, uid = make_user()
    store, quests = state.store, state.quest_service
    store.ensure_user(str(uid))
    q = quests.get_or_create_daily_quests(str(uid))[0]
    store.execute("UPDATE daily_quests SET completed = 1, current_count = target_count "
                  "WHERE user_id = ? AND quest_type = ?", (str(uid), q["quest_type"]))
    results = _parallel(10, lambda: c.post("/daily-quests/claim", json={"quest_type": q["quest_type"]}).json())
    assert sum(1 for r in results if r.get("ok")) == 1


def test_quest_counter_does_not_lose_increments(make_user, app_module):
    c, uid = make_user()
    store, quests = state.store, state.quest_service
    store.ensure_user(str(uid))
    qs = quests.get_or_create_daily_quests(str(uid))
    target = max(qs, key=lambda x: x["target_count"])
    store.execute("UPDATE daily_quests SET target_count = 1000, current_count = 0 "
                  "WHERE user_id = ? AND quest_type = ?", (str(uid), target["quest_type"]))
    _parallel(50, lambda: quests._inc_quest(str(uid), target["quest_type"], 1))
    row = store.fetchone("SELECT current_count FROM daily_quests WHERE user_id = ? AND quest_type = ?",
                         (str(uid), target["quest_type"]))
    assert row["current_count"] == 50


# ═════════════════════════ streaks ═══════════════════════════════════════════
def _set_streak(store, uid, days_ago, streak, freezes):
    store.ensure_user(uid)
    store.update_progress_fields(uid, {"streak_days": streak, "streak_freezes": freezes,
                                       "last_active_utc": iso_date(utc_today() - timedelta(days=days_ago))})


def test_one_freeze_does_not_cover_a_two_week_absence(make_user, app_module):
    c, uid = make_user()
    from services.progression.streak_service import StreakService
    s = StreakService(state.store)
    _set_streak(state.store, str(uid), days_ago=15, streak=30, freezes=1)
    assert s.update_streak_for_activity(str(uid)) == 1
    assert state.store.get_progress(str(uid))["streak_freezes"] == 1     # kept, not burned for nothing


def test_freezes_cover_exactly_the_missed_days(make_user, app_module):
    c, uid = make_user()
    from services.progression.streak_service import StreakService
    s = StreakService(state.store)
    _set_streak(state.store, str(uid), days_ago=3, streak=10, freezes=2)   # missed 2 whole days
    assert s.update_streak_for_activity(str(uid)) == 10
    assert state.store.get_progress(str(uid))["streak_freezes"] == 0


def test_normal_streak_increment(make_user, app_module):
    c, uid = make_user()
    from services.progression.streak_service import StreakService
    _set_streak(state.store, str(uid), days_ago=1, streak=4, freezes=0)
    assert StreakService(state.store).update_streak_for_activity(str(uid)) == 5


# ═════════════════════════ arena plumbing ════════════════════════════════════
def test_arena_inputs_are_validated(make_user, pdf_bytes):
    c, _ = make_user()
    sid = "66666666-6666-4666-8666-666666666666"
    c.post("/upload", files={"file": ("a.pdf", pdf_bytes, "application/pdf")}, data={"session_id": sid})
    assert c.post("/arena/battles", json={"topic": "mitosis", "session_id": sid, "difficulty": "godmode"}).status_code == 400
    assert c.post("/arena/battles", json={"topic": " ", "session_id": sid, "difficulty": "easy"}).status_code == 400


def test_ttl_cache_is_bounded(app_module):
    cache = state.TTLCache(ttl_seconds=60, max_items=5)
    for i in range(50):
        cache.set(f"k{i}", i)
    assert len(cache._data) <= 5


# ═════════════ forced-collision tests on the atomic primitives ═══════════════
def _race(n, fn):
    """Release n threads at the same instant so the race window is actually hit."""
    import threading
    barrier = threading.Barrier(n)

    def run(i):
        barrier.wait()
        return fn(i)
    with ThreadPoolExecutor(n) as ex:
        return list(ex.map(run, range(n)))


def test_spend_coins_is_all_or_nothing_under_a_forced_race(make_user, app_module):
    c, uid = make_user()
    store = state.store
    store.ensure_user(str(uid))
    _grant(store, str(uid), coins=100)
    wins = [r["applied"] for r in _race(20, lambda i: store.record_reward_event(
        str(uid), "shop_purchase", 0, -100, "x", idempotency_key=f"spend-race:{uid}:{i}"))]
    assert wins.count(True) == 1
    assert store.get_progress(str(uid))["coins"] == 0


def test_claim_row_has_exactly_one_winner_under_a_forced_race(make_user, app_module):
    c, uid = make_user()
    store, quests = state.store, state.quest_service
    store.ensure_user(str(uid))
    q = quests.get_or_create_daily_quests(str(uid))[0]
    today = iso_date(utc_today())
    store.execute("UPDATE daily_quests SET completed = 1 WHERE user_id = ? AND quest_type = ?",
                  (str(uid), q["quest_type"]))
    wins = _race(20, lambda i: store.claim_quest_row(str(uid), today, q["quest_type"]))
    assert wins.count(True) == 1


def test_inventory_consume_has_exactly_one_winner_under_a_forced_race(make_user, app_module):
    c, uid = make_user()
    store = state.store
    store.ensure_user(str(uid))
    store.add_inventory_item(str(uid), "fifty_fifty", quantity=1)
    wins = _race(20, lambda i: store.consume_inventory_item(str(uid), "fifty_fifty"))
    assert wins.count(True) == 1
    assert store.get_inventory_quantity(str(uid), "fifty_fifty") == 0


def test_daily_cap_reservation_under_a_forced_race(make_user, app_module):
    c, uid = make_user()
    store = state.store
    store.ensure_user(str(uid))
    wins = _race(30, lambda i: store.reserve_daily_action(str(uid), "2030-01-01", "boss_defeat", 5))
    assert wins.count(True) == 5


def test_achievement_unlock_pays_once_under_a_forced_race(make_user, app_module):
    c, uid = make_user()
    store = state.store
    store.ensure_user(str(uid))
    aid = store.get_achievements()[0]["achievement_id"]
    wins = _race(20, lambda i: store.unlock_achievement(str(uid), aid))
    assert wins.count(True) == 1
