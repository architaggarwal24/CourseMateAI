import logging
import random
import asyncio
from typing import Optional
from langchain_core.messages import SystemMessage, HumanMessage
from core_brains import bestiary
from core_brains.llm_connection import StructuredOutputError, generate_structured_async
from core_brains.llm_schemas import BattleQuiz, BossFlavor, ExpeditionActs
from prompts.boss_prompts import BATTLE_QUIZ_PROMPT, BOSS_FLAVOR_PROMPT, EXPEDITION_ACTS_PROMPT, NEMESIS_TARGET_BLOCK


logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────────────────────

def _get_context(vector_store, topic: str, k: int = 8) -> str:
    """Pull relevant context from the vector store using two parallel searches."""
    results = vector_store.search(topic, k=k)
    broad = vector_store.search(f"key concepts {topic}", k=4)
    parts = []
    if isinstance(results, list):
        parts += [str(c) for c in results]
    else:
        parts.append(str(results))
    if isinstance(broad, list):
        parts += [str(c) for c in broad]
    elif broad:
        parts.append(str(broad))
    return "\n\n".join(parts)


async def _get_context_async(vector_store, topic: str, k: int = 8) -> str:
    """
    Async version of _get_context — fires both vector searches in parallel
    via asyncio.gather so we spend ~1× the search latency instead of ~2×.
    """
    import asyncio as _aio

    async def _search(query: str, n: int):
        return await _aio.to_thread(vector_store.search, query, n)

    results, broad = await _aio.gather(
        _search(topic, k),
        _search(f"key concepts {topic}", 4),
    )
    parts = []
    if isinstance(results, list):
        parts += [str(c) for c in results]
    else:
        parts.append(str(results))
    if isinstance(broad, list):
        parts += [str(c) for c in broad]
    elif broad:
        parts.append(str(broad))
    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Boss Persona — ASYNC version (parallelises persona + taunt LLM calls)
# ─────────────────────────────────────────────────────────────────────────────

VALID_DIFFICULTIES = ("easy", "medium", "hard", "nightmare")
# The LLM is only *advised* an HP value; clamp so it can never return 1 or 100000.
_HP_RANGE = {"easy": (40, 80), "medium": (70, 110), "hard": (100, 160), "nightmare": (140, 220)}


def sanitize_boss(boss: dict, difficulty: str) -> dict:
    """Coerce LLM-provided boss fields into safe types/ranges."""
    lo, hi = _HP_RANGE.get(difficulty, _HP_RANGE["hard"])
    try:
        hp = int(float(boss.get("max_hp", 0)))
    except (TypeError, ValueError):
        hp = (lo + hi) // 2
    boss["max_hp"] = max(lo, min(hi, hp))
    try:
        rage = float(boss.get("rage_threshold", 0.4))
    except (TypeError, ValueError):
        rage = 0.4
    boss["rage_threshold"] = max(0.2, min(0.6, rage))
    for key in ("name", "title", "tagline", "personality", "conceptual_core",
                "special_ability", "weakness"):
        val = boss.get(key)
        val = "" if val is None else str(val)
        if key == "name" and not val.strip():
            val = "The Guardian"
        boss[key] = val[:200]
    names = boss.get("attack_names")
    if not isinstance(names, list) or not [n for n in names if isinstance(n, str) and n.strip()]:
        names = ["Concept Crush", "Theory Slam", "Knowledge Void"]
    boss["attack_names"] = [str(n)[:80] for n in names][:5]
    return boss


FLAVOR_TIMEOUT = 45          # seconds the background flavour call may take before the creature keeps its own lines
_FLAVOR_KEYS = ("title", "conceptual_core", "weakness", "special_ability", "intro_taunt", "defeat_taunt")


async def generate_boss_persona_async(vector_store, topic: str, difficulty: str = "hard") -> dict:
    """The boss for a fight - INSTANT: a bestiary creature picked from the topic, with the creature's own lines.

    No LLM call here (a summon used to wait ~2 minutes on two persona calls and could still fail). The topic-specific
    flavour is written afterwards in the background (boss_flavor_async + merge_flavor, run by
    BattleService.enrich) while the first questions are being generated; `flavor_pending` marks a boss that wants it."""
    boss = bestiary.base_boss(bestiary.pick_species(topic), topic, difficulty)
    sanitize_boss(boss, difficulty)
    boss.update(current_hp=boss["max_hp"], phase=1, rage=False, asked_concepts=[], rounds_fought=0,
                total_damage_taken=0, total_damage_dealt=0, flavor_pending=True)
    return boss


async def boss_flavor_async(vector_store, species: str, topic: str) -> dict:
    """ONE small structured call (title, attacks, a few lines), tried once, capped at FLAVOR_TIMEOUT.
    Raises on any failure - the boss simply keeps the creature's lines."""
    creature = bestiary.CREATURES.get(species) or bestiary.CREATURES["hydra"]

    async def _call():
        context = (await _get_context_async(vector_store, topic, k=5))[:2500]
        messages = [
            SystemMessage(content="You write short boss dialogue for an educational game. Return ONLY valid JSON."),
            HumanMessage(content=BOSS_FLAVOR_PROMPT.format(creature=creature["name"], origin=creature["origin"],
                                                           topic=topic, context=context)),
        ]
        return (await generate_structured_async(messages, BossFlavor, max_attempts=1)).provided()

    return await asyncio.wait_for(_call(), timeout=FLAVOR_TIMEOUT)


def merge_flavor(boss: dict, flavor: dict) -> dict:
    """Lay the LLM's lines over a boss (in place). Combat numbers are never touched."""
    for key in _FLAVOR_KEYS:
        if flavor.get(key):
            boss[key] = str(flavor[key])[:200]
    attacks = [a for a in (flavor.get("attack_names") or []) if a]
    if len(attacks) >= 2:
        boss["attack_names"] = [str(a)[:80] for a in attacks[:3]]
    for key in ("hit_taunts", "miss_taunts"):
        lines = [str(x)[:160] for x in (flavor.get(key) or []) if x]
        if lines:
            boss[key] = lines + list(boss.get(key) or [])[:1]      # keep one creature line for variety
    boss.pop("flavor_pending", None)
    return boss


def generate_boss_persona(vector_store, topic: str, difficulty: str = "hard") -> dict:
    """Synchronous wrapper — kept for backwards compatibility with any sync callers."""
    return asyncio.get_event_loop().run_until_complete(
        generate_boss_persona_async(vector_store, topic, difficulty)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Battle Quiz Generator — ASYNC version
# ─────────────────────────────────────────────────────────────────────────────

async def generate_battle_quiz_async(
    vector_store,
    topic: str,
    difficulty: str = "normal",
    num_questions: int = 5,
    asked_concepts: Optional[list] = None,
    phase: int = 1,
    target_concepts: Optional[list] = None,
) -> dict:
    """Async version — runs LLM in thread pool, never blocks event loop.

    Every question comes back filed under a tier (easy / medium / hard: the arena's moves pick by it).
    `target_concepts` (a Nemesis fight) tells the model to ask about exactly those concepts."""
    if asked_concepts is None:
        asked_concepts = []
    targets = [str(c).strip() for c in (target_concepts or []) if str(c).strip()]
    if targets:
        topic_for_search = " ".join(targets)
        asked_concepts = []                  # a Nemesis asks the same concepts again, on purpose

    k_value = 10 if difficulty == "hard" else 8
    context = (await _get_context_async(vector_store, topic_for_search if targets else topic, k=k_value))[:5000]

    prompt_text = BATTLE_QUIZ_PROMPT.format(
        context=context,
        topic=topic,
        difficulty=difficulty,
        phase=phase,
        asked_concepts=", ".join(asked_concepts) if asked_concepts else "None yet",
        num_questions=num_questions,
        target_block=NEMESIS_TARGET_BLOCK.format(targets="\n".join(f"- {t}" for t in targets)) if targets else "",
    )

    messages = [
        SystemMessage(content=(
            "You are a quiz generator for an educational battle game. "
            "Return ONLY valid JSON with no preamble, explanation, or markdown fences."
        )),
        HumanMessage(content=prompt_text),
    ]
    quiz = await generate_structured_async(messages, BattleQuiz)   # unusable questions are dropped by the schema
    if len(quiz.questions) < num_questions:
        logger.warning(f"Requested {num_questions} questions, got {len(quiz.questions)}")
    return quiz.finalize(difficulty)


def generate_battle_quiz(
    vector_store,
    topic: str,
    difficulty: str = "normal",
    num_questions: int = 5,
    asked_concepts: Optional[list] = None,
    phase: int = 1,
) -> dict:
    """Synchronous wrapper — kept for backwards compatibility."""
    return asyncio.get_event_loop().run_until_complete(
        generate_battle_quiz_async(vector_store, topic, difficulty, num_questions, asked_concepts, phase)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Expedition acts — ONE call at the start of a run
# ─────────────────────────────────────────────────────────────────────────────

async def extract_expedition_acts_async(vector_store, num_acts: int = 3) -> list:
    """The `num_acts` chapters an Expedition goes through, in reading order: [{"title", "topic"}].
    Fewer usable acts than asked are repeated in order (a short document still makes a full run); none at all
    raises StructuredOutputError, so the caller can say "try again" instead of starting a broken run."""
    context = (await _get_context_async(vector_store, "chapters sections overview introduction summary", k=12))[:6000]
    messages = [
        SystemMessage(content=(
            "You are a level designer for an educational roguelite. "
            "Return ONLY valid JSON with no preamble, explanation, or markdown fences."
        )),
        HumanMessage(content=EXPEDITION_ACTS_PROMPT.format(context=context, num_acts=num_acts)),
    ]
    acts = [a.model_dump() for a in (await generate_structured_async(messages, ExpeditionActs)).acts]
    if not acts:
        raise StructuredOutputError("no usable expedition acts")
    return [acts[i % len(acts)] for i in range(num_acts)]


# ─────────────────────────────────────────────────────────────────────────────
# Combat System
# ─────────────────────────────────────────────────────────────────────────────

DAMAGE_TABLE = {
    (0.0, 0.2):  (0.1, "glancing blow"),
    (0.2, 0.4):  (0.3, "weak strike"),
    (0.4, 0.6):  (0.6, "solid hit"),
    (0.6, 0.8):  (0.85, "powerful strike"),
    (0.8, 1.0):  (1.0, "critical hit"),
    (1.0, 1.01): (1.3, "PERFECT STRIKE"),
}

# Difficulty scaling for boss counter-attacks
DIFFICULTY_DAMAGE_MAP = {
    "easy":      {"base": 1, "rage_base": 1},
    "medium":    {"base": 1, "rage_base": 2},
    "hard":      {"base": 2, "rage_base": 3},
    "nightmare": {"base": 3, "rage_base": 5},
}


def get_damage_multiplier(accuracy: float) -> tuple:
    for (low, high), (mult, desc) in DAMAGE_TABLE.items():
        if low <= accuracy < high:
            return mult, desc
    return 1.0, "hit"


def apply_player_attack(boss: dict, score: int, total: int, combo: int = 0) -> dict:
    accuracy = score / max(total, 1)
    multiplier, hit_type = get_damage_multiplier(accuracy)

    base = 35 if boss.get("phase", 1) == 2 else 25
    combo_bonus = min(combo, 5) * 3
    perfect_bonus = 10 if score == total and total >= 3 else 0
    damage = max(int((base + combo_bonus + perfect_bonus) * multiplier), 1)

    boss["current_hp"] = max(0, boss["current_hp"] - damage)
    boss["total_damage_taken"] = boss.get("total_damage_taken", 0) + damage
    boss["rounds_fought"] = boss.get("rounds_fought", 0) + 1

    phase_changed = False
    if (boss["current_hp"] < boss["max_hp"] * boss.get("rage_threshold", 0.4)
            and boss.get("phase", 1) == 1):
        boss["phase"] = 2
        boss["rage"] = True
        phase_changed = True

    if score == total:
        taunt = random.choice(boss.get("hit_taunts", ["Impressive..."]))
    elif score == 0:
        taunt = random.choice(boss.get("miss_taunts", ["Pathetic!"]))
    else:
        pool = boss.get("hit_taunts") if accuracy >= 0.6 else boss.get("miss_taunts")
        taunt = random.choice(pool or ["..."])

    return {
        "damage": damage,
        "hit_type": hit_type,
        "accuracy": round(accuracy * 100),
        "combo_bonus": combo_bonus,
        "perfect_bonus": perfect_bonus,
        "phase_changed": phase_changed,
        "taunt": taunt,
        "boss": boss,
    }


def boss_attack(boss: dict, player_score: int = 0, total: int = 1, difficulty: str = "hard") -> dict:
    """
    Boss counter-attack. Damage now scales with difficulty:
      easy:      1 / rage 1
      medium:    1 / rage 2
      hard:      2 / rage 3
      nightmare: 3 / rage 5
    """
    accuracy = player_score / max(total, 1)
    diff_scale = DIFFICULTY_DAMAGE_MAP.get(difficulty, DIFFICULTY_DAMAGE_MAP["hard"])
    base_damage = diff_scale["rage_base"] if boss.get("rage") else diff_scale["base"]

    if accuracy >= 1.0:
        actual_damage = 0
        attack_name = "deflected"
    elif accuracy >= 0.6:
        actual_damage = max(0, base_damage - 1)
        attack_name = random.choice(boss.get("attack_names", ["Attack"]))
    else:
        actual_damage = base_damage
        attack_name = (
            boss.get("special_ability", "Devastating Strike")
            if boss.get("rage")
            else random.choice(boss.get("attack_names", ["Attack"]))
        )

    boss["total_damage_dealt"] = boss.get("total_damage_dealt", 0) + actual_damage

    return {
        "damage": actual_damage,
        "attack_name": attack_name,
        "boss": boss,
    }


def boss_taunt(boss: dict, situation: str = "idle") -> str:
    phase = boss.get("phase", 1)
    if situation == "phase_change":
        return random.choice(boss.get("phase2_taunts", ["ENOUGH! Now face my true power!"]))
    elif situation == "hit":
        return random.choice(boss.get("hit_taunts", ["Impressive..."]))
    elif situation == "miss":
        return random.choice(boss.get("miss_taunts", ["Pathetic!"]))
    elif situation == "defeat":
        return boss.get("defeat_taunt", "Impossible... defeated...")
    elif situation == "intro":
        return boss.get("intro_taunt", "Prepare yourself!")
    else:
        pool = boss.get("phase2_taunts") if phase == 2 else boss.get("phase1_taunts")
        return random.choice(pool or ["Can you survive?"])


# ─────────────────────────────────────────────────────────────────────────────
# Boss intents (Arena v2): what the boss will do when the coming turn resolves
# ─────────────────────────────────────────────────────────────────────────────

INTENT_KINDS = ("attack", "heavy", "shield", "drain", "heal")
# Relative odds per phase: the rage phase unlocks heal and makes heavy blows common.
INTENT_WEIGHTS = {
    1: {"attack": 55, "heavy": 10, "shield": 20, "drain": 15},
    2: {"attack": 35, "heavy": 25, "shield": 15, "drain": 10, "heal": 15},
}
SHIELD_PCT = 0.10          # a shield absorbs this share of the boss's max HP
HEAL_PCT = 8               # a heal restores this % of the boss's max HP


def intent_base_damage(boss: dict, difficulty: str) -> int:
    """DIFFICULTY_DAMAGE_MAP's base (or rage base): what an `attack` intent hits for."""
    scale = DIFFICULTY_DAMAGE_MAP.get(difficulty, DIFFICULTY_DAMAGE_MAP["hard"])
    return scale["rage_base"] if boss.get("rage") else scale["base"]


def make_intent(kind: str, boss: dict, difficulty: str, shield_factor: float = 1.0) -> dict:
    """The telegraph for one intent: {kind, name, value, description} (+ amount for a heal)."""
    base = intent_base_damage(boss, difficulty)
    names = [n for n in boss.get("attack_names") or [] if n] or ["Attack"]
    if kind == "attack":
        return {"kind": kind, "name": random.choice(names), "value": base,
                "description": f"Attacks for {base}. A right answer halves it; Guard blocks it."}
    if kind == "heavy":
        value = 2 * base
        return {"kind": kind, "name": boss.get("special_ability") or "Heavy Slam", "value": value,
                "description": f"A heavy blow for {value}. A right answer halves it; Guard blocks it."}
    if kind == "shield":
        value = max(1, int(round(boss.get("max_hp", 100) * SHIELD_PCT * shield_factor)))
        return {"kind": kind, "name": "Barrier", "value": value,
                "description": f"Raises a shield absorbing {value} damage. Weakness hits ignore shields."}
    if kind == "drain":
        return {"kind": kind, "name": "Mind Drain", "value": 0,
                "description": "A wrong answer (or running out of time) drains all your Focus."}
    if kind == "heal":
        amount = max(1, int(round(boss.get("max_hp", 100) * HEAL_PCT / 100)))
        return {"kind": kind, "name": "Regenerate", "value": HEAL_PCT, "amount": amount,
                "description": f"Heals {HEAL_PCT}% ({amount} HP) unless a right Strike or Heavy interrupts it."}
    raise ValueError(f"unknown intent {kind!r}")


def roll_intent(boss: dict, difficulty: str, shield_factor: float = 1.0, rng=random) -> dict:
    """The boss's next intent, from the weighted table of its current phase."""
    table = INTENT_WEIGHTS[2 if boss.get("phase", 1) == 2 else 1]
    kinds = list(table)
    kind = rng.choices(kinds, weights=[table[k] for k in kinds], k=1)[0]
    return make_intent(kind, boss, difficulty, shield_factor)


def player_hit(boss: dict, combo: int) -> dict:
    """What a right answer hits for under apply_player_attack's rules, WITHOUT touching the boss."""
    shadow = {k: boss[k] for k in ("phase", "max_hp", "rage_threshold", "hit_taunts", "miss_taunts") if k in boss}
    shadow.update(current_hp=boss.get("current_hp", 0), total_damage_taken=0, rounds_fought=0)
    attack = apply_player_attack(shadow, 1, 1, combo)
    return {"damage": attack["damage"], "hit_type": attack["hit_type"]}
