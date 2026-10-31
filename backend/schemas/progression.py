from typing import Optional

from pydantic import BaseModel


class RewardAwardRequest(BaseModel):
    action_type: str
    accuracy: float = 1.0
    difficulty: float = 1.0
    combo_count: int = 1


class QuestClaimRequest(BaseModel):
    quest_type: str


# ── responses ─────────────────────────────────────────────────────────────────
from typing import Any, Dict, List  # noqa: E402

from .base import ApiModel  # noqa: E402


class ProfileResponse(ApiModel):
    progress: Dict[str, Any]
    avatar: Dict[str, Any]
    guest_mode: bool


class RewardResponse(ApiModel):
    """Result of RewardService.award(): ok=false with reason when capped, else the full breakdown."""
    ok: Optional[bool] = None


class DailyQuestsResponse(ApiModel):
    quests: List[Any]


class QuestClaimResponse(ApiModel):
    ok: bool


class HudResponse(ApiModel):
    progress: Dict[str, Any]
    quests: List[Any]
    shop: Dict[str, Any]
    buffs: Optional[Dict[str, Any]] = None
    consumable_inventory: Optional[Dict[str, int]] = None
    guest_mode: bool


class AchievementsResponse(ApiModel):
    achievements: List[Any]
    unlocked: Dict[str, Any]
    progress: Dict[str, Any]
    guest_mode: bool
