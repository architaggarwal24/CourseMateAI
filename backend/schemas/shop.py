from typing import Optional

from pydantic import BaseModel


class ShopPurchaseRequest(BaseModel):
    item_id: str


class ShopEquipRequest(BaseModel):
    item_id: str


class ShopUnequipRequest(BaseModel):
    slot: str  # "headgear", "armor", "weapon", "pet", or "title"


class UseItemRequest(BaseModel):
    item_id: str


# ── responses ─────────────────────────────────────────────────────────────────
from typing import Any, Dict  # noqa: E402

from .base import ApiModel  # noqa: E402


class ShopStateResponse(ApiModel):
    shop_unlocked: bool
    level: int
    coins: int


class ShopActionResponse(ApiModel):
    """Purchase / equip / unequip: {"ok": bool, "reason"?: str, ...}. Business failures are 200 with ok=false."""
    ok: bool
    reason: Optional[str] = None
    message: Optional[str] = None


class UseItemResponse(ApiModel):
    ok: bool
    item_id: str
    item_name: str
    effect: str
    message: str
    expires_at: Optional[Any] = None
    active_buffs: Dict[str, Any]
    hint_charges: Optional[int] = None
