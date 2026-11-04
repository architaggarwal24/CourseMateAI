"""Phase 3 / Stage 2: champion kits (core_brains/kits.py) - a passive and an ultimate per champion - rule by rule."""
import random

import pytest

from core_brains import kits as K

CHAMPS = ("kaien", "asha", "brak", "mira", "vex", "thorne")


def kt(champion, *, state=None, move="strike", correct=True, combo=1, damaging=True, difficulty="hard", seed=1):
    st = state if state is not None else K.init(champion)
    return K.KitTurn(champion=champion, difficulty=difficulty, state=st, move=move, correct=correct, combo=combo,
                     damaging=damaging, rng=random.Random(seed))


def test_every_champion_has_a_kit_with_words_for_the_hud():
    assert set(K.KITS) == set(CHAMPS)
    for cid, kit in K.KITS.items():
        assert kit.passive_name and kit.passive_text and kit.ultimate_name and kit.ultimate_text, cid
        hud = K.hud(K.init(cid))
        assert hud["champion"] == cid and hud["meter"] == 0 and hud["ready"] is False
    assert K.init("nobody")["champion"] == "kaien"           # an unknown id fights as the default champion


# ── the meter ─────────────────────────────────────────────────────────────────
def test_the_meter_charges_on_right_answers_and_more_on_a_streak():
    assert K.meter_gain(True, 1) == 25 and K.meter_gain(True, 3) == 35 and K.meter_gain(False, 0) == 0
    st = K.init("kaien")
    for combo in (1, 2, 3):
        K.charge(st, True, combo)
    assert st["meter"] == 85 and not K.ready(st)
    K.charge(st, True, 4)
    assert st["meter"] == 100 and K.ready(st)                  # capped


def test_an_ultimate_needs_a_full_meter_and_empties_it():
    st = K.init("kaien")
    with pytest.raises(K.NotReady):
        K.activate(st)
    st["meter"] = 100
    fx = K.activate(st)
    assert st["meter"] == 0 and st["armed"] == "cut" and fx["name"] == "Ninth Page Cut"
    st["meter"] = 100
    with pytest.raises(K.AlreadyActive):
        K.activate(st)                                         # one ultimate at a time


# ── passives ──────────────────────────────────────────────────────────────────
def test_kaien_riposte_on_a_right_guard_against_a_blow():
    t = kt("kaien", move="guard")
    K.prepare(t)
    assert t.riposte == 0.5
    t = kt("kaien", move="guard", damaging=False)
    K.prepare(t)
    assert t.riposte == 0
    t = kt("kaien", move="guard", correct=False)
    K.prepare(t)
    assert t.riposte == 0


def test_asha_reach_makes_the_jab_stronger():
    t = kt("asha", move="jab")
    K.prepare(t)
    assert t.jab_mult == 0.8
    t = kt("kaien", move="jab")
    K.prepare(t)
    assert t.jab_mult is None


def test_brak_iron_combo_doubles_the_combo_bonus_up_to_eight():
    for combo, extra in ((1, 3), (5, 15), (8, 48 - 15), (12, 48 - 15)):
        t = kt("brak", combo=combo)
        K.prepare(t)
        assert t.combo_extra == extra, combo                   # (min(c,8) x 6) - (min(c,5) x 3)


def test_mira_spells_are_refunded_on_a_right_answer():
    st = K.init("mira")
    K.spent(st, 7, 2)
    t = kt("mira", state=st)
    t.seq = 7
    K.settle(t)
    assert t.refund == 2 and st["spent"] == {}
    K.spent(st, 8, 1)
    t = kt("mira", state=st, correct=False)
    t.seq = 8
    K.settle(t)
    assert t.refund == 0


@pytest.mark.parametrize("difficulty,chance", [("easy", 0.25), ("medium", 0.20), ("hard", 0.20), ("nightmare", 0.15)])
def test_vex_shadowstep_dodges_now_and_then(difficulty, chance):
    dodges = 0
    for seed in range(2000):
        t = kt("vex", correct=False, difficulty=difficulty, seed=seed)
        K.prepare(t)
        dodges += t.dodge
    assert abs(dodges / 2000 - chance) < 0.04


def test_thorne_bulwark_cuts_a_blow_to_a_third():
    t = kt("thorne")
    K.prepare(t)
    assert t.divisor == 3
    assert kt("kaien").divisor == 2


# ── ultimates ─────────────────────────────────────────────────────────────────
def test_kaien_ninth_page_cut_lands_on_the_next_right_answer_through_shields():
    st = {**K.init("kaien"), "armed": "cut"}
    t = kt("kaien", state=st, correct=False)
    K.prepare(t)
    K.settle(t)
    assert t.mult == 1 and st["armed"] == "cut"                # a miss keeps it armed
    t = kt("kaien", state=st)
    K.prepare(t)
    K.settle(t)
    assert t.mult == 2.5 and t.ignore_shield and st["armed"] is None


def test_asha_dawn_wall_halves_blows_and_gives_focus_for_two_turns():
    st = K.init("asha")
    st["meter"] = 100
    K.activate(st)
    for left in (1, 0):
        t = kt("asha", state=st)
        K.prepare(t)
        K.settle(t)
        assert t.halve_after and t.focus_delta == 1 and st["wall"] == left
    t = kt("asha", state=st)
    K.prepare(t)
    assert not t.halve_after


def test_brak_iron_rush_scales_with_the_combo():
    st = {**K.init("brak"), "armed": "rush"}
    t = kt("brak", state=st, combo=4)
    K.prepare(t)
    assert t.mult == 2.0


def test_mira_arcane_library_casts_both_spells_free_and_doubles_the_hit():
    st = K.init("mira")
    st["meter"] = 100
    fx = K.activate(st)
    assert fx["insight"] and fx["timewarp"]
    t = kt("mira", state=st)
    K.prepare(t)
    assert t.mult == 2.0


def test_vex_vanish_makes_the_next_two_blows_miss():
    st = K.init("vex")
    st["meter"] = 100
    K.activate(st)
    misses = 0
    for _ in range(3):
        t = kt("vex", state=st, correct=False, seed=999)
        K.prepare(t)
        if t.dodge and t.vanished:
            misses += 1
        K.settle(t)
    assert misses == 2 and st["vanish"] == 0


def test_thorne_last_chapter_heals_and_blocks_the_next_turn():
    st = K.init("thorne")
    st["meter"] = 100
    fx = K.activate(st)
    assert fx["hearts"] == 3
    t = kt("thorne", state=st, correct=False)
    K.prepare(t)
    K.settle(t)
    assert t.block and st["fortress"] == 0
    t = kt("thorne", state=st, correct=False)
    K.prepare(t)
    assert not t.block


# ── progression ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("xp,level", [(0, 1), (99, 1), (100, 2), (250, 3), (999, 5), (1000, 6), (2700, 10), (99999, 10)])
def test_champion_levels_follow_the_xp_curve(xp, level):
    assert K.level_for(xp) == level


def test_battle_xp_is_ten_per_right_answer_plus_fifty_for_a_win():
    assert K.battle_xp(correct=7, won=True) == 120 and K.battle_xp(correct=3, won=False) == 30


def test_three_mastery_skins_per_champion_at_levels_three_six_and_ten():
    for cid in CHAMPS:
        unlocks = K.mastery_unlocks(cid)
        assert [u["level"] for u in unlocks] == [3, 6, 10]
        assert {u["slot"] for u in unlocks} == {"armor", "headgear", "weapon"}
    assert [u["id"] for u in K.unlocked_between("kaien", 2, 6)] == ["mastery_kaien_outfit", "mastery_kaien_head"]
    assert K.unlocked_between("kaien", 6, 6) == []
