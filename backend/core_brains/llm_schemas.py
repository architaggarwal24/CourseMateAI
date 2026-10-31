"""Pydantic models for everything the LLM must answer as structured data (quiz, flashcards, arena boss + battle quiz).

One definition does both jobs:
  * `wire_schema(Model)` is the JSON schema sent to the provider (Gemini response schema, OpenAI json_schema,
    Claude tool use, ...), so the model is *asked* for exactly this shape.
  * `Model.model_validate(data, context=...)` is the *check* of what came back. The old "drop invalid questions,
    keep the rest" rules live here as validators: a bad item is dropped, never patched up with made-up values.
"""
import logging
import random
import re
from typing import Any, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator
from pydantic_core import PydanticCustomError

from core_brains.json_utils import _normalize_correct_answer, strip_option_prefixes

logger = logging.getLogger(__name__)


# ── JSON schema sent to providers ────────────────────────────────────────────
def _simplify(node: Any, defs: Dict[str, Any]) -> Any:
    """Inline $refs and strip what providers' schema dialects reject (defaults, titles on properties)."""
    if isinstance(node, list):
        return [_simplify(n, defs) for n in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        return _simplify(defs[node["$ref"].rsplit("/", 1)[-1]], defs)
    out = {k: _simplify(v, defs) for k, v in node.items() if k not in ("default", "$defs")}
    if "properties" in out:
        out["properties"] = {k: ({kk: vv for kk, vv in v.items() if kk != "title"} if isinstance(v, dict) else v)
                             for k, v in out["properties"].items()}
        out["required"] = list(out["properties"])          # every field is asked for; validators accept gaps
        out["additionalProperties"] = False
    return out


def wire_schema(model: Type[BaseModel]) -> Dict[str, Any]:
    """The JSON schema for `model`, in the subset every provider accepts."""
    raw = model.model_json_schema()
    schema = _simplify(raw, raw.get("$defs", {}))
    schema["title"] = model.__name__
    schema["description"] = (model.__doc__ or model.__name__).strip().splitlines()[0]
    return schema


# ── helpers ──────────────────────────────────────────────────────────────────
def _drop_invalid(item_model: Type[BaseModel], items: Any, context: Optional[dict], what: str) -> List[BaseModel]:
    """Validate each item on its own; invalid ones are skipped (and logged), the valid ones are kept."""
    if not isinstance(items, list):
        return []
    kept = []
    for item in items:
        try:
            kept.append(item if isinstance(item, item_model) else item_model.model_validate(item, context=context))
        except ValidationError as exc:
            logger.info("dropped invalid %s: %s", what, exc.errors()[0].get("msg"))
    return kept


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _str_list(value: Any) -> List[str]:
    if isinstance(value, str):
        value = [value]
    return [_text(v) for v in value if _text(v)] if isinstance(value, list) else []


def _reject(message: str):
    raise PydanticCustomError("invalid_item", message)


_DIFFICULTIES = ("easy", "medium", "hard")


# ── quiz ─────────────────────────────────────────────────────────────────────
class QuizQuestion(BaseModel):
    """One quiz question with its answer options, the correct answer and an explanation."""
    question: str
    options: List[str]
    correct_answer: str
    explanation: str = ""
    difficulty: Literal["easy", "medium", "hard"] = "medium"

    @field_validator("question", "correct_answer", "explanation", mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)

    @field_validator("options", mode="before")
    @classmethod
    def _options_as_text(cls, v):
        return [str(o) for o in v] if isinstance(v, list) else v

    @field_validator("difficulty", mode="before")
    @classmethod
    def _known_difficulty(cls, v):
        return v if v in _DIFFICULTIES else "medium"

    @model_validator(mode="after")
    def _quality_rules(self, info):
        """Questions that can't be made valid are DROPPED rather than patched up:
        no/unmappable correct_answer, fewer than 4 MCQ options (never padded with fake options), empty or
        duplicate options."""
        question_type = (info.context or {}).get("question_type", "MCQ")
        if not self.question:
            _reject("empty question")
        if len(self.options) < 2:
            _reject("fewer than 2 options")
        if not self.correct_answer:
            _reject("no correct answer")
        if not self.explanation:
            self.explanation = "See course material."

        is_tf = len(self.options) == 2 and all(o.strip().lower() in ("true", "false") for o in self.options)
        if question_type == "True/False" or is_tf:
            answer = _normalize_correct_answer(self.correct_answer, ["True", "False"], "True/False")
            if answer is None:
                _reject("unmappable true/false answer")
            self.options, self.correct_answer = ["True", "False"], answer
            return self

        if len(self.options) < 4:
            _reject("fewer than 4 options")
        original = self.options[:4]
        # Map the answer against the ORIGINAL (still-labelled) options first, so "B" / "B. text" resolve by
        # label; only then strip the labels for display.
        mapped = _normalize_correct_answer(self.correct_answer, original, "MCQ")
        if mapped is None:
            _reject("unmappable answer")
        clean = strip_option_prefixes(original)
        if any(not o for o in clean) or len({o.lower() for o in clean}) < 4:
            _reject("empty or duplicate options")
        self.correct_answer = clean[original.index(mapped)]
        self.options = clean
        return self


class QuizBatch(BaseModel):
    """A list of quiz questions."""
    questions: List[QuizQuestion]

    @field_validator("questions", mode="before")
    @classmethod
    def _keep_valid(cls, v, info):
        return _drop_invalid(QuizQuestion, v, info.context, "quiz question")

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.questions:
            _reject("no valid questions")
        return self


# ── flashcards ───────────────────────────────────────────────────────────────
class Flashcard(BaseModel):
    """One flashcard: a short front (term or question) and a concise back (the answer)."""
    front: str
    back: str
    topic: str = "general"
    difficulty: Literal["easy", "medium", "hard"] = "medium"

    @field_validator("front", "back", "topic", mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)

    @field_validator("difficulty", mode="before")
    @classmethod
    def _known_difficulty(cls, v):
        return v if v in _DIFFICULTIES else "medium"

    @model_validator(mode="after")
    def _both_sides(self):
        if not self.front or not self.back:
            _reject("a card needs a front and a back")
        self.topic = self.topic or "general"
        return self


class FlashcardSet(BaseModel):
    """A deck of flashcards."""
    cards: List[Flashcard]

    @field_validator("cards", mode="before")
    @classmethod
    def _keep_valid(cls, v, info):
        return _drop_invalid(Flashcard, v, info.context, "flashcard")

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.cards:
            _reject("no valid cards")
        return self


# ── arena: boss ──────────────────────────────────────────────────────────────
def _number(v, cast, default):
    try:
        return cast(float(v))
    except (TypeError, ValueError):
        return default


class BossPersona(BaseModel):
    """The identity and mechanics of an arena boss."""
    model_config = ConfigDict(extra="allow")        # unknown keys are kept, as before

    name: str = ""
    title: str = ""
    tagline: str = ""
    personality: str = ""
    conceptual_core: str = ""
    max_hp: int = 120
    rage_threshold: float = 0.4
    special_ability: str = ""
    weakness: str = ""
    attack_names: List[str] = []

    @field_validator("name", "title", "tagline", "personality", "conceptual_core", "special_ability", "weakness",
                     mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)

    @field_validator("max_hp", mode="before")
    @classmethod
    def _hp(cls, v):
        return _number(v, int, 0)               # 0 -> clamped into the difficulty's range by sanitize_boss

    @field_validator("rage_threshold", mode="before")
    @classmethod
    def _rage(cls, v):
        return _number(v, float, 0.4)

    @field_validator("attack_names", mode="before")
    @classmethod
    def _attacks(cls, v):
        return _str_list(v)

    def provided(self) -> Dict[str, Any]:
        """Only the fields the model actually answered (the caller fills the rest with topic-aware defaults)."""
        answered = self.model_dump(exclude_unset=True)
        return {k: v for k, v in answered.items() if v not in ("", [], None)}


_TAUNT_LISTS = ("phase1_taunts", "phase2_taunts", "hit_taunts", "miss_taunts")


class BossTaunts(BaseModel):
    """The boss's lines of dialogue for each moment of the fight."""
    intro_taunt: str = ""
    phase1_taunts: List[str] = []
    phase2_taunts: List[str] = []
    hit_taunts: List[str] = []
    miss_taunts: List[str] = []
    defeat_taunt: str = ""

    @field_validator("intro_taunt", "defeat_taunt", mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)

    @field_validator(*_TAUNT_LISTS, mode="before")
    @classmethod
    def _lines(cls, v):
        return _str_list(v)

    def provided(self) -> Dict[str, Any]:
        """Non-empty lines only; anything missing falls back to the built-in taunts."""
        return {k: v for k, v in self.model_dump().items() if v}


class BossFlavor(BaseModel):
    """The short, topic-specific layer an LLM writes over a bestiary creature (core_brains/bestiary.py): one small
    answer instead of the old persona + taunts calls, so a summon is quick and never runs out of tokens."""
    title: str = ""
    conceptual_core: str = ""
    weakness: str = ""
    special_ability: str = ""
    attack_names: List[str] = []
    intro_taunt: str = ""
    hit_taunts: List[str] = []
    miss_taunts: List[str] = []
    defeat_taunt: str = ""

    @field_validator("title", "conceptual_core", "weakness", "special_ability", "intro_taunt", "defeat_taunt",
                     mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)[:200]

    @field_validator("attack_names", "hit_taunts", "miss_taunts", mode="before")
    @classmethod
    def _lines(cls, v):
        return [x[:120] for x in _str_list(v)][:4]

    def provided(self) -> Dict[str, Any]:
        return {k: v for k, v in self.model_dump().items() if v not in ("", [], None)}


# ── arena: battle quiz ───────────────────────────────────────────────────────
class BattleQuestion(BaseModel):
    """One arena battle question with its options, correct answer, a hint and an explanation."""
    model_config = ConfigDict(extra="allow")

    id: str = ""
    question: str
    options: List[str]
    correct_answer: str
    explanation: str = ""
    hint: str = ""
    concept: str = ""
    difficulty: str = ""

    @field_validator("id", "question", "correct_answer", "explanation", "hint", "concept", "difficulty",
                     mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)

    @field_validator("options", mode="before")
    @classmethod
    def _options_as_text(cls, v):
        return [str(o) for o in v] if isinstance(v, list) else v

    @model_validator(mode="after")
    def _answer_must_map(self):
        if len(self.options) < 2:
            _reject("fewer than 2 options")
        mapped = _normalize_correct_answer(self.correct_answer, self.options)
        if mapped is None:
            _reject("unmappable answer")        # drop, don't guess
        self.correct_answer = mapped
        return self


QUESTION_TIERS = ("easy", "medium", "hard")
_TIER_ALIASES = {"easy": "easy", "beginner": "easy", "simple": "easy", "medium": "medium", "normal": "medium",
                 "intermediate": "medium", "hard": "hard", "nightmare": "hard", "expert": "hard", "advanced": "hard"}


def question_tier(value: Any, default: str = "medium") -> str:
    """The tier (easy / medium / hard) a battle question is filed under: arena moves pick questions by it.
    Anything the model invents ("expert", "nightmare", "") lands on the nearest known tier."""
    tier = _TIER_ALIASES.get(_text(value).lower())
    if tier:
        return tier
    return _TIER_ALIASES.get(_text(default).lower(), "medium")


class BattleQuiz(BaseModel):
    """A list of arena battle questions."""
    questions: List[BattleQuestion]

    @field_validator("questions", mode="before")
    @classmethod
    def _keep_valid(cls, v, info):
        return _drop_invalid(BattleQuestion, v, info.context, "battle question")

    def finalize(self, difficulty: str) -> Dict[str, Any]:
        """Plain dicts with the defaults the arena client relies on."""
        out = []
        for i, q in enumerate(self.questions):
            d = q.model_dump()
            d["id"] = d["id"] or f"q{i + 1}_{random.randint(1000, 9999)}"
            d["explanation"] = d["explanation"] or "Review this concept in the material."
            d["hint"] = d["hint"] or "Think carefully about the key concepts."
            d["concept"] = d["concept"] or f"concept_{i + 1}"
            d["difficulty"] = question_tier(d["difficulty"], default=difficulty)      # always easy | medium | hard
            out.append(d)
        return {"questions": out}


# ── arena: expedition acts ───────────────────────────────────────────────────
class ExpeditionAct(BaseModel):
    """One act of an Expedition: a chapter of the document and the topic its fights are about."""
    title: str
    topic: str

    @field_validator("title", "topic", mode="before")
    @classmethod
    def _as_text(cls, v):
        return _text(v)[:100]

    @model_validator(mode="after")
    def _both(self):
        if not self.topic:
            _reject("an act needs a topic")
        self.title = self.title or self.topic
        return self


class ExpeditionActs(BaseModel):
    """The acts (chapters, in reading order) an Expedition run goes through."""
    acts: List[ExpeditionAct]

    @field_validator("acts", mode="before")
    @classmethod
    def _keep_valid(cls, v, info):
        return _drop_invalid(ExpeditionAct, v, info.context, "expedition act")


_TOPIC_KEY = re.compile(r"\W+")


def question_key(text: str) -> str:
    """Normalised question text, used to drop duplicates produced by parallel batches."""
    return _TOPIC_KEY.sub(" ", text.lower()).strip()
