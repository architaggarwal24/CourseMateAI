from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

from .base import ApiModel


# ── requests ──────────────────────────────────────────────────────────────────
class BattleCreateRequest(BaseModel):
    """Start (or resume) a server-side boss fight on one of the user's documents."""
    session_id: str                      # the document id, as everywhere else in the API
    topic: str = ""                      # required for mode "quick"; a Nemesis builds its own from weak concepts
    difficulty: str = "hard"             # easy | medium | hard | nightmare (checked against the allowlist)
    mode: Literal["quick", "nemesis"] = "quick"


class BattleAnswerRequest(BaseModel):
    question_id: int                     # the id of the question the server issued
    answer: str                          # one of the options exactly as the server sent them


class BattleItemRequest(BaseModel):
    item: str                            # "heal" | "fifty_fifty": what the user owns is decided by the server


class BattleSpellRequest(BaseModel):
    spell: str                           # "insight" (1 Focus: two wrong options go) | "timewarp" (1 Focus: +15 s)


class RunCreateRequest(BaseModel):
    """Start (or resume) an Expedition run through one of the user's documents."""
    session_id: str
    difficulty: str = "medium"


class RunTravelRequest(BaseModel):
    node_id: str                         # a node reachable from where the run stands


class RunChooseRequest(BaseModel):
    """Answer the run's pending choice. rest: heal | study (target = concept); shop: buy (target = item id) | leave;
    relic offer: take (target = relic id) | skip."""
    action: str
    target: Optional[str] = None


# ── responses ─────────────────────────────────────────────────────────────────
class LeaderboardResponse(ApiModel):
    ok: bool
    date: str
    entries: List[Dict[str, Any]]
    total: int


class BattleResponse(ApiModel):
    """A battle: its boss, hearts, phase, combo and status. Never a correct answer."""
    ok: bool
    battle_id: str


class BattleQuestionResponse(ApiModel):
    """The next question (options shuffled by the server, no answer) and the battle's state."""
    ok: bool
    battle: Dict[str, Any]
    question: Optional[Dict[str, Any]] = None
    previous: Optional[Dict[str, Any]] = None        # the question that ran out of time since the last visit, if any
    stock: Optional[Dict[str, int]] = None           # heal / fifty_fifty charges the user holds


class BattleAnswerResponse(ApiModel):
    """The graded result of one answer: correct answer, explanation, damage both ways, taunt and the new state."""
    ok: bool
    replayed: bool
    correct: bool
    battle: Dict[str, Any]


class BattleItemResponse(ApiModel):
    ok: bool
    item: str
    battle: Dict[str, Any]


class BattleForfeitResponse(ApiModel):
    ok: bool
    battle: Dict[str, Any]


class BattleActiveResponse(ApiModel):
    ok: bool
    battle: Optional[Dict[str, Any]] = None


class BattleSpellResponse(ApiModel):
    ok: bool
    spell: str
    cost: int
    battle: Dict[str, Any]
    question: Optional[Dict[str, Any]] = None


class WeakConceptsResponse(ApiModel):
    """The concepts of a document the user keeps missing, weakest first."""
    ok: bool
    concepts: List[Dict[str, Any]]
    missed_total: int                    # concepts missed at least once
    nemesis_ready: bool                  # enough of them (>= 3) for a Nemesis battle


class RunResponse(ApiModel):
    """An Expedition run: map of the current act, where the player stands and can go, hearts / gold / relics,
    the pending choice (if any) and the fight in progress (if any)."""
    ok: bool
    run: Optional[Dict[str, Any]] = None


class RunTravelResponse(ApiModel):
    ok: bool
    run: Dict[str, Any]
    node: Dict[str, Any]
    battle_id: Optional[str] = None      # a fight node: the battle to play (the usual /arena/battles/{id} endpoints)
    boss: Optional[Dict[str, Any]] = None
    battle: Optional[Dict[str, Any]] = None
    gained: Optional[Dict[str, Any]] = None      # treasure: the relic found


class RunChooseResponse(ApiModel):
    ok: bool
    run: Dict[str, Any]
    outcome: Dict[str, Any]


class RunLeaderboardResponse(ApiModel):
    ok: bool
    scope: str
    entries: List[Dict[str, Any]]
    total: int
