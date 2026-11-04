"""Champion kits (Phase 3 / Stage 2): each of the six champions fights with a passive and an ultimate.

Pure rules, no database (like core_brains/mechanics.py). The champion is snapshotted when a battle starts
(boss_json["kit"]), so switching champion mid-fight changes nothing. arena_service runs every answer through:

    prepare(t)   before the hit: damage multipliers, the Jab's reach, the combo bonus, dodges, blocks, the divisor
                 a right answer cuts a blow by
    settle(t)    after the boss acts: spell refunds, Focus, armed ultimates used up, turn counters

The ultimate meter fills from right answers (meter_gain); a full meter lets the player cast the ultimate once
(activate), which empties it. Champion progression (XP, levels, mastery skins) is at the bottom.
"""
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional

DIFFICULTY_INDEX = {"easy": 0, "medium": 1, "hard": 2, "nightmare": 3}

METER_MAX = 100
METER_PER_RIGHT = 25
METER_STREAK_BONUS = 10          # more per right answer at combo 3+
METER_STREAK_FROM = 3

RIPOSTE_RATIO = 0.5              # Kaien: a right Guard hits back for this share of a Strike
ASHA_JAB_MULT = 0.8              # Asha: the Jab (normally 0.6)
BRAK_COMBO_CAP, BRAK_COMBO_STEP = 8, 6       # Brak: combo bonus x2 (3 -> 6 per step), cap 8 (normally 5)
BASE_COMBO_CAP, BASE_COMBO_STEP = 5, 3
VEX_DODGE = (0.25, 0.20, 0.20, 0.15)
THORNE_DIVISOR = 3               # Thorne: a right answer cuts a blow to a third (normally half)

CUT_MULT = 2.5                   # Kaien's Ninth Page Cut
WALL_TURNS = 2                   # Asha's Dawn Wall
RUSH_PER_COMBO = 0.25            # Brak's Iron Rush: x(1 + 0.25 x combo)
LIBRARY_MULT = 2.0               # Mira's Arcane Library
VANISH_BLOWS, VANISH_MULT = 2, 1.5           # Vex's Vanish
LAST_CHAPTER_HEARTS = 3          # Thorne's Last Chapter (+ the next turn blocked)


class NotReady(Exception):
    pass


class AlreadyActive(Exception):
    pass


@dataclass
class Kit:
    champion: str
    passive_name: str
    passive_text: str
    ultimate_name: str
    ultimate_text: str


KITS: Dict[str, Kit] = {
    "kaien": Kit("kaien", "Riposte", "A right Guard against a blow hits back for half a Strike.",
                 "Ninth Page Cut", f"Your next right answer hits x{CUT_MULT:g} and cuts through shields."),
    "asha": Kit("asha", "Reach", f"Your Jab hits x{ASHA_JAB_MULT:g} instead of x0.6.",
                "Dawn Wall", f"For {WALL_TURNS} turns the boss's blows are halved and every right answer gives +1 Focus."),
    "brak": Kit("brak", "Iron Combo", f"Your combo bonus is doubled and grows up to {BRAK_COMBO_CAP} (not 5).",
                "Iron Rush", f"Your next right answer hits x(1 + {RUSH_PER_COMBO:g} x combo)."),
    "mira": Kit("mira", "Quiet Study", "A spell you cast gives its Focus back if you answer right.",
                "Arcane Library", f"Insight and Timewarp, free, and your next right answer hits x{LIBRARY_MULT:g}."),
    "vex": Kit("vex", "Shadowstep", "Now and then you slip past a blow entirely (25% easy, 20% medium and hard, 15% nightmare).",
               "Vanish", f"The boss's next {VANISH_BLOWS} blows miss, and your next right answer hits x{VANISH_MULT:g}."),
    "thorne": Kit("thorne", "Bulwark", "A right answer cuts a blow to a third instead of half.",
                  "Last Chapter", f"+{LAST_CHAPTER_HEARTS} hearts now, and the next turn's blow is fully blocked."),
}
DEFAULT_CHAMPION = "kaien"


@dataclass
class KitTurn:
    champion: str
    difficulty: str
    state: dict
    move: str
    correct: bool
    combo: int                    # after this answer
    damaging: bool                # this turn's intent is a blow
    rng: random.Random = field(default_factory=random.Random)
    seq: Optional[int] = None     # the question (Mira's refunds)
    # ── prepare ──
    mult: float = 1.0
    ignore_shield: bool = False
    jab_mult: Optional[float] = None
    combo_extra: int = 0          # flat damage before the move multiplier (Brak)
    riposte: float = 0.0          # share of a Strike Kaien hits back with
    divisor: int = 2              # a right answer divides a blow by this
    dodge: bool = False
    vanished: bool = False        # the dodge came from Vex's ultimate
    block: bool = False           # Thorne's Last Chapter
    halve_after: bool = False     # Asha's Dawn Wall
    # ── settle ──
    focus_delta: int = 0
    refund: int = 0
    events: List[dict] = field(default_factory=list)

    @property
    def d(self) -> int:
        return DIFFICULTY_INDEX.get(self.difficulty, 2)

    def __post_init__(self):
        if self.champion == "thorne":
            self.divisor = THORNE_DIVISOR

    def event(self, type_: str, text: str, **extra) -> None:
        self.events.append({"type": type_, "text": text, **extra})


def kit_for(champion: Optional[str]) -> Kit:
    return KITS.get(str(champion or ""), KITS[DEFAULT_CHAMPION])


def init(champion: Optional[str]) -> dict:
    cid = kit_for(champion).champion
    return {"champion": cid, "meter": 0, "armed": None, "wall": 0, "vanish": 0, "fortress": 0, "spent": {}}


def meter_gain(correct: bool, combo: int) -> int:
    if not correct:
        return 0
    return METER_PER_RIGHT + (METER_STREAK_BONUS if combo >= METER_STREAK_FROM else 0)


def charge(state: dict, correct: bool, combo: int) -> int:
    gain = min(METER_MAX - int(state.get("meter", 0)), meter_gain(correct, combo))
    state["meter"] = int(state.get("meter", 0)) + gain
    return gain


def ready(state: dict) -> bool:
    return int(state.get("meter", 0)) >= METER_MAX


def active(state: dict) -> bool:
    return bool(state.get("armed") or state.get("wall") or state.get("vanish") or state.get("fortress"))


def activate(state: dict) -> dict:
    """Cast the champion's ultimate. Returns what the caller applies right away: hearts, free spells."""
    if not ready(state):
        raise NotReady()
    if active(state):
        raise AlreadyActive()
    cid = state.get("champion") or DEFAULT_CHAMPION
    kit = kit_for(cid)
    state["meter"] = 0
    fx = {"name": kit.ultimate_name, "text": kit.ultimate_text, "hearts": 0, "insight": False, "timewarp": False}
    if cid == "kaien":
        state["armed"] = "cut"
    elif cid == "asha":
        state["wall"] = WALL_TURNS
    elif cid == "brak":
        state["armed"] = "rush"
    elif cid == "mira":
        state["armed"] = "library"
        fx.update(insight=True, timewarp=True)
    elif cid == "vex":
        state["vanish"] = VANISH_BLOWS
        state["armed"] = "vanish"
    elif cid == "thorne":
        state["fortress"] = 1
        fx["hearts"] = LAST_CHAPTER_HEARTS
    return fx


def spent(state: dict, seq: int, focus: int) -> None:
    """A spell paid with Focus on question `seq` (Mira gets it back on a right answer)."""
    bucket = state.setdefault("spent", {})
    bucket[str(seq)] = int(bucket.get(str(seq), 0)) + int(focus)


def prepare(t: KitTurn) -> None:
    s, cid = t.state, t.champion
    # ── passives ──
    if cid == "kaien" and t.correct and t.move == "guard" and t.damaging:
        t.riposte = RIPOSTE_RATIO
    if cid == "asha" and t.move == "jab":
        t.jab_mult = ASHA_JAB_MULT
    if cid == "brak" and t.correct:
        t.combo_extra = (min(t.combo, BRAK_COMBO_CAP) * BRAK_COMBO_STEP) - (min(t.combo, BASE_COMBO_CAP) * BASE_COMBO_STEP)
    if cid == "vex" and t.damaging and t.rng.random() < VEX_DODGE[t.d]:
        t.dodge = True
    # ── ultimates ──
    armed = s.get("armed")
    if t.correct and armed == "cut":
        t.mult, t.ignore_shield = CUT_MULT, True
    elif t.correct and armed == "rush":
        t.mult = 1 + RUSH_PER_COMBO * t.combo
    elif t.correct and armed == "library":
        t.mult = LIBRARY_MULT
    elif t.correct and armed == "vanish":
        t.mult = VANISH_MULT
    if int(s.get("wall", 0)) > 0 and t.damaging:
        t.halve_after = True
    if int(s.get("vanish", 0)) > 0 and t.damaging:
        t.dodge, t.vanished = True, True
    if int(s.get("fortress", 0)) > 0:
        t.block = True


def settle(t: KitTurn) -> None:
    s, cid = t.state, t.champion
    if cid == "mira" and t.seq is not None:
        paid = int(s.get("spent", {}).pop(str(t.seq), 0))
        if t.correct and paid:
            t.refund = paid
            t.event("refund", f"Quiet Study: {paid} Focus comes back.")
    if t.correct and s.get("armed") in ("cut", "rush", "library", "vanish"):
        t.event("ultimate_hit", f"{kit_for(cid).ultimate_name} lands!")
        s["armed"] = None
    if int(s.get("wall", 0)) > 0:
        if t.correct:
            t.focus_delta += 1
        s["wall"] = int(s["wall"]) - 1
    if t.vanished:
        s["vanish"] = max(0, int(s.get("vanish", 0)) - 1)
        t.event("vanish", "The blow passes through a shadow.")
    elif t.dodge:
        t.event("shadowstep", "Shadowstep: you slip past the blow.")
    if int(s.get("fortress", 0)) > 0:
        s["fortress"] = 0
        t.event("fortress", "The Last Chapter holds: nothing gets through.")


def hud(state: dict) -> dict:
    kit = kit_for(state.get("champion"))
    return {
        "champion": kit.champion, "meter": int(state.get("meter", 0)), "max": METER_MAX, "ready": ready(state),
        "active": active(state), "passive": {"name": kit.passive_name, "text": kit.passive_text},
        "ultimate": {"name": kit.ultimate_name, "text": kit.ultimate_text},
        "effects": {k: state.get(k) for k in ("armed", "wall", "vanish", "fortress") if state.get(k)},
    }


# ── progression ───────────────────────────────────────────────────────────────
# Total XP needed to reach each level (index 0 = level 1).
LEVEL_XP = (0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700)
MAX_LEVEL = len(LEVEL_XP)
XP_PER_RIGHT, XP_PER_WIN = 10, 50
MASTERY = (("outfit", "armor", 3), ("head", "headgear", 6), ("weapon", "weapon", 10))


def level_for(xp: int) -> int:
    return max(i + 1 for i, need in enumerate(LEVEL_XP) if xp >= need)


def next_level_xp(level: int) -> Optional[int]:
    return LEVEL_XP[level] if level < MAX_LEVEL else None


def battle_xp(correct: int, won: bool) -> int:
    return XP_PER_RIGHT * int(correct) + (XP_PER_WIN if won else 0)


def mastery_unlocks(champion: str) -> List[dict]:
    return [{"id": f"mastery_{champion}_{part}", "slot": slot, "level": level} for part, slot, level in MASTERY]


def unlocked_between(champion: str, old_level: int, new_level: int) -> List[dict]:
    """The mastery skins a level-up from `old_level` to `new_level` unlocks."""
    return [u for u in mastery_unlocks(champion) if old_level < u["level"] <= new_level]
