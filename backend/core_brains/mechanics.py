"""Creature signature mechanics (Phase 3 / Stage 2): one rule set per creature in the bestiary.

Pure rules, no database. arena_service.BattleService._resolve builds a Turn for every answer and runs it through
the creature's mechanic in two steps:

    prepare(t)   before the player's hit lands: damage multiplier, "can't be halved", dodges, a stunned boss...
    settle(t)    after the boss's intent: the creature's own state moves on (heads, fury, coils...) and the
                 side effects are set on the Turn (boss heal, damage over time, Focus, hearts, a shield...)

and asks it, after every turn, whether the coming turn has a scheduled special intent (`scheduled`): a grab, a
riddle, an illusion, a charge, a boulder. Every number is per difficulty (easy, medium, hard, nightmare) in the
tables below; docs/arena-v2.md section 8 lists them.

The state lives in boss_json["mech"]; `hud()` is what the browser shows (name, a one-line rule, counters).
"""
import math
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from core_brains.boss_brain import intent_base_damage

DIFFICULTY_INDEX = {"easy": 0, "medium": 1, "hard": 2, "nightmare": 3}

HYDRA_HEAL_PCT = (3, 4, 6, 8)          # per head, on every miss
HYDRA_MAX_HEADS = 3
KRAKEN_EVERY = 4                       # a grab every 4th turn
KRAKEN_LOCK_TURNS = (1, 1, 2, 2)
SPHINX_EVERY = 3
RIDDLE_MULT = 1.5
KITSUNE_EVERY = 3
ILLUSION_FOCUS_COST = 2
FENRIR_DIVISOR = (3, 2, 2, 2)          # +1 damage per this much Fury ...
FENRIR_CAP = (1, 2, 2, 3)              # ... up to this (tuned by tests/test_arena_balance.py)
FENRIR_CHAIN = 3                       # right answers in a row that chain it
AMMIT_HEAL_PCT = (5, 6, 8, 10)
AMMIT_MAX_STACKS = 3
FEATHER_MULT = 2.0
MINOTAUR_EVERY = 4
STUN_MULT = 1.5
CYCLOPS_EVERY = 4                      # aims on turn 4k-1, throws on turn 4k
THROW_MULT = 3
ONI_MAX_DRUM = (2, 2, 3, 3)
RAKSHASA_EVERY = 3
RAKSHASA_SHIELD_PCT = 0.05
NAGA_EVERY = 4
TREASURE_MULT = 1.5
TREASURE_HEARTS = 1
TREASURE_FOCUS = 2
VENOM_TURNS = 2
SIMURGH_HEAL_PCT = (2, 3, 4, 5)
SIMURGH_SLOW = 0.5                     # share of the clock: slower than this feeds it, faster plucks a feather
FEATHER_PLUCK_MULT = 1.25
COIL_CAP = (1, 1, 2, 3)

# Intents a mechanic adds. All but aim / stunned hit like an attack (value = damage).
SPECIAL_KINDS = ("grab", "riddle", "illusion", "charge", "aim", "throw", "hoard", "stunned")
DAMAGING_KINDS = ("attack", "heavy", "grab", "riddle", "illusion", "charge", "throw", "hoard")


def key(text) -> str:
    return " ".join(str(text or "").lower().split())


@dataclass
class Turn:
    """One answer as the mechanic sees it. prepare() / settle() fill in the effects."""
    difficulty: str
    boss: dict
    state: dict
    intent: dict
    move: str
    correct: bool
    timed_out: bool = False
    turn: int = 1                      # 1-based: the turn being resolved
    combo: int = 0                     # the combo AFTER this answer
    concept_key: str = ""
    spent_ratio: float = 0.0           # share of the clock used
    illusion_picked: bool = False
    pool_concepts: List[str] = field(default_factory=list)
    rng: random.Random = field(default_factory=random.Random)
    dealt: int = 0                     # set by the caller between prepare() and settle()
    # ── effects (prepare) ──
    mult: float = 1.0                  # on the player's damage
    no_halve: bool = False             # a right answer does not halve the boss's blow
    boss_bonus: int = 0                # added to the boss's damage
    dodge: bool = False                # the boss's blow misses entirely
    skip: bool = False                 # the boss does nothing this turn
    # ── effects (settle) ──
    boss_heal: int = 0
    player_dot: int = 0                # damage over time, after the boss's blow (never blocked)
    focus_delta: int = 0
    hearts: int = 0
    shield: int = 0
    new_weakness: Optional[str] = None
    events: List[dict] = field(default_factory=list)

    @property
    def d(self) -> int:
        return DIFFICULTY_INDEX.get(self.difficulty, 2)

    def event(self, type_: str, text: str, **extra) -> None:
        self.events.append({"type": type_, "text": text, **extra})

    def heal_pct(self, pct: float) -> int:
        """`pct` % of max HP, never past full and never for a boss that is down."""
        hp, top = int(self.boss.get("current_hp", 0)), int(self.boss.get("max_hp", 100))
        if hp <= 0:
            return 0
        return max(0, min(int(round(top * pct / 100)), top - hp))


def _intent(kind: str, name: str, value: int, description: str, **extra) -> dict:
    return {"kind": kind, "name": name, "value": int(value), "description": description, "special": True, **extra}


class Mechanic:
    id = ""
    name = ""
    summary = ""

    def init(self, boss: dict, difficulty: str) -> dict:
        return {}

    def scheduled(self, state: dict, boss: dict, difficulty: str, turn: int) -> Optional[dict]:
        """The special intent for `turn`, or None (the usual weighted roll)."""
        return None

    def locked_moves(self, state: dict) -> List[str]:
        return []

    def blocks_insight(self, intent: Optional[dict]) -> bool:
        return False

    def wants_illusion(self, intent: Optional[dict]) -> bool:
        return False

    def forced_tier(self, intent: Optional[dict]) -> Optional[str]:
        return None

    def prefers_riddle(self, intent: Optional[dict]) -> bool:
        return False

    def prepare(self, t: Turn) -> None:
        pass

    def settle(self, t: Turn) -> None:
        pass

    def counters(self, state: dict, boss: dict, difficulty: str) -> List[dict]:
        return []

    def hud(self, state: dict, boss: dict, difficulty: str) -> dict:
        return {"id": self.id, "name": self.name, "summary": self.summary,
                "counters": self.counters(state, boss, difficulty), "locked_moves": self.locked_moves(state)}


def _base(boss: dict, difficulty: str) -> int:
    return intent_base_damage(boss, difficulty)


class Hydra(Mechanic):
    id, name = "regrowth", "Regrowth"
    summary = "Every miss grows a head, and each head heals it. A right Heavy burns them away."

    def init(self, boss, difficulty):
        return {"heads": 0}

    def settle(self, t):
        if t.correct and t.move == "heavy":
            if t.state.get("heads"):
                t.event("cauterized", "Your heavy blow burns the stumps: no head grows back.")
            t.state["heads"] = 0
        elif not t.correct:
            t.state["heads"] = min(HYDRA_MAX_HEADS, int(t.state.get("heads", 0)) + 1)
            t.boss_heal = t.heal_pct(HYDRA_HEAL_PCT[t.d] * t.state["heads"])
            t.event("regrowth", f"A head grows back. The Hydra heals {t.boss_heal}.", heads=t.state["heads"])

    def counters(self, state, boss, difficulty):
        return [{"label": "Heads", "value": int(state.get("heads", 0)), "max": HYDRA_MAX_HEADS,
                 "hint": f"Each heals {HYDRA_HEAL_PCT[DIFFICULTY_INDEX.get(difficulty, 2)]}% on a miss"}]


class Kraken(Mechanic):
    id, name = "grab", "Tentacle Grab"
    summary = "Every 4th turn it grabs. Miss that turn and the move you used is locked. A right answer breaks free."

    def init(self, boss, difficulty):
        return {"locked": None}

    def scheduled(self, state, boss, difficulty, turn):
        if turn % KRAKEN_EVERY:
            return None
        v = _base(boss, difficulty)
        n = KRAKEN_LOCK_TURNS[DIFFICULTY_INDEX.get(difficulty, 2)]
        return _intent("grab", "Tentacle Grab", v,
                       f"Hits for {v}. Miss and the move you used is locked for {n} turn{'s' if n > 1 else ''}. "
                       "A right answer breaks free.")

    def locked_moves(self, state):
        lock = state.get("locked")
        return [lock["move"]] if lock and lock.get("turns", 0) > 0 else []

    def settle(self, t):
        lock = t.state.get("locked")
        if lock:                                          # the old lock wears off by one turn
            lock["turns"] = int(lock.get("turns", 0)) - 1
            t.state["locked"] = lock if lock["turns"] > 0 else None
        if t.intent.get("kind") != "grab":
            return
        if t.correct:
            t.event("broke_free", "You slip out of the tentacles.")
        else:
            move = "strike" if t.move == "guard" else t.move        # Guard is never locked
            t.state["locked"] = {"move": move, "turns": KRAKEN_LOCK_TURNS[t.d]}
            t.event("grabbed", f"The Kraken pins your {move.title()}.", move=move, turns=KRAKEN_LOCK_TURNS[t.d])

    def counters(self, state, boss, difficulty):
        lock = state.get("locked")
        return [{"label": f"{lock['move'].title()} locked", "value": int(lock["turns"]), "max": 2,
                 "hint": "Turns until it lets go"}] if lock else []


class Sphinx(Mechanic):
    id, name = "riddle", "Riddle"
    summary = "Every 3rd question is a riddle: right hits x1.5 and gives Focus, wrong hurts more. No Insight on riddles."

    def scheduled(self, state, boss, difficulty, turn):
        if turn % SPHINX_EVERY:
            return None
        v = math.ceil(_base(boss, difficulty) * RIDDLE_MULT)
        return _intent("riddle", "The Sphinx's Riddle", v,
                       f"A riddle. Right: x{RIDDLE_MULT:g} damage and +1 Focus. Wrong: it strikes for {v}. "
                       "Insight can't be cast on it.")

    def blocks_insight(self, intent):
        return bool(intent and intent.get("kind") == "riddle")

    def prefers_riddle(self, intent):
        return bool(intent and intent.get("kind") == "riddle")

    def prepare(self, t):
        if t.intent.get("kind") == "riddle" and t.correct:
            t.mult = RIDDLE_MULT

    def settle(self, t):
        if t.intent.get("kind") != "riddle":
            return
        if t.correct:
            t.focus_delta += 1
            t.event("riddle_solved", "Riddle solved: the Sphinx bows its head.")
        else:
            t.event("riddle_failed", "Wrong. The Sphinx devours your certainty.")


class Kitsune(Mechanic):
    id, name = "illusion", "Fox-fire Illusion"
    summary = "Every 3rd question hides a fake option. Believe it and you lose 2 Focus. Insight clears it first."

    def scheduled(self, state, boss, difficulty, turn):
        if turn % KITSUNE_EVERY:
            return None
        v = _base(boss, difficulty)
        return _intent("illusion", "Fox-fire Illusion", v,
                       f"One option is an illusion. Pick it and lose {ILLUSION_FOCUS_COST} Focus; it hits for {v}.")

    def wants_illusion(self, intent):
        return bool(intent and intent.get("kind") == "illusion")

    def settle(self, t):
        if t.illusion_picked:
            t.focus_delta -= ILLUSION_FOCUS_COST
            t.event("illusion", "It was an illusion! The fox laughs and steals your Focus.")
        elif t.intent.get("kind") == "illusion" and t.correct:
            t.event("illusion_seen", "You see through the illusion.")


def illusion_option(options: List[str], pool_answers: List[str], rng: random.Random) -> Optional[str]:
    """A fake option for a Kitsune turn: the right answer of another question, never one of the real options."""
    real = {key(o) for o in options}
    choices = [a for a in dict.fromkeys(pool_answers) if a and key(a) not in real]
    return rng.choice(choices) if choices else None


class Fenrir(Mechanic):
    id, name = "unchained", "Unchained"
    summary = "Fury grows every turn and makes its blows harder. Three right answers in a row chain it again."

    def init(self, boss, difficulty):
        return {"fury": 0}

    @staticmethod
    def bonus(fury: int, d: int) -> int:
        return min(FENRIR_CAP[d], int(fury) // FENRIR_DIVISOR[d])

    def prepare(self, t):
        t.boss_bonus += self.bonus(t.state.get("fury", 0), t.d)

    def settle(self, t):
        if t.correct and t.combo >= FENRIR_CHAIN and t.combo % FENRIR_CHAIN == 0:
            t.state["fury"] = 0
            t.event("chained", "Three in a row: Fenrir is chained again!")
        else:
            t.state["fury"] = int(t.state.get("fury", 0)) + 1

    def counters(self, state, boss, difficulty):
        d = DIFFICULTY_INDEX.get(difficulty, 2)
        return [{"label": "Fury", "value": int(state.get("fury", 0)), "max": FENRIR_CAP[d] * FENRIR_DIVISOR[d],
                 "hint": f"+{self.bonus(state.get('fury', 0), d)} damage on its blows"}]


class Ammit(Mechanic):
    id, name = "devourer", "Devourer of Hearts"
    summary = "Miss a concept you missed before and it feeds. Get one right and your heart is lighter than the feather: x2."

    def init(self, boss, difficulty):
        return {"missed": [key(c) for c in boss.get("target_concepts") or [] if key(c)], "stacks": 0}

    def _seen(self, t):
        return bool(t.concept_key) and t.concept_key in t.state.get("missed", [])

    def prepare(self, t):
        t.boss_bonus += int(t.state.get("stacks", 0))
        if t.correct and self._seen(t):
            t.mult = FEATHER_MULT

    def settle(self, t):
        if t.correct:
            if self._seen(t):
                t.event("feather", "Your heart is lighter than the feather: double damage!")
            return
        if self._seen(t):
            t.state["stacks"] = min(AMMIT_MAX_STACKS, int(t.state.get("stacks", 0)) + 1)
            t.boss_heal = t.heal_pct(AMMIT_HEAL_PCT[t.d])
            t.event("devour", f"Ammit devours a repeated mistake and heals {t.boss_heal}.")
        elif t.concept_key:
            t.state.setdefault("missed", []).append(t.concept_key)

    def counters(self, state, boss, difficulty):
        return [{"label": "Feasts", "value": int(state.get("stacks", 0)), "max": AMMIT_MAX_STACKS,
                 "hint": "+1 damage on its blows each"}]


class Minotaur(Mechanic):
    id, name = "labyrinth_charge", "Labyrinth Charge"
    summary = "Every 4th turn it charges, harder the longer the fight lasts. A right Guard stuns it."

    def init(self, boss, difficulty):
        return {"stun_next": False}

    def scheduled(self, state, boss, difficulty, turn):
        if state.get("stun_next"):
            return _intent("stunned", "Stunned", 0, f"It is dazed: it does nothing and your hit lands x{STUN_MULT:g}.")
        if turn % MINOTAUR_EVERY:
            return None
        v = _base(boss, difficulty) + turn // 2
        return _intent("charge", "Labyrinth Charge", v,
                       f"Charges for {v}: a right answer does not halve it. A right Guard stuns it.")

    def prepare(self, t):
        kind = t.intent.get("kind")
        if kind == "charge":
            t.no_halve = True
        elif kind == "stunned":
            t.skip = True
            if t.correct:
                t.mult = STUN_MULT

    def settle(self, t):
        kind = t.intent.get("kind")
        if kind == "stunned":
            t.state["stun_next"] = False
        elif kind == "charge" and t.correct and t.move == "guard":
            t.state["stun_next"] = True
            t.event("stunned", "The Minotaur crashes into your guard and staggers!")

    def counters(self, state, boss, difficulty):
        return [{"label": "Stunned", "value": 1, "max": 1, "hint": "Next turn it does nothing"}] if state.get("stun_next") else []


class Cyclops(Mechanic):
    id, name = "boulder", "Boulder Throw"
    summary = "It takes aim, then throws a boulder that a right answer can't halve. Guard or a right Jab dodges it."

    def scheduled(self, state, boss, difficulty, turn):
        if turn % CYCLOPS_EVERY == CYCLOPS_EVERY - 1:
            return _intent("aim", "Takes Aim", 0, "It lifts a boulder. Next turn it throws: Guard or Jab to dodge.")
        if turn % CYCLOPS_EVERY == 0:
            v = THROW_MULT * _base(boss, difficulty)
            return _intent("throw", "Boulder Throw", v,
                           f"Throws for {v}. A right answer can't halve it; a right Guard or Jab dodges it.")
        return None

    def prepare(self, t):
        kind = t.intent.get("kind")
        if kind == "aim":
            t.skip = True
        elif kind == "throw":
            t.no_halve = True
            if t.correct and t.move in ("guard", "jab"):
                t.dodge = True

    def settle(self, t):
        if t.intent.get("kind") == "throw" and t.dodge:
            t.event("dodged", "You dodge the boulder!")


class Oni(Mechanic):
    id, name = "war_drum", "War Drum"
    summary = "Every turn it takes no damage it beats the drum: +1 damage per beat. A right Heavy breaks it."

    def init(self, boss, difficulty):
        return {"drum": 0}

    def prepare(self, t):
        t.boss_bonus += int(t.state.get("drum", 0))

    def settle(self, t):
        if t.correct and t.move == "heavy":
            if t.state.get("drum"):
                t.event("drum_broken", "Your heavy blow splits the war drum!")
            t.state["drum"] = 0
        elif t.dealt <= 0:
            t.state["drum"] = min(ONI_MAX_DRUM[t.d], int(t.state.get("drum", 0)) + 1)
            t.event("drum", "BOOM. The war drum beats faster.", drum=t.state["drum"])

    def counters(self, state, boss, difficulty):
        return [{"label": "Drum", "value": int(state.get("drum", 0)), "max": ONI_MAX_DRUM[DIFFICULTY_INDEX.get(difficulty, 2)],
                 "hint": "+1 damage each"}]


class Rakshasa(Mechanic):
    id, name = "shapeshift", "Shapeshift"
    summary = "Every 3rd turn it changes form: its weakness moves to another concept, and it raises a small shield."

    def settle(self, t):
        if t.turn % RAKSHASA_EVERY:
            return
        current = key(t.boss.get("weakness"))
        choices = sorted({c for c in t.pool_concepts if key(c) and key(c) != current})
        if not choices:
            return
        t.new_weakness = t.rng.choice(choices)
        t.shield = max(1, int(round(int(t.boss.get("max_hp", 100)) * RAKSHASA_SHIELD_PCT)))
        t.event("shapeshift", f"The Rakshasa changes form. Its weakness is now: {t.new_weakness}.",
                weakness=t.new_weakness)

    def counters(self, state, boss, difficulty):
        return [{"label": "Weak to", "text": str(boss.get("weakness") or "?"), "hint": "Changes every 3 turns"}]


class Naga(Mechanic):
    id, name = "hoard", "Serpent's Hoard"
    summary = "Every 4th turn is a hard treasure question: right steals a heart and Focus, wrong poisons you."

    def init(self, boss, difficulty):
        return {"venom": 0}

    def scheduled(self, state, boss, difficulty, turn):
        if turn % NAGA_EVERY:
            return None
        v = _base(boss, difficulty)
        return _intent("hoard", "The Hoard", v,
                       f"A hard treasure question. Right: x{TREASURE_MULT:g} damage, +{TREASURE_HEARTS} heart, "
                       f"+{TREASURE_FOCUS} Focus. Wrong: venom for {VENOM_TURNS} turns.")

    def forced_tier(self, intent):
        return "hard" if intent and intent.get("kind") == "hoard" else None

    def prepare(self, t):
        if t.intent.get("kind") == "hoard" and t.correct:
            t.mult = TREASURE_MULT

    def settle(self, t):
        venom = int(t.state.get("venom", 0))
        if venom > 0:                                      # last turns' venom first
            t.player_dot += 1
            t.state["venom"] = venom - 1
            t.event("venom", "The venom burns: -1 heart.")
        if t.intent.get("kind") != "hoard":
            return
        if t.correct:
            t.hearts += TREASURE_HEARTS
            t.focus_delta += TREASURE_FOCUS
            t.event("treasure", "You steal from the hoard!")
        else:
            t.state["venom"] = VENOM_TURNS
            t.event("poisoned", f"Venom! You lose a heart on each of the next {VENOM_TURNS} turns.")

    def counters(self, state, boss, difficulty):
        return [{"label": "Venom", "value": int(state.get("venom", 0)), "max": VENOM_TURNS, "hint": "-1 heart per turn"}] if state.get("venom") else []


class Simurgh(Mechanic):
    id, name = "wisdom", "Feathers of Wisdom"
    summary = "Slow answers (over half the clock) let it heal. Fast right answers pluck a feather: +25% damage."

    def prepare(self, t):
        if t.correct and not t.timed_out and t.spent_ratio < SIMURGH_SLOW:
            t.mult = FEATHER_PLUCK_MULT

    def settle(self, t):
        if t.timed_out or t.spent_ratio > SIMURGH_SLOW:
            t.boss_heal = t.heal_pct(SIMURGH_HEAL_PCT[t.d])
            t.event("wisdom", f"While you think, the Simurgh gathers wisdom and heals {t.boss_heal}.")
        elif t.correct:
            t.event("plucked", "Quick as thought: you pluck a feather!")


class Jormungandr(Mechanic):
    id, name = "coil", "World Coil"
    summary = "Every miss wraps another coil around you (1 damage a turn each). Right Strikes shake one off, a right Guard all."

    def init(self, boss, difficulty):
        return {"coils": 0}

    def settle(self, t):
        coils = int(t.state.get("coils", 0))
        if coils:                                          # the coils already on you squeeze first
            t.player_dot += coils
            t.event("squeeze", f"The coils squeeze: -{coils}.")
        if not t.correct:
            coils = min(COIL_CAP[t.d], coils + 1)
        elif t.move == "guard":
            if coils:
                t.event("uncoiled", "You throw off every coil!")
            coils = 0
        elif t.move in ("strike", "heavy") and coils:
            coils -= 1
            t.event("uncoil", "You shake off a coil.")
        t.state["coils"] = coils

    def counters(self, state, boss, difficulty):
        return [{"label": "Coils", "value": int(state.get("coils", 0)), "max": COIL_CAP[DIFFICULTY_INDEX.get(difficulty, 2)],
                 "hint": "-1 heart per turn each"}]


MECHANICS: Dict[str, Mechanic] = {
    "hydra": Hydra(), "kraken": Kraken(), "sphinx": Sphinx(), "kitsune": Kitsune(), "fenrir": Fenrir(),
    "ammit": Ammit(), "minotaur": Minotaur(), "cyclops": Cyclops(), "oni": Oni(), "rakshasa": Rakshasa(),
    "naga": Naga(), "simurgh": Simurgh(), "jormungandr": Jormungandr(),
}


def for_species(species: Optional[str]) -> Optional[Mechanic]:
    return MECHANICS.get(str(species or ""))


def for_boss(boss: dict) -> Optional[Mechanic]:
    return for_species(boss.get("species"))
