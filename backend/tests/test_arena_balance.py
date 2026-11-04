"""Balance guard for the creature mechanics and champion kits: scripted players with a fixed accuracy fight every
creature on every difficulty through the real battle API (real HP pacing, real intent rolls), and the results must
stay inside sane bands. A mechanic that makes a creature unwinnable, or a fight drag on, fails here.

The strategy is simple on purpose: Guard against telegraphed big blows (heavy / charge / boulder), Jab a boulder
when Guard is not taken, Heavy when Focus allows, otherwise Strike. Moves a Kraken has locked fall back to Jab."""
import random
import statistics

import pytest

import state
from core_brains.mechanics import MECHANICS
from arena_v2_support import (  # noqa: F401  (fixtures: real pacing - _plain_pacing is NOT imported)
    _clean_v2_tables, llm, intents, hero, start, truth, wrong, answer,
)

REAL_KITS = True                     # the champion kits are what these tests are about

FIGHTS = 10
MARGIN = 0.35                  # how much harder than a plain boss a creature may be


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    monkeypatch.setattr(state.limiter, "enabled", False)      # dozens of fights a minute: a script, not a person
BIG = ("heavy", "charge", "throw")


def pick_move(battle, rng):
    intent = battle.get("intent") or {}
    locked = set((battle.get("mechanic") or {}).get("locked_moves") or [])
    if intent.get("kind") in BIG and "guard" not in locked:
        move = "guard"
    elif battle["focus"] >= battle.get("heavy_cost", 2) and rng.random() < 0.5:
        move = "heavy"
    else:
        move = "strike"
    return "jab" if move in locked else move


def simulate(c, rng, accuracy, difficulty):
    data = start(c, difficulty)
    bid, battle = data["battle_id"], data["battle"]
    for _ in range(60):
        r = c.get(f"/arena/battles/{bid}/question", params={"move": pick_move(battle, rng)})
        assert r.status_code == 200, r.text
        q = r.json()["question"]
        if q is None:
            break
        pick = truth(bid, q["id"]) if rng.random() < accuracy else wrong(q["options"], bid, q["id"])
        out = answer(c, bid, q["id"], pick).json()
        battle = out["battle"]
        if battle["status"] != "active":
            break
    return battle["status"], battle["answered"]


@pytest.mark.parametrize("difficulty,accuracy", [("easy", 0.75), ("medium", 0.75), ("hard", 0.8), ("nightmare", 0.85)])
def test_no_creature_is_much_harder_or_slower_than_a_plain_boss(hero, llm, intents, monkeypatch, difficulty, accuracy):
    """Each creature's win rate stays within MARGIN of a boss with no mechanic, for the same scripted student,
    and no fight drags on. Seeded: the same code gives the same fights, so this never flakes."""
    c, _ = hero
    intents.default = None                                   # the real weighted roll
    random.seed(f"balance-{difficulty}")
    rng = random.Random(f"{difficulty}-{accuracy}")

    def rate(species):
        llm.species = species
        results = [simulate(c, rng, accuracy, difficulty) for _ in range(FIGHTS)]
        return sum(s == "won" for s, _ in results) / FIGHTS, statistics.mean(n for _, n in results)

    baseline, _ = rate(None)
    report = {species: rate(species) for species in sorted(MECHANICS)}
    hard_ones = {s: r for s, r in report.items() if r[0] < baseline - MARGIN}
    slow = {s: r for s, r in report.items() if r[1] > 30}
    assert not hard_ones, f"{difficulty}: plain boss wins {baseline:.0%}, these far less: {hard_ones}"
    assert not slow, f"{difficulty}: fights too long: {slow}"
