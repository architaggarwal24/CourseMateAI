from core_brains.json_utils import _normalize_correct_answer
import json
import random
import re
import asyncio
from typing import Optional
from langchain_core.messages import SystemMessage, HumanMessage
from core_brains.llm_connection import ask_llm, ask_llm_async
from prompts.boss_prompts import BOSS_PERSONA_PROMPT, BOSS_TAUNT_PROMPT, BATTLE_QUIZ_PROMPT


# ─────────────────────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────────────────────

def safe_json_extract(text: str) -> dict:
    """Extract JSON from LLM output, handling markdown fences and minor issues."""
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        block = json_match.group(1)
    else:
        start = text.find('{')
        if start == -1:
            raise ValueError("No JSON found in response")
        depth = 0
        end = start
        for i, ch in enumerate(text[start:], start):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth <= 0:
                    end = i
                    break
        block = text[start:end + 1]

    try:
        return json.loads(block)
    except json.JSONDecodeError as e:
        try:
            open_braces = block.count('{') - block.count('}')
            open_brackets = block.count('[') - block.count(']')
            fixed = block
            for _ in range(open_brackets):
                fixed += ']'
            for _ in range(open_braces):
                fixed += '}'
            return json.loads(fixed)
        except Exception:
            raise ValueError(f"Invalid JSON: {str(e)}\n{block[:500]}")


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

async def generate_boss_persona_async(vector_store, topic: str, difficulty: str = "hard") -> dict:
    """
    Async version of generate_boss_persona.
    Runs persona call first (needed to build the taunt prompt), then taunt call.
    Both run in a thread pool so they never block the event loop.
    """
    context = (await _get_context_async(vector_store, topic))[:4000]

    difficulty_hp_map = {"easy": 60, "medium": 90, "hard": 130, "nightmare": 180}
    difficulty_hp_hint = difficulty_hp_map.get(difficulty, 120)

    # ── Call 1: Identity & mechanics ─────────────────────────────────────────
    persona_messages = [
        SystemMessage(content=(
            "You are a game designer for a Soulslike educational game. "
            "Return ONLY valid JSON with no preamble, explanation, or markdown fences."
        )),
        HumanMessage(content=BOSS_PERSONA_PROMPT.format(
            context=context,
            topic=topic,
            difficulty=difficulty,
            difficulty_hp_hint=difficulty_hp_hint,
        )),
    ]
    persona_raw = await ask_llm_async(persona_messages)
    boss = safe_json_extract(persona_raw)

    boss.setdefault("name", f"The {topic.title()} Guardian")
    boss.setdefault("title", "Keeper of Knowledge")
    boss.setdefault("tagline", f"Guardian of {topic} Knowledge")
    boss.setdefault("personality", f"A formidable {difficulty} challenger")
    boss.setdefault("conceptual_core", f"The embodiment of {topic}.")
    boss.setdefault("max_hp", 120)
    boss.setdefault("rage_threshold", 0.4)
    boss.setdefault("special_ability", "Knowledge Drain")
    boss.setdefault("weakness", topic)
    boss.setdefault("attack_names", ["Concept Crush", "Theory Slam", "Knowledge Void"])

    # ── Call 2: Dialogue (async — runs in thread pool, doesn't block event loop) ──
    taunt_messages = [
        SystemMessage(content=(
            "You are a game writer for a Soulslike educational game. "
            "Return ONLY valid JSON with no preamble, explanation, or markdown fences."
        )),
        HumanMessage(content=BOSS_TAUNT_PROMPT.format(
            name=boss["name"],
            title=boss["title"],
            conceptual_core=boss["conceptual_core"],
            topic=topic,
            context=context,
        )),
    ]
    taunt_raw = await ask_llm_async(taunt_messages)
    try:
        taunts = safe_json_extract(taunt_raw)
    except Exception as _taunt_err:
        import logging as _tlog
        _tlog.getLogger(__name__).warning(f"Taunt JSON failed ({_taunt_err}), using defaults")
        taunts = {}

    boss["intro_taunt"] = taunts.get(
        "intro_taunt",
        f"You dare challenge the master of {topic}? Prepare yourself!"
    )
    boss["phase1_taunts"] = taunts.get("phase1_taunts", [
        f"Your understanding of {topic} is laughable!",
        "Is that the best answer you can muster?",
        "The textbook weeps at your ignorance!",
        f"Even a novice knows more about {topic}!",
        "Pathetic! Study harder!",
    ])
    boss["phase2_taunts"] = taunts.get("phase2_taunts", [
        "ENOUGH! Now face my TRUE power!",
        f"You think you understand {topic}? You understand NOTHING!",
        "The hardest questions await you now!",
        "Your luck ends here, scholar!",
        "FEEL THE WEIGHT OF KNOWLEDGE ITSELF!",
    ])
    boss["hit_taunts"] = taunts.get("hit_taunts", [
        "Impressive... you actually studied!",
        "A lucky strike! It won't happen again!",
        "You... you actually know this?!",
        "Grr... well played, scholar.",
    ])
    boss["miss_taunts"] = taunts.get("miss_taunts", [
        f"HAHAHA! You call yourself a student of {topic}?!",
        "Wrong! Your ignorance is my strength!",
        "Did you even READ the material?!",
        "Pathetic! That answer was embarrassing!",
    ])
    boss["defeat_taunt"] = taunts.get(
        "defeat_taunt",
        f"No... defeated by a mere student of {topic}... impossible..."
    )

    boss["current_hp"] = boss["max_hp"]
    boss["rage_threshold"] = float(boss.get("rage_threshold", 0.4))
    boss["phase"] = 1
    boss["rage"] = False
    boss["asked_concepts"] = []
    boss["rounds_fought"] = 0
    boss["total_damage_taken"] = 0
    boss["total_damage_dealt"] = 0

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
) -> dict:
    """Async version — runs LLM in thread pool, never blocks event loop."""
    if asked_concepts is None:
        asked_concepts = []

    k_value = 10 if difficulty == "hard" else 8
    context = (await _get_context_async(vector_store, topic, k=k_value))[:5000]

    prompt_text = BATTLE_QUIZ_PROMPT.format(
        context=context,
        topic=topic,
        difficulty=difficulty,
        phase=phase,
        asked_concepts=", ".join(asked_concepts) if asked_concepts else "None yet",
        num_questions=num_questions,
    )

    messages = [
        SystemMessage(content=(
            "You are a quiz generator for an educational battle game. "
            "Return ONLY valid JSON with no preamble, explanation, or markdown fences."
        )),
        HumanMessage(content=prompt_text),
    ]
    raw = await ask_llm_async(messages)
    quiz = safe_json_extract(raw)

    questions = quiz.get("questions", [])
    if len(questions) < num_questions:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            f"Requested {num_questions} questions, got {len(questions)}"
        )

    validated = []
    for i, q in enumerate(questions):
        if "options" not in q or "correct_answer" not in q:
            continue

        q.setdefault("id", f"q{i + 1}_{random.randint(1000, 9999)}")
        q.setdefault("explanation", "Review this concept in the material.")
        q.setdefault("hint", "Think carefully about the key concepts.")
        q.setdefault("concept", f"concept_{i + 1}")
        q.setdefault("difficulty", difficulty)

        q["correct_answer"] = _normalize_correct_answer(q["correct_answer"], q["options"])
        validated.append(q)

    quiz["questions"] = validated
    return quiz


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