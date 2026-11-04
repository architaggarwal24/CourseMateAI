"""Phase 3 / Stage 1: the pixel champion is the avatar, and the shop's cosmetics are its skins.

The champion and the skin loadout live on the server (user_avatar.champion_id + equipped_json); the browser only
caches them. Skins are the same shop items as before (same ids, prices, bonuses and owners), so the arena gear and
study bonuses keep working with no data changes beyond migration 0008.
"""
import json
import shutil
import sqlite3

import pytest

from database.migrate import DATABASE_FILENAME, MIGRATIONS_DIR, migrate
from services.progression.champions import CHAMPIONS, DEFAULT_CHAMPION, LOADOUT_SLOTS, champion_from_legacy
import state


# ── the API ───────────────────────────────────────────────────────────────────
def test_a_new_account_has_the_default_champion_not_yet_chosen(make_user):
    c, _ = make_user()
    r = c.get("/avatar/champion")
    assert r.status_code == 200
    body = r.json()
    assert body["champion_id"] == DEFAULT_CHAMPION
    assert body["chosen"] is False
    assert body["champions"] == list(CHAMPIONS)
    assert set(body["loadout"]) == set(LOADOUT_SLOTS)


def test_choosing_a_champion_is_saved_on_the_account(make_user):
    c, uid = make_user()
    r = c.put("/avatar/champion", json={"champion_id": "mira"})
    assert r.status_code == 200
    assert r.json()["champion_id"] == "mira" and r.json()["chosen"] is True
    # it is the account's, not the browser's: a fresh read (any device) sees it
    again = c.get("/avatar/champion").json()
    assert again["champion_id"] == "mira" and again["chosen"] is True
    assert state.store.get_avatar(str(uid))["champion_id"] == "mira"


def test_an_unknown_champion_is_refused_and_nothing_changes(make_user):
    c, _ = make_user()
    c.put("/avatar/champion", json={"champion_id": "vex"})
    r = c.put("/avatar/champion", json={"champion_id": "naruto"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "unknown_champion"
    assert c.get("/avatar/champion").json()["champion_id"] == "vex"


def test_champion_and_loadout_save_together_with_ownership_enforced(make_user):
    c, uid = make_user()
    paid = "armor_knight_gold"                     # not owned
    r = c.put("/avatar/champion", json={
        "champion_id": "thorne",
        "loadout": {"armor": "armor_gi_red", "headgear": "hat_headband_blue", "weapon": "weapon_hammer", "pet": "none"},
    })
    assert r.status_code == 200
    lo = r.json()["loadout"]
    assert r.json()["champion_id"] == "thorne"
    assert lo["armor"] == "armor_gi_red" and lo["headgear"] == "hat_headband_blue"   # free items
    assert lo["weapon"] is None                                                          # not owned: skipped
    # a paid skin goes on once it is owned, and a slot can be emptied
    state.store.modify_avatar(str(uid), lambda eq, ow: ow.append(paid))
    lo = c.put("/avatar/champion", json={"champion_id": "thorne", "loadout": {"armor": paid, "headgear": "none"}}).json()["loadout"]
    assert lo["armor"] == paid and lo["headgear"] is None


def test_skins_in_the_wrong_slot_are_ignored(make_user):
    c, _ = make_user()
    lo = c.put("/avatar/champion", json={"champion_id": "asha", "loadout": {"weapon": "armor_gi_white", "title": "hat_wizard", "aura": "x"}}).json()["loadout"]
    assert lo["weapon"] is None
    assert "aura" not in lo and "title" not in lo


def test_shop_and_avatar_reads_carry_the_champion(make_user):
    c, _ = make_user()
    c.put("/avatar/champion", json={"champion_id": "brak"})
    assert c.get("/shop").json()["champion_id"] == "brak"
    av = c.get("/avatar").json()
    assert av["champion_id"] == "brak" and av["champion_chosen"] is True


def test_the_hero_forge_endpoint_is_retired(make_user):
    c, _ = make_user()
    assert c.post("/avatar/hero-forge-save", json={"outfit_id": "armor_gi_white"}).status_code in (404, 405)


def test_equipping_armor_no_longer_writes_the_legacy_outfit_key(make_user):
    c, uid = make_user()
    assert c.post("/shop/equip", json={"item_id": "armor_gi_blue"}).json()["ok"] is True
    eq = json.loads(state.store.get_avatar(str(uid))["equipped_json"])
    assert eq == {"armor": "armor_gi_blue"}


def test_champion_endpoints_need_a_login(client):
    assert client.get("/avatar/champion").status_code == 401
    assert client.put("/avatar/champion", json={"champion_id": "kaien"}).status_code == 401


def test_gear_bonuses_still_follow_the_equipped_skins(make_user):
    """A skin is the same item: wearing it still gives its arena gear (the server snapshots it at battle start)."""
    from services.arena_service import gear_for
    c, uid = make_user()
    item = "weapon_hammer"
    state.store.modify_avatar(str(uid), lambda eq, ow: ow.append(item))
    c.put("/avatar/champion", json={"champion_id": "kaien", "loadout": {"weapon": item}})
    eq = json.loads(state.store.get_avatar(str(uid))["equipped_json"])
    assert gear_for(eq)["damage_pct"] > 0


# ── the legacy mapping ────────────────────────────────────────────────────────
@pytest.mark.parametrize("body,expected", [
    ("male_default", "kaien"), ("male_athletic", "brak"), ("female_elegant", "mira"), ("female_sporty", "asha"),
    ("", None), ("bogus", None), (None, None),
])
def test_old_forge_body_types_map_to_a_champion(body, expected):
    assert champion_from_legacy(body) == expected


def _seed_v7(tmp_path, rows):
    db = tmp_path / DATABASE_FILENAME
    old = tmp_path / "v7"
    old.mkdir()
    for f in sorted(MIGRATIONS_DIR.glob("000[1-7]_*.sql")):
        shutil.copy(f, old / f.name)
    assert migrate(db, old) == [1, 2, 3, 4, 5, 6, 7]
    c = sqlite3.connect(db)
    now = "2026-11-01T00:00:00+00:00"
    for uid, eq in rows:
        c.execute("INSERT INTO users (id, username, email, full_name, password_hash, created_at) VALUES (?, ?, ?, 'U', 'x', ?)",
                  (uid, f"u{uid}", f"u{uid}@x.test", now))
        c.execute("INSERT INTO user_avatar (user_id, equipped_json, owned_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)",
                  (uid, eq, now, now))
    c.commit()
    c.close()
    return db


def test_migration_0008_maps_existing_users_sensibly(tmp_path):
    db = _seed_v7(tmp_path, [
        (1, json.dumps({"body_type_id": "female_elegant", "skin_id": "tan", "hair_id": "violet", "outfit_id": "armor_robe_blue",
                        "armor": "armor_robe_blue", "headgear": "hat_wizard", "pet": "pet_owl", "title": "title_scholar"})),
        (2, json.dumps({"outfit_id": "armor_gi_red"})),                 # only the legacy outfit key
        (3, "{}"),
        (4, "not json"),
    ])
    assert migrate(db) == [8, 9, 10, 11, 12, 13, 14]
    c = sqlite3.connect(db)
    rows = {uid: (champ, set_at, eq) for uid, champ, set_at, eq in c.execute("SELECT user_id, champion_id, champion_set_at, equipped_json FROM user_avatar")}
    # 1: a forge body type picks the nearest champion; skins and title are kept; forge-only keys are gone
    assert rows[1][0] == "mira" and rows[1][1] is None
    assert json.loads(rows[1][2]) == {"armor": "armor_robe_blue", "headgear": "hat_wizard", "pet": "pet_owl", "title": "title_scholar"}
    # 2: the legacy outfit key becomes the armor slot
    assert rows[2][0] is None and json.loads(rows[2][2]) == {"armor": "armor_gi_red"}
    # 3, 4: nothing to map; a broken row is left alone rather than lost
    assert rows[3][0] is None and json.loads(rows[3][2]) == {}
    assert rows[4][2] == "not json"


def test_a_mapped_champion_is_not_marked_chosen(make_user):
    """The browser's own Phase-2 pick may still replace a mapped champion once (the client syncs it if not chosen)."""
    c, uid = make_user()
    state.store.execute("UPDATE user_avatar SET champion_id = 'asha' WHERE user_id = ?", (str(uid),))
    body = c.get("/avatar/champion").json()
    assert body["champion_id"] == "asha" and body["chosen"] is False
