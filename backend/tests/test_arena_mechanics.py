"""Phase 3 / Stage 2: every creature's signature mechanic (core_brains/mechanics.py), rule by rule.

The module is pure (no database): a Turn goes through prepare() (before the player's hit lands) and settle() (after
the boss acts), and every number comes from the per-difficulty tables at the top of the module."""
import random

import pytest

from core_brains import mechanics as M
from core_brains.bestiary import CREATURES

DIFFS = ("easy", "medium", "hard", "nightmare")


def boss(species, **over):
    b = {"species": species, "max_hp": 200, "current_hp": 100, "phase": 1, "rage": False, "weakness": "mitosis",
         "attack_names": ["Bite"], "special_ability": "Doom"}
    b.update(over)
    return b


def turn(species, difficulty="hard", *, state=None, intent=None, move="strike", correct=True, timed_out=False,
         turn_no=1, combo=0, concept="cells", spent=0.2, illusion=False, pool=("dna", "rna", "atp"), b=None, dealt=10):
    m = M.for_species(species)
    b = b or boss(species)
    st = state if state is not None else m.init(b, difficulty)
    t = M.Turn(difficulty=difficulty, boss=b, state=st, intent=intent or {"kind": "attack", "value": 2},
               move=move, correct=correct, timed_out=timed_out, turn=turn_no, combo=combo,
               concept_key=concept, spent_ratio=spent, illusion_picked=illusion, pool_concepts=list(pool),
               rng=random.Random(1))
    m.prepare(t)
    t.dealt = dealt if correct else 0
    m.settle(t)
    return m, t


def test_every_creature_has_a_mechanic_with_a_hud():
    assert set(M.MECHANICS) == set(CREATURES)
    for species, m in M.MECHANICS.items():
        for d in DIFFS:
            hud = m.hud(m.init(boss(species), d), boss(species), d)
            assert hud["id"] == m.id and hud["name"] and hud["summary"], species
            assert isinstance(hud.get("counters", []), list)
    assert M.for_species("not-a-creature") is None


# ── Hydra ─────────────────────────────────────────────────────────────────────
def test_hydra_grows_a_head_on_every_miss_and_heals_per_head():
    _, t = turn("hydra", "hard", correct=False)
    assert t.state["heads"] == 1 and t.boss_heal == 12          # 6% of 200, one head
    _, t = turn("hydra", "hard", correct=False, state={"heads": 3})
    assert t.state["heads"] == 3 and t.boss_heal == 36          # capped at 3 heads
    _, t = turn("hydra", "easy", correct=False, timed_out=True, state={"heads": 1})
    assert t.state["heads"] == 2 and t.boss_heal == 12          # 3% x 2 heads on easy


def test_hydra_a_right_heavy_burns_the_heads_away():
    _, t = turn("hydra", move="heavy", correct=True, state={"heads": 3})
    assert t.state["heads"] == 0 and t.boss_heal == 0 and any(e["type"] == "cauterized" for e in t.events)
    _, t = turn("hydra", move="strike", correct=True, state={"heads": 2})
    assert t.state["heads"] == 2 and t.boss_heal == 0


# ── Kraken ────────────────────────────────────────────────────────────────────
def test_kraken_telegraphs_a_grab_every_fourth_turn():
    m = M.for_species("kraken")
    st = m.init(boss("kraken"), "hard")
    assert m.scheduled(st, boss("kraken"), "hard", 3) is None
    grab = m.scheduled(st, boss("kraken"), "hard", 4)
    assert grab["kind"] == "grab" and grab["value"] == 2 and "lock" in grab["description"].lower()


def test_kraken_a_missed_grab_locks_the_move_used_and_guard_is_never_locked():
    _, t = turn("kraken", "hard", intent={"kind": "grab", "value": 2}, move="heavy", correct=False)
    assert t.state["locked"] == {"move": "heavy", "turns": 2}
    _, t = turn("kraken", "easy", intent={"kind": "grab", "value": 1}, move="guard", correct=False)
    assert t.state["locked"] == {"move": "strike", "turns": 1}
    _, t = turn("kraken", intent={"kind": "grab", "value": 2}, move="strike", correct=True)
    assert not t.state.get("locked") and any(e["type"] == "broke_free" for e in t.events)


def test_kraken_a_lock_wears_off_turn_by_turn():
    m = M.for_species("kraken")
    st = {"locked": {"move": "jab", "turns": 2}}
    assert m.locked_moves(st) == ["jab"]
    _, t = turn("kraken", state=st)
    assert t.state["locked"] == {"move": "jab", "turns": 1}
    _, t = turn("kraken", state=t.state)
    assert not t.state.get("locked") and m.locked_moves(t.state) == []


# ── Sphinx ────────────────────────────────────────────────────────────────────
def test_sphinx_asks_a_riddle_every_third_turn_with_higher_stakes():
    m = M.for_species("sphinx")
    st = m.init(boss("sphinx"), "hard")
    riddle = m.scheduled(st, boss("sphinx"), "hard", 3)
    assert riddle["kind"] == "riddle" and riddle["value"] == 3          # 1.5 x 2, rounded up
    assert m.scheduled(st, boss("sphinx"), "hard", 2) is None
    _, t = turn("sphinx", intent=riddle, correct=True)
    assert t.mult == 1.5 and t.focus_delta == 1
    assert m.blocks_insight(riddle) and not m.blocks_insight({"kind": "attack"})


# ── Kitsune ───────────────────────────────────────────────────────────────────
def test_kitsune_illusion_turns_and_the_price_of_believing_one():
    m = M.for_species("kitsune")
    illusion = m.scheduled(m.init(boss("kitsune"), "hard"), boss("kitsune"), "hard", 3)
    assert illusion["kind"] == "illusion" and m.wants_illusion(illusion)
    _, t = turn("kitsune", intent=illusion, correct=False, illusion=True)
    assert t.focus_delta == -2 and any(e["type"] == "illusion" for e in t.events)
    _, t = turn("kitsune", intent=illusion, correct=False, illusion=False)
    assert t.focus_delta == 0


def test_illusion_option_is_another_questions_answer_and_never_a_real_option():
    pool = ["Golgi body", "Ribosome", "Nucleus"]
    opt = M.illusion_option(["Nucleus", "Vacuole", "Lysosome", "Membrane"], pool, random.Random(3))
    assert opt in ("Golgi body", "Ribosome")
    assert M.illusion_option(["A", "B"], ["A", "B"], random.Random(1)) is None      # nothing to borrow


# ── Fenrir ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("difficulty,fury,bonus", [("easy", 3, 1), ("easy", 9, 1), ("medium", 4, 2), ("hard", 5, 2),
                                                   ("hard", 9, 2), ("nightmare", 3, 1), ("nightmare", 9, 3)])
def test_fenrir_fury_adds_damage_capped_per_difficulty(difficulty, fury, bonus):
    _, t = turn("fenrir", difficulty, state={"fury": fury}, correct=False)
    assert t.boss_bonus == bonus


def test_fenrir_grows_every_turn_unless_chained_by_three_right_answers():
    _, t = turn("fenrir", state={"fury": 2}, correct=False)
    assert t.state["fury"] == 3
    _, t = turn("fenrir", state={"fury": 5}, correct=True, combo=3)
    assert t.state["fury"] == 0 and any(e["type"] == "chained" for e in t.events)
    _, t = turn("fenrir", state={"fury": 5}, correct=True, combo=2)
    assert t.state["fury"] == 6


# ── Ammit ─────────────────────────────────────────────────────────────────────
def test_ammit_feeds_on_a_repeated_mistake():
    st = {"missed": ["cells"], "stacks": 0}
    _, t = turn("ammit", "hard", state=st, correct=False, concept="cells")
    assert t.boss_heal == 16 and t.state["stacks"] == 1          # 8% of 200
    _, t = turn("ammit", "hard", state={"missed": [], "stacks": 0}, correct=False, concept="cells")
    assert t.boss_heal == 0 and t.state["missed"] == ["cells"]   # a first miss is only remembered
    _, t = turn("ammit", state={"missed": ["x"], "stacks": 3}, correct=False, concept="x")
    assert t.state["stacks"] == 3 and t.boss_bonus == 3


def test_ammit_a_heart_lighter_than_the_feather_doubles_the_blow():
    _, t = turn("ammit", state={"missed": ["cells"], "stacks": 2}, correct=True, concept="cells")
    assert t.mult == 2 and any(e["type"] == "feather" for e in t.events)


def test_ammit_remembers_the_nemesis_targets_as_already_missed():
    m = M.for_species("ammit")
    st = m.init(boss("ammit", target_concepts=["Cell Division"]), "hard")
    assert "cell division" in st["missed"]


# ── Minotaur ──────────────────────────────────────────────────────────────────
def test_minotaur_charges_every_fourth_turn_harder_the_longer_it_lasts():
    m = M.for_species("minotaur")
    st = m.init(boss("minotaur"), "hard")
    assert m.scheduled(st, boss("minotaur"), "hard", 4) == {**m.scheduled(st, boss("minotaur"), "hard", 4)}
    c4, c8 = m.scheduled(st, boss("minotaur"), "hard", 4), m.scheduled(st, boss("minotaur"), "hard", 8)
    assert c4["kind"] == "charge" and c4["value"] == 2 + 2 and c8["value"] == 2 + 4
    _, t = turn("minotaur", intent=c4, correct=True, move="strike")
    assert t.no_halve


def test_minotaur_a_right_guard_on_a_charge_stuns_it():
    m, t = turn("minotaur", intent={"kind": "charge", "value": 4}, correct=True, move="guard")
    assert t.state["stun_next"] and any(e["type"] == "stunned" for e in t.events)
    stunned = m.scheduled(t.state, boss("minotaur"), "hard", 5)
    assert stunned["kind"] == "stunned" and stunned["value"] == 0
    _, t2 = turn("minotaur", state=t.state, intent=stunned, correct=True)
    assert t2.skip and t2.mult == 1.5 and not t2.state.get("stun_next")


# ── Cyclops ───────────────────────────────────────────────────────────────────
def test_cyclops_takes_aim_then_throws_a_boulder():
    m = M.for_species("cyclops")
    st = m.init(boss("cyclops"), "hard")
    aim, throw = m.scheduled(st, boss("cyclops"), "hard", 3), m.scheduled(st, boss("cyclops"), "hard", 4)
    assert aim["kind"] == "aim" and aim["value"] == 0 and throw["kind"] == "throw" and throw["value"] == 6
    _, t = turn("cyclops", intent=aim)
    assert t.skip
    _, t = turn("cyclops", intent=throw, correct=True, move="strike")
    assert t.no_halve and not t.dodge
    for move in ("guard", "jab"):
        _, t = turn("cyclops", intent=throw, correct=True, move=move)
        assert t.dodge, move
    _, t = turn("cyclops", intent=throw, correct=False, move="jab")
    assert not t.dodge


# ── Oni ───────────────────────────────────────────────────────────────────────
def test_oni_beats_its_drum_while_untouched_and_a_heavy_breaks_it():
    _, t = turn("oni", state={"drum": 1}, correct=False)
    assert t.boss_bonus == 1 and t.state["drum"] == 2
    _, t = turn("oni", state={"drum": 3}, correct=False)
    assert t.state["drum"] == 3
    _, t = turn("oni", state={"drum": 2}, correct=True, move="guard", dealt=0)
    assert t.state["drum"] == 3                                    # a guard deals no damage: the drum keeps going
    _, t = turn("oni", state={"drum": 2}, correct=True, move="strike")
    assert t.state["drum"] == 2
    _, t = turn("oni", state={"drum": 3}, correct=True, move="heavy")
    assert t.state["drum"] == 0 and any(e["type"] == "drum_broken" for e in t.events)


# ── Rakshasa ──────────────────────────────────────────────────────────────────
def test_rakshasa_shifts_its_weakness_every_third_turn_behind_a_shield():
    b = boss("rakshasa", weakness="mitosis")
    _, t = turn("rakshasa", b=b, turn_no=3, pool=("mitosis", "meiosis", "osmosis"))
    assert t.new_weakness in ("meiosis", "osmosis") and t.shield == 10        # 5% of 200
    _, t = turn("rakshasa", b=b, turn_no=2)
    assert t.new_weakness is None and t.shield == 0
    _, t = turn("rakshasa", b=b, turn_no=3, pool=("mitosis",))
    assert t.new_weakness is None                                             # nothing to shift to


# ── Naga ──────────────────────────────────────────────────────────────────────
def test_naga_treasure_turns_reward_a_right_answer_and_poison_a_wrong_one():
    m = M.for_species("naga")
    hoard = m.scheduled(m.init(boss("naga"), "hard"), boss("naga"), "hard", 4)
    assert hoard["kind"] == "hoard" and m.forced_tier(hoard) == "hard"
    _, t = turn("naga", intent=hoard, correct=True)
    assert t.mult == 1.5 and t.hearts == 1 and t.focus_delta == 2
    _, t = turn("naga", intent=hoard, correct=False)
    assert t.state["venom"] == 2 and t.player_dot == 0                        # venom starts next turn
    _, t = turn("naga", state=t.state, correct=True)
    assert t.player_dot == 1 and t.state["venom"] == 1


# ── Simurgh ───────────────────────────────────────────────────────────────────
def test_simurgh_slow_answers_feed_it_and_fast_right_ones_pluck_a_feather():
    _, t = turn("simurgh", "hard", spent=0.8, correct=True)
    assert t.boss_heal == 8 and t.mult == 1.0                                # 4% of 200
    _, t = turn("simurgh", "easy", timed_out=True, correct=False, spent=1.0)
    assert t.boss_heal == 4
    _, t = turn("simurgh", spent=0.3, correct=True)
    assert t.mult == 1.25 and t.boss_heal == 0


# ── Jormungandr ───────────────────────────────────────────────────────────────
def test_jormungandr_coils_hurt_every_turn_and_right_answers_shake_them():
    _, t = turn("jormungandr", "hard", state={"coils": 0}, correct=False)
    assert t.state["coils"] == 1 and t.player_dot == 0
    _, t = turn("jormungandr", "nightmare", state={"coils": 2}, correct=False)
    assert t.player_dot == 2 and t.state["coils"] == 3
    _, t = turn("jormungandr", "hard", state={"coils": 2}, correct=False)
    assert t.state["coils"] == 2                                             # hard: two coils at most
    _, t = turn("jormungandr", "easy", state={"coils": 1}, correct=False)
    assert t.state["coils"] == 1                                             # easy: one coil at most
    _, t = turn("jormungandr", state={"coils": 3}, correct=True, move="strike")
    assert t.state["coils"] == 2
    _, t = turn("jormungandr", state={"coils": 3}, correct=True, move="guard")
    assert t.state["coils"] == 0


def test_no_creature_heals_past_full_or_while_dead():
    _, t = turn("hydra", correct=False, b=boss("hydra", current_hp=199))
    assert t.boss_heal == 1
    _, t = turn("hydra", correct=False, b=boss("hydra", current_hp=0))
    assert t.boss_heal == 0
