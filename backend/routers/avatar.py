"""Avatar and hero-forge customisation."""
import json
import re

from fastapi import APIRouter, Depends

from deps import require_auth
from schemas import AvatarConfigRequest, AvatarUpdateRequest
from schemas.avatar import AvatarResponse, AvatarUpdateResponse, HeroForgeSaveResponse
from services.progression.ownership import EQUIP_SLOTS, can_equip_in_slot
from state import store

router = APIRouter()


@router.get("/avatar", response_model=AvatarResponse, response_model_exclude_unset=True)
def get_avatar(user=Depends(require_auth)):
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    avatar = store.get_avatar(user_id)
    equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")
    owned = json.loads(avatar.get("owned_json", "[]") or "[]")
    return {
        "equipped": equipped,
        "owned": owned,
        "skin_id":      equipped.get("skin_id",      ""),
        "hair_id":      equipped.get("hair_id",      ""),
        "eye_color_id": equipped.get("eye_color_id", ""),
        "lip_color_id": equipped.get("lip_color_id", ""),
        "body_type_id": equipped.get("body_type_id", ""),
        "outfit_id":    equipped.get("outfit_id",    ""),
    }


_COSMETIC_KEYS = ("skin_id", "hair_id", "eye_color_id", "lip_color_id", "body_type_id")


_COSMETIC_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def _apply_avatar_changes(equipped: dict, owned: list, cosmetics: dict, slots: dict, outfit_id: str = "") -> None:
    """Apply a requested avatar change IN PLACE, enforcing ownership.

    Previously the endpoints wrote whatever item ids the client sent, and the reward
    code applied the XP/coin bonus of every equipped item – so any paid item (and its
    bonus) could be "worn" for free. Now an item only goes into a slot if it exists,
    fits that slot, and the user owns it (or it's free / the starter tee). Requests
    for items the user can't use are skipped silently so the UI keeps working.
    """
    for key in _COSMETIC_KEYS:
        val = cosmetics.get(key)
        if val and isinstance(val, str) and _COSMETIC_ID_RE.match(val):
            equipped[key] = val

    slots = dict(slots)
    if outfit_id:
        slots["armor"] = outfit_id   # legacy hero-forge field == the armor slot

    for slot, item_id in slots.items():
        if slot not in EQUIP_SLOTS:
            continue
        if item_id in ("", "none", None):
            equipped.pop(slot, None)
            if slot == "armor":
                equipped.pop("outfit_id", None)
            continue
        if isinstance(item_id, str) and can_equip_in_slot(item_id, slot, owned):
            equipped[slot] = item_id
            if slot == "armor":
                equipped["outfit_id"] = item_id   # legacy compat


@router.post("/avatar/update", response_model=AvatarUpdateResponse, response_model_exclude_unset=True)
def update_avatar(req: AvatarUpdateRequest, user=Depends(require_auth)):
    user_id = str(user['user_id'])
    requested = req.equipped or {}
    cosmetics = {**{k: requested.get(k) for k in _COSMETIC_KEYS},
                 "skin_id": req.skin_id or requested.get("skin_id"),
                 "hair_id": req.hair_id or requested.get("hair_id")}
    slots = {k: v for k, v in requested.items() if k in EQUIP_SLOTS}
    outfit = req.outfit_id or requested.get("outfit_id") or ""

    equipped, owned = store.modify_avatar(
        user_id,
        lambda eq, ow: _apply_avatar_changes(eq, ow, cosmetics, slots, outfit),
    )
    return {"ok": True, "equipped": equipped, "owned": owned}


@router.post("/avatar/hero-forge-save", response_model=HeroForgeSaveResponse, response_model_exclude_unset=True)
def hero_forge_save(req: AvatarConfigRequest, user=Depends(require_auth)):
    """Save hero-forge customization (skin, hair, outfit + equipment)"""
    user_id = str(user['user_id'])
    cosmetics = {
        "body_type_id": req.body_type_id, "skin_id": req.skin_id, "hair_id": req.hair_id,
        "eye_color_id": req.eye_color_id, "lip_color_id": req.lip_color_id,
    }
    # "" means "not provided" (unchanged, as before); "none" explicitly unequips.
    slots = {k: v for k, v in
             {"headgear": req.headgear, "weapon": req.weapon, "pet": req.pet}.items() if v}
    equipped, _owned = store.modify_avatar(
        user_id,
        lambda eq, ow: _apply_avatar_changes(eq, ow, cosmetics, slots, req.outfit_id),
    )
    return {"ok": True, "equipped": equipped}
