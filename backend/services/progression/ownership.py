"""Single source of truth for "is this user allowed to wear/use this catalog item?".

Before this existed, /avatar/update and /avatar/hero-forge-save accepted any item id
for any slot, and get_equipment_bonuses() applied the XP/coin bonus of whatever was
*equipped* – so every paid item's bonus could be had for free with one request.
"""
from typing import Dict, Iterable, Optional

from services.progression.catalog import flatten_catalog

_CATALOG: Dict[str, dict] = {it["id"]: it for it in flatten_catalog()}

# Items the frontend treats as the default look (Hero Forge falls back to this).
# Purely cosmetic starter tee – safe to allow without purchase.
STARTER_ITEMS = frozenset({"armor_shirt_basic"})

# Catalog `type` → equipment slot key stored in equipped_json.
SLOT_BY_TYPE = {"armor": "armor", "headgear": "headgear", "weapon": "weapon",
                "pet": "pet", "title": "title"}
EQUIP_SLOTS = frozenset(SLOT_BY_TYPE.values())


def catalog_item(item_id: str) -> Optional[dict]:
    return _CATALOG.get(item_id)


def is_free(item_id: str) -> bool:
    it = _CATALOG.get(item_id)
    return bool(it) and int(it.get("price", 1) or 0) == 0


def can_use_item(item_id: str, owned: Iterable[str]) -> bool:
    """True if the item exists and the user owns it (or it is free / a starter item)."""
    if item_id not in _CATALOG:
        return False
    if item_id in STARTER_ITEMS or is_free(item_id):
        return True
    return item_id in set(owned)


def can_equip_in_slot(item_id: str, slot: str, owned: Iterable[str]) -> bool:
    it = _CATALOG.get(item_id)
    if not it or SLOT_BY_TYPE.get(it.get("type")) != slot:
        return False
    return can_use_item(item_id, owned)
