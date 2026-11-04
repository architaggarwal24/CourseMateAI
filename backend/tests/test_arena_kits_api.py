"""Champion kits, ultimates and champion progression through the real API (rules: tests/test_arena_kits.py)."""
import json

import state
from core_brains import kits
from services.progression.catalog import flatten_catalog
from arena_v2_support import (  # noqa: F401  (fixtures)
    _clean_v2_tables, _plain_pacing, llm, intents, hero,
    start, question, truth, wrong, answer, play, row, set_intent, set_focus, hit,
)

REAL_KITS = True                     # the champion kits are what these tests are about


def as_champion(c, cid):
    assert c.put("/avatar/champion", json={"champion_id": cid}).status_code == 200


def kit_of(bid):
    return json.loads(row(bid)["boss_json"])["kit"]


def fill_meter(bid):
    boss = json.loads(row(bid)["boss_json"])
    boss["kit"]["meter"] = kits.METER_MAX
    state.store.execute("UPDATE arena_battles SET boss_json = ? WHERE id = ?", (json.dumps(boss), bid))


def ult(c, bid, status=200):
    r = c.post(f"/arena/battles/{bid}/ultimate")
    assert r.status_code == status, r.text
    return r.json()


# ── kit in state, meter ───────────────────────────────────────────────────────
def test_the_battle_carries_the_champions_kit_and_meter(hero):
    c, _ = hero
    as_champion(c, "mira")
    battle = start(c)["battle"]
    assert battle["kit"]["champion"] == "mira" and battle["kit"]["meter"] == 0 and not battle["kit"]["ready"]
    assert battle["kit"]["ultimate"]["name"] == "Arcane Library"


def test_the_meter_fills_from_right_answers_and_the_ultimate_needs_it_full(hero, llm):
    c, _ = hero
    llm.boss_hp = 220                                         # survives four right answers
    bid = start(c, "nightmare")["battle_id"]
    assert ult(c, bid, 409)["error"]["code"] == "ultimate_not_ready"
    meters = [play(c, bid, True)["battle"]["kit"]["meter"] for _ in range(3)]
    assert meters == [25, 50, 85]                            # +25, +25, +35 at combo 3
    out = play(c, bid, True)
    assert out["battle"]["kit"]["ready"] and out["kit_meter_gained"] == 15     # capped at 100
    data = ult(c, bid)
    assert data["ultimate"]["name"] == "Ninth Page Cut" and data["battle"]["kit"]["meter"] == 0
    assert ult(c, bid, 409)["error"]["code"] == "ultimate_not_ready"


def test_the_champion_is_snapshotted_when_the_battle_starts(hero):
    c, _ = hero
    as_champion(c, "thorne")
    bid = start(c)["battle_id"]
    as_champion(c, "vex")
    assert kit_of(bid)["champion"] == "thorne"


# ── passives ──────────────────────────────────────────────────────────────────
def test_kaien_riposte_hits_back_on_a_right_guard(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_intent(bid, "attack")
    out = play(c, bid, True, "guard")
    assert out["blocked"] and out["riposte"] == int(hit(1) * kits.RIPOSTE_RATIO)
    assert out["damage_dealt"] == out["riposte"] and out["battle"]["boss"]["hp"] == 160 - out["riposte"]


def test_asha_jabs_further(hero):
    c, _ = hero
    as_champion(c, "asha")
    bid = start(c)["battle_id"]
    out = play(c, bid, True, "jab")
    assert out["damage_dealt"] == int(hit(1) * kits.ASHA_JAB_MULT)


def test_brak_doubles_the_combo_bonus(hero):
    c, _ = hero
    as_champion(c, "brak")
    bid = start(c)["battle_id"]
    first = play(c, bid, True)
    assert first["damage_dealt"] == int((25 + 6) * 1.3)      # combo 1: 6 instead of 3


def test_thorne_cuts_a_blow_to_a_third(hero):
    c, _ = hero
    as_champion(c, "thorne")
    bid = start(c)["battle_id"]
    set_intent(bid, "heavy")                                  # 4 on hard
    assert play(c, bid, True)["damage_taken"] == 1            # 4 // 3 (not 4 // 2)


def test_vex_shadowstep_dodges_a_blow(hero, monkeypatch):
    c, _ = hero
    monkeypatch.setattr(kits, "VEX_DODGE", (1, 1, 1, 1))
    as_champion(c, "vex")
    bid = start(c)["battle_id"]
    out = play(c, bid, False)
    assert out["damage_taken"] == 0 and out["dodged"] and out["kit"]["events"][0]["type"] == "shadowstep"


def test_mira_gets_her_spell_focus_back_on_a_right_answer(hero):
    c, _ = hero
    as_champion(c, "mira")
    bid = start(c)["battle_id"]
    set_focus(bid, 2)
    q = question(c, bid)["question"]
    c.post(f"/arena/battles/{bid}/spells", json={"spell": "insight"})
    assert row(bid)["focus"] == 1
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["kit"]["refund"] == 1 and out["focus"] == 3   # 1 left + 1 back + 1 for the right answer


# ── ultimates ─────────────────────────────────────────────────────────────────
def test_kaien_ninth_page_cut(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    fill_meter(bid)
    ult(c, bid)
    out = play(c, bid, True)
    assert out["damage_dealt"] == int(hit(1) * kits.CUT_MULT) and kit_of(bid)["armed"] is None


def test_thorne_last_chapter_heals_and_blocks(hero):
    c, _ = hero
    as_champion(c, "thorne")
    bid = start(c)["battle_id"]
    play(c, bid, False)
    play(c, bid, False)
    hp = row(bid)["player_hp"]
    fill_meter(bid)
    data = ult(c, bid)
    assert data["battle"]["player"]["hp"] == min(row(bid)["player_max_hp"], hp + 3)
    set_intent(bid, "heavy")
    out = play(c, bid, False)
    assert out["damage_taken"] == 0 and out["blocked"]


def test_mira_arcane_library_casts_both_spells_on_the_open_question(hero):
    c, _ = hero
    as_champion(c, "mira")
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    fill_meter(bid)
    data = ult(c, bid)
    assert len(data["question"]["options"]) == 2 and data["question"]["timewarped"] and row(bid)["focus"] == 0
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["damage_dealt"] == int(hit(1) * kits.LIBRARY_MULT)


def test_asha_dawn_wall_halves_blows_for_two_turns(hero):
    c, _ = hero
    as_champion(c, "asha")
    bid = start(c)["battle_id"]
    fill_meter(bid)
    ult(c, bid)
    set_intent(bid, "heavy")
    assert play(c, bid, False)["damage_taken"] == 2          # 4, halved by the wall


def test_vex_vanish_makes_two_blows_miss(hero):
    c, _ = hero
    as_champion(c, "vex")
    bid = start(c)["battle_id"]
    fill_meter(bid)
    ult(c, bid)
    takes = [play(c, bid, False)["damage_taken"] for _ in range(2)]
    assert takes == [0, 0]


# ── progression ───────────────────────────────────────────────────────────────
def test_a_won_battle_pays_champion_xp_and_unlocks_mastery_skins(hero):
    c, uid = hero
    state.store.execute("INSERT INTO champion_progress (user_id, champion_id, xp, level, updated_at) "
                        "VALUES (?, 'kaien', 240, 2, '2026-01-01')", (uid,))
    bid = start(c, "easy")["battle_id"]
    out = None
    for _ in range(40):
        out = play(c, bid, True)
        if out["battle"]["status"] != "active":
            break
    assert out["battle"]["status"] == "won"
    champ = out["battle"]["result"]["champion"]
    assert champ["id"] == "kaien" and champ["xp_gained"] == kits.battle_xp(out["battle"]["correct"], True)
    assert champ["level"] >= 3 and champ["leveled_up"] and "mastery_kaien_outfit" in champ["unlocked"]
    owned = json.loads(state.store.get_avatar(str(uid))["owned_json"])
    assert "mastery_kaien_outfit" in owned
    prog = c.get("/avatar/champion").json()["progress"]["kaien"]
    assert prog["kit"]["ultimate"]["name"] == "Ninth Page Cut" and prog["mastery"][0]["id"] == "mastery_kaien_outfit"
    assert prog["level"] == champ["level"] and prog["xp"] == champ["xp"] and prog["next_level_xp"] > prog["xp"]


def test_a_lost_battle_still_pays_xp_for_the_right_answers(hero):
    c, uid = hero
    bid = start(c)["battle_id"]
    play(c, bid, True)
    out = c.post(f"/arena/battles/{bid}/forfeit").json()
    assert out["battle"]["result"]["champion"]["xp_gained"] == 10
    assert c.get("/avatar/champion").json()["progress"]["kaien"]["xp"] == 10


def test_mastery_skins_are_never_sold_or_given_away_free(hero):
    c, uid = hero
    shop = c.get("/shop").json()
    mastery = [i for i in shop["items"] if i.get("mastery")]
    assert len(mastery) == 18 and not any(i["owned"] for i in mastery)
    r = c.post("/shop/purchase", json={"item_id": "mastery_kaien_outfit"}).json()
    assert r["ok"] is False
    assert c.post("/shop/equip", json={"item_id": "mastery_kaien_outfit"}).json()["ok"] is False


def test_only_its_champion_wears_a_mastery_skin(hero):
    c, uid = hero
    state.store.modify_avatar(str(uid), lambda eq, ow: ow.append("mastery_asha_outfit"))
    as_champion(c, "kaien")
    assert c.post("/shop/equip", json={"item_id": "mastery_asha_outfit"}).json()["ok"] is False
    as_champion(c, "asha")
    assert c.post("/shop/equip", json={"item_id": "mastery_asha_outfit"}).json()["ok"] is True
    # switching champion takes another champion's mastery skin off
    lo = c.put("/avatar/champion", json={"champion_id": "brak"}).json()["loadout"]
    assert lo["armor"] is None


def test_the_catalog_has_three_mastery_skins_per_champion():
    by = {}
    for it in flatten_catalog():
        if it.get("mastery"):
            by.setdefault(it["mastery"]["champion"], []).append((it["type"], it["mastery"]["level"]))
    assert set(by) == set(kits.KITS)
    for champ, entries in by.items():
        assert sorted(entries) == [("armor", 3), ("headgear", 6), ("weapon", 10)], champ
