"""Game content (shop, quests, achievements, level & reward tables) lives in backend/content/*.json.

* the API output is pinned to a snapshot taken BEFORE the data moved out of Python (no content changes);
* the loader validates the files with Pydantic and a broken file stops startup with a readable message.
"""
import json
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import state
from services.progression.progression import level_from_total_xp, xp_to_next_level

BACKEND = Path(__file__).resolve().parent.parent
SNAPSHOT = BACKEND / "tests" / "snapshots" / "game_content.json"
LEVELS = (1, 5, 10, 15, 40)
_n = {"n": 0}


def _grant(uid, xp=0, coins=0):
    _n["n"] += 1
    state.store.record_reward_event(str(uid), "adjustment", xp, coins, "snapshot",
                                    idempotency_key=f"snapshot:{uid}:{_n['n']}")


def _user_at(make_user, level, coins=0, name=None):
    c, uid = make_user(name)
    xp = 0
    while level_from_total_xp(xp) < level:
        xp += 50
    _grant(uid, xp=xp, coins=coins)
    return c, uid


def _quests(c):
    """GET /daily-quests with the volatile bits (user id, today's date) masked."""
    out = []
    for q in c.get("/daily-quests").json()["quests"]:
        q = dict(q)
        q.pop("user_id", None)
        q["quest_date_utc"] = "<today>"
        out.append(q)
    return out


def collect(make_user, client):
    """Everything the task pins, as plain JSON-able data."""
    snap = {}
    c1, _ = _user_at(make_user, 1, name="snap_l1")
    c40, _ = _user_at(make_user, 40, coins=10_000_000, name="snap_l40")
    snap["shop_level_1"] = c1.get("/shop").json()
    snap["shop_level_40"] = c40.get("/shop").json()
    snap["achievements_guest"] = client.get("/achievements").json()
    snap["achievements_user"] = c1.get("/achievements").json()
    snap["achievements_db_rows"] = state.store.get_achievements()

    quests = {}
    for level in LEVELS:
        c, _ = _user_at(make_user, level, name=f"snap_q{level}")
        random.seed(20261011 + level)                   # the daily set is a random pick: pin it
        quests[str(level)] = _quests(c)
    snap["daily_quests"] = quests
    snap["quest_pool"] = {str(l): state.quest_service._quest_pool(l) for l in LEVELS}

    from services.progression import reward_service as rs
    from services.progression.catalog import flatten_catalog
    from services.progression.ownership import catalog_item
    snap["items_flat"] = flatten_catalog()
    snap["item_lookup"] = {i["id"]: catalog_item(i["id"]) for i in flatten_catalog()}
    snap["xp_to_next_level"] = [xp_to_next_level(l) for l in range(1, 201)]
    snap["level_from_xp"] = {str(x): level_from_total_xp(x) for x in
                             (0, 99, 100, 349, 350, 1299, 1300, 5000, 20_000, 100_000, 1_000_000, 10**9)}
    snap["base_rewards"] = {k: list(v) for k, v in rs.BASE_REWARDS.items()}
    snap["daily_caps"] = dict(rs.DAILY_CAPS)
    snap["tier_multiplier"] = [rs.tier_multiplier(l) for l in range(1, 61)]
    svc = rs.RewardService.__new__(rs.RewardService)
    snap["calculated_rewards"] = {
        f"{a}|{lvl}|{acc}": [*svc.calculate_rewards(a, lvl, accuracy=acc, difficulty=1.5, streak_days=3, combo_count=4)[:2]]
        for a in rs.BASE_REWARDS for lvl in (1, 6, 11, 40) for acc in (0.0, 0.5, 1.0)
    }
    return json.loads(json.dumps(snap))


def test_api_output_is_identical_to_the_snapshot_taken_before_the_move(make_user, client):
    got = collect(make_user, client)
    if os.environ.get("UPDATE_CONTENT_SNAPSHOT") == "1":      # only to re-pin after a deliberate content change
        SNAPSHOT.write_text(json.dumps(got, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    want = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert got.keys() == want.keys()
    for key in want:
        assert got[key] == want[key], f"{key} changed"


# ═════════════════════════ validation: a broken file fails fast and says where ═══════════════════════
from game_content import CONTENT_DIR, ContentError, load_content  # noqa: E402


def _copy_content(tmp_path):
    d = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, d)
    return d


def _edit(d, filename, fn):
    path = d / filename
    data = json.loads(path.read_text(encoding="utf-8"))
    fn(data)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _first_item(data):
    return data["tiers"][0]["items"][0]


def test_the_shipped_content_is_valid_and_complete():
    c = load_content()
    assert len(c.shop.tiers) == 19 and sum(len(t.items) for t in c.shop.tiers) == 57
    assert len(c.achievements.achievements) == 19 and len(c.levels.xp_to_next_level) == 200
    assert set(c.rewards.actions) == {"arena_round_complete", "boss_defeat", "quiz_complete",
                                      "chat_bundle_5", "notes_generation", "flashcard_complete",
                                      "expedition_complete"}
    assert len(c.relics.relics) == 12


def _set(key, value):
    return lambda data: _first_item(data).__setitem__(key, value)


BROKEN = [
    ("unknown item type", "shop.json", _set("type", "shield"),
     ["shop.json", "tiers[0].items[0].type", 'got "shield"']),
    ("duplicate item id", "shop.json", lambda d: d["tiers"][1]["items"][0].__setitem__("id", _first_item(d)["id"]),
     ["shop.json", "duplicate item id", "armor_gi_white"]),
    ("typo in a field name", "shop.json", lambda d: _first_item(d).__setitem__("pricee", 5),
     ["shop.json", "tiers[0].items[0].pricee", "unknown field"]),
    ("price as text", "shop.json", _set("price", "50"), ["shop.json", "tiers[0].items[0].price"]),
    ("negative price", "shop.json", _set("price", -1), ["shop.json", "tiers[0].items[0].price"]),
    ("missing name", "shop.json", lambda d: _first_item(d).pop("name"), ["tiers[0].items[0].name", "missing"]),
    ("item type not matching its tier", "shop.json", _set("type", "weapon"),
     ["armor_gi_white", "type 'weapon'", "category 'armor'"]),
    ("tier with an unknown category", "shop.json", lambda d: d["tiers"][0].__setitem__("category", "cape"),
     ["tier 'armor_fighting_gi'", "category 'cape'"]),
    ("consumable without effect", "shop.json", _set("consumable", True), ["consumable but has no effect"]),
    ("unknown consumable effect", "shop.json",
     lambda d: next(i for t in d["tiers"] for i in t["items"] if i.get("effect")).__setitem__("effect", "explode"),
     ["unknown effect 'explode'"]),
    ("duplicate achievement id", "achievements.json",
     lambda d: d["achievements"][1].__setitem__("id", d["achievements"][0]["id"]),
     ["achievements.json", "duplicate achievement id", "first_quiz"]),
    ("unknown unlock type", "achievements.json",
     lambda d: d["achievements"][0].__setitem__("unlock_type", "total_hugs"),
     ["achievements.json", "unknown unlock_type 'total_hugs'"]),
    ("unknown achievement tier", "achievements.json",
     lambda d: d["achievements"][0].__setitem__("tier", "mythic"), ["achievements[0].tier", "mythic"]),
    ("duplicate quest type", "quests.json",
     lambda d: d["groups"][1]["quests"][0].__setitem__("quest_type", d["groups"][0]["quests"][0]["quest_type"]),
     ["quests.json", "duplicate quest_type", "ask_questions"]),
    ("daily group without min_level", "quests.json", lambda d: d["groups"][0].pop("min_level"),
     ["needs min_level"]),
    ("zero quest target", "quests.json", lambda d: d["groups"][0]["quests"][0].__setitem__("target_count", 0),
     ["groups[0].quests[0].target_count"]),
    ("missing reward action", "rewards.json", lambda d: d["actions"].pop("boss_defeat"),
     ["rewards.json", "missing action", "boss_defeat"]),
    ("unknown reward action", "rewards.json", lambda d: d["actions"].__setitem__("hug", {"xp": 1, "coins": 1, "daily_cap": 1}),
     ["unknown action", "hug"]),
    ("zero level cost", "levels.json", lambda d: d["xp_to_next_level"].__setitem__(3, 0),
     ["levels.json", "at least 1", "[4]"]),
    ("unsupported schema_version", "levels.json", lambda d: d.__setitem__("schema_version", 2),
     ["levels.json", "schema_version 2 is not supported"]),
]


@pytest.mark.parametrize("filename,edit,expected", [b[1:] for b in BROKEN], ids=[b[0] for b in BROKEN])
def test_a_broken_content_file_raises_a_readable_error(tmp_path, filename, edit, expected):
    d = _copy_content(tmp_path)
    _edit(d, filename, edit)
    with pytest.raises(ContentError) as exc:
        load_content(d)
    msg = str(exc.value)
    for needle in expected:
        assert needle in msg, msg
    assert "Traceback" not in msg and "pydantic" not in msg.lower()


def test_invalid_json_and_missing_files_are_named_with_their_position(tmp_path):
    d = _copy_content(tmp_path)
    text = (d / "shop.json").read_text(encoding="utf-8")
    (d / "shop.json").write_text(text[:300], encoding="utf-8")           # cut off mid-file
    (d / "levels.json").unlink()
    with pytest.raises(ContentError) as exc:
        load_content(d)
    msg = str(exc.value)
    assert "shop.json: not valid JSON" in msg and "line" in msg and "column" in msg
    assert "levels.json: file not found" in msg
    assert "start the server again" in msg


def test_every_problem_is_reported_at_once_not_one_per_restart(tmp_path):
    d = _copy_content(tmp_path)
    _edit(d, "shop.json", _set("type", "shield"))
    _edit(d, "achievements.json", lambda data: data["achievements"][0].__setitem__("tier", "mythic"))
    _edit(d, "rewards.json", lambda data: data["actions"].pop("quiz_complete"))
    msg = str(pytest.raises(ContentError, load_content, d).value)
    assert "shop.json" in msg and "achievements.json" in msg and "rewards.json" in msg


def _import_state(backend_copy, tmp_path):
    env = {**os.environ, "COURSEMATE_DATA_DIR": str(tmp_path / "data"), "COURSEMATE_UPLOAD_DIR": str(tmp_path / "up"),
           "COURSEMATE_SKIP_WARMUP": "1"}
    return subprocess.run([sys.executable, "-c", "import state"], cwd=backend_copy, env=env,
                          capture_output=True, text=True, timeout=180)


@pytest.fixture()
def backend_copy(tmp_path):
    dest = tmp_path / "backend"
    shutil.copytree(BACKEND, dest, ignore=shutil.ignore_patterns(
        "tests", "data", "uploads", "static", "__pycache__", ".venv", "venv", ".pytest_cache", "*.db*"))
    return dest


def test_the_server_refuses_to_start_on_broken_content_with_a_readable_message(backend_copy, tmp_path):
    ok = _import_state(backend_copy, tmp_path)
    assert ok.returncode == 0, ok.stderr                                  # control: the untouched copy starts

    _edit(backend_copy / "content", "shop.json", _set("type", "shield"))
    broken = _import_state(backend_copy, tmp_path)
    assert broken.returncode == 1
    assert "ERROR: Game content" in broken.stderr
    assert "shop.json: tiers[0].items[0].type" in broken.stderr and 'got "shield"' in broken.stderr
    assert "Traceback" not in broken.stderr


def test_a_content_file_with_bad_json_also_stops_startup(backend_copy, tmp_path):
    (backend_copy / "content" / "quests.json").write_text('{"schema_version": 1, "groups": [', encoding="utf-8")
    broken = _import_state(backend_copy, tmp_path)
    assert broken.returncode == 1
    assert "quests.json: not valid JSON" in broken.stderr and "Traceback" not in broken.stderr


# ═════════════════════════ achievements are seeded from the file ═════════════════════════════
def test_achievements_table_matches_the_file_and_follows_edits(tmp_path):
    from database.migrate import migrate
    from services.progression.db import SQLiteStore

    db = tmp_path / "x.db"
    migrate(db)
    store = SQLiteStore(str(db))
    achievements = load_content().achievements.achievements
    store.seed_achievements([a.as_row() for a in achievements])
    rows = store.get_achievements()
    assert [r["achievement_id"] for r in rows] == [a.id for a in achievements]
    first = rows[0]
    assert (first["unlock_threshold"], first["reward_xp"], first["tier"]) == (achievements[0].threshold, achievements[0].reward_xp, achievements[0].tier)

    store.seed_achievements([a.as_row() for a in achievements])                 # restart: nothing changes
    assert store.get_achievements() == rows

    edited = achievements[0].model_copy(update={"reward_xp": 12345, "name": "Renamed"})
    store.seed_achievements([edited.as_row()])                                  # a content edit reaches existing rows
    assert store.get_achievements()[0]["reward_xp"] == 12345 and store.get_achievements()[0]["name"] == "Renamed"
    assert len(store.get_achievements()) == len(achievements)


def test_the_app_database_was_seeded_from_the_file(app_module):
    file_rows = [a.as_row() for a in state.game_content.achievements.achievements]
    db_rows = state.store.get_achievements()
    assert [{k: r[k] for k in file_rows[0]} for r in db_rows] == file_rows


# ═════════════════════════ what the frontend now reads from the API ══════════════════════════
def test_shop_api_carries_the_item_metadata_the_frontend_used_to_duplicate(make_user):
    c, _ = _user_at(make_user, 40, coins=1_000_000)
    shop = c.get("/shop").json()
    assert {i["id"] for i in shop["items"] if i["arena_only"]} == {"potion_health_small", "fifty_fifty"}
    cats = shop["category_status"]
    assert list(cats) == ["headgear", "armor", "weapon", "pet", "potion", "title"]      # the shop's display order
    for info in cats.values():
        assert info["name"] and info["icon"] and info["description"] and info["unlock_level"] >= 1
    # the level at which a category's tab opens = its cheapest paid item's level (what the page derives)
    opens = {cat: min(i["level_required"] for i in shop["items"] if i["category"] == cat and i["price"] > 0) for cat in cats}
    assert opens == {"armor": 5, "headgear": 7, "weapon": 10, "pet": 20, "potion": 5, "title": 30}
