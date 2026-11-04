"""The six pixel champions (frontend/src/lib/pixel/heroes.ts) - the player's avatar everywhere.

The champion is stored on the account (user_avatar.champion_id, migration 0008). Its skins are the shop's
cosmetics, worn in the same equipment slots as before (equipped_json), so prices, ownership, study bonuses and
arena gear are unchanged. One loadout is shared by every champion.
"""
from typing import Optional

CHAMPIONS = ("kaien", "asha", "brak", "mira", "vex", "thorne")
DEFAULT_CHAMPION = "kaien"

# The equipment slots that are champion skins (titles are worn too, but they are not drawn).
LOADOUT_SLOTS = ("armor", "headgear", "weapon", "pet")

# Retired Hero Forge body types -> the champion closest in build (used once, by migration 0008).
_LEGACY_BODY = {"male_default": "kaien", "male_athletic": "brak", "female_elegant": "mira", "female_sporty": "asha"}


def is_champion(champion_id: object) -> bool:
    return isinstance(champion_id, str) and champion_id in CHAMPIONS


def champion_from_legacy(body_type_id: Optional[str]) -> Optional[str]:
    return _LEGACY_BODY.get(body_type_id or "")


def loadout_of(equipped: dict) -> dict:
    """The skin slots of an equipped map, every slot present (None = empty)."""
    return {slot: (equipped.get(slot) or None) for slot in LOADOUT_SLOTS}
