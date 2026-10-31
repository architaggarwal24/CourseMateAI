from typing import Optional

from pydantic import BaseModel, Field


class AvatarUpdateRequest(BaseModel):
    equipped: dict = Field(default_factory=dict)
    skin_id: str = ""
    hair_id: str = ""
    outfit_id: str = ""


class AvatarConfigRequest(BaseModel):
    """Save hero-forge customization: skin, hair, outfit, headgear, weapon, pet"""
    body_type_id: str = ""
    skin_id:      str = ""
    hair_id:      str = ""
    eye_color_id: str = ""
    lip_color_id: str = ""
    outfit_id:    str = ""
    headgear:     str = ""
    weapon:       str = ""
    pet:          str = ""


# ── responses ─────────────────────────────────────────────────────────────────
from typing import Any, Dict, List  # noqa: E402

from .base import ApiModel  # noqa: E402


class AvatarResponse(ApiModel):
    equipped: Dict[str, Any]
    owned: List[Any]
    skin_id: Optional[str] = None
    hair_id: Optional[str] = None
    eye_color_id: Optional[str] = None
    lip_color_id: Optional[str] = None
    body_type_id: Optional[str] = None
    outfit_id: Optional[str] = None


class AvatarUpdateResponse(ApiModel):
    ok: bool
    equipped: Dict[str, Any]
    owned: List[Any]


class HeroForgeSaveResponse(ApiModel):
    ok: bool
    equipped: Dict[str, Any]
