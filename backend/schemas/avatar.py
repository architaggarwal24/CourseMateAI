from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .base import ApiModel


class AvatarUpdateRequest(BaseModel):
    """Wear items by slot: {"armor": "<item id>", "pet": "none", ...}. Ownership is enforced by the server."""
    equipped: Dict[str, Any] = Field(default_factory=dict)


class ChampionRequest(BaseModel):
    """Choose a champion; `loadout` (optional) wears skins in the same save: slot -> item id, or "none" to empty it."""
    champion_id: str = Field(min_length=1, max_length=32)
    loadout: Optional[Dict[str, Optional[str]]] = None


# ── responses ─────────────────────────────────────────────────────────────────
class AvatarResponse(ApiModel):
    equipped: Dict[str, Any]
    owned: List[Any]
    champion_id: Optional[str] = None
    champion_chosen: Optional[bool] = None


class AvatarUpdateResponse(ApiModel):
    ok: bool
    equipped: Dict[str, Any]
    owned: List[Any]


class Loadout(ApiModel):
    """The champion's skins: one shop item id per slot, or null when the slot is empty."""
    armor: Optional[str] = None
    headgear: Optional[str] = None
    weapon: Optional[str] = None
    pet: Optional[str] = None


class MasteryUnlock(ApiModel):
    id: str
    slot: str
    level: int


class KitText(ApiModel):
    name: str
    text: str


class ChampionKit(ApiModel):
    passive: KitText
    ultimate: KitText


class ChampionProgress(ApiModel):
    """A champion's XP from battles fought with it, its level (1-10) and the mastery skins its levels unlock."""
    xp: int
    level: int
    level_xp: int
    next_level_xp: Optional[int] = None          # None at the top level
    battles: int
    wins: int
    mastery: List[MasteryUnlock]
    kit: ChampionKit


class ChampionResponse(ApiModel):
    champion_id: str
    #: False until the player picks one (a default, or one mapped from the retired Hero Forge, shows meanwhile).
    chosen: bool
    champions: List[str]
    loadout: Loadout
    progress: Dict[str, ChampionProgress] = Field(default_factory=dict)
