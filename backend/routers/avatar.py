"""The avatar: the player's pixel champion and the skins it wears.

    GET  /avatar            equipped slots + owned items (+ the champion)
    POST /avatar/update     wear / take off items by slot (ownership enforced)
    GET  /avatar/champion   the champion and its skin loadout
    PUT  /avatar/champion   choose a champion, optionally with a loadout, in one save

Skins are shop items (backend/content/shop.json) worn in the equipment slots, so prices, ownership, study bonuses
and arena gear work exactly as before. The retired Hero Forge (skin tone, hair, body type...) has no endpoint.
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Request

from deps import require_auth
from errors import AppError
from schemas import AvatarUpdateRequest
from schemas.avatar import AvatarResponse, AvatarUpdateResponse, ChampionRequest, ChampionResponse
from services.progression.champions import CHAMPIONS, DEFAULT_CHAMPION, LOADOUT_SLOTS, is_champion, loadout_of
from core_brains import kits
from services.progression.ownership import EQUIP_SLOTS, can_equip_in_slot, mastery_champion
from state import store, limiter

router = APIRouter()


def _champion(avatar: dict) -> tuple:
    """(champion id, chosen by the player?) - an unset or unknown id shows the default champion."""
    cid = avatar.get("champion_id")
    return (cid if is_champion(cid) else DEFAULT_CHAMPION), bool(avatar.get("champion_set_at")) and is_champion(cid)


def _apply_slots(equipped: dict, owned: list, slots: dict, allowed=EQUIP_SLOTS, champion: Optional[str] = None) -> None:
    """Wear or remove items IN PLACE, enforcing ownership.

    An item only goes into a slot if it exists, fits that slot and the user owns it (or it is free / the starter
    tee). "" / "none" / None empties the slot. Anything else (unknown slots, unowned or misplaced items) is skipped
    silently so the UI keeps working - and so no paid item, or its bonus, can be worn for free.
    """
    for slot, item_id in slots.items():
        if slot not in allowed:
            continue
        if item_id in ("", "none", None):
            equipped.pop(slot, None)
        elif isinstance(item_id, str) and can_equip_in_slot(item_id, slot, owned, champion):
            equipped[slot] = item_id


def _drop_other_mastery(equipped: dict, champion: str) -> None:
    """Mastery skins are worn only by their own champion: a switch takes the others off."""
    for slot, item_id in list(equipped.items()):
        owner = mastery_champion(item_id) if isinstance(item_id, str) else None
        if owner and owner != champion:
            equipped.pop(slot, None)


@router.get("/avatar", response_model=AvatarResponse, response_model_exclude_unset=True)
def get_avatar(user=Depends(require_auth)):
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    avatar = store.get_avatar(user_id)
    champion, chosen = _champion(avatar)
    return {
        "equipped": json.loads(avatar.get("equipped_json", "{}") or "{}"),
        "owned": json.loads(avatar.get("owned_json", "[]") or "[]"),
        "champion_id": champion,
        "champion_chosen": chosen,
    }


@router.post("/avatar/update", response_model=AvatarUpdateResponse, response_model_exclude_unset=True)
@limiter.limit("60/minute")
def update_avatar(req: AvatarUpdateRequest, request: Request, user=Depends(require_auth)):
    user_id = str(user['user_id'])
    slots = {k: v for k, v in (req.equipped or {}).items() if k in EQUIP_SLOTS}
    champion, _ = _champion(store.get_avatar(user_id))
    equipped, owned = store.modify_avatar(user_id, lambda eq, ow: _apply_slots(eq, ow, slots, champion=champion))
    return {"ok": True, "equipped": equipped, "owned": owned}


def _champion_state(user_id: str) -> dict:
    avatar = store.get_avatar(user_id)
    champion, chosen = _champion(avatar)
    equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")
    rows = store.get_champion_progress(user_id)
    progress = {}
    for cid in CHAMPIONS:
        r = rows.get(cid) or {"xp": 0, "level": 1, "battles": 0, "wins": 0}
        level = int(r["level"])
        progress[cid] = {"xp": int(r["xp"]), "level": level, "next_level_xp": kits.next_level_xp(level),
                         "level_xp": kits.LEVEL_XP[level - 1], "battles": int(r["battles"]), "wins": int(r["wins"]),
                         "mastery": kits.mastery_unlocks(cid),
                         "kit": {"passive": {"name": kits.KITS[cid].passive_name, "text": kits.KITS[cid].passive_text},
                                 "ultimate": {"name": kits.KITS[cid].ultimate_name, "text": kits.KITS[cid].ultimate_text}}}
    return {"champion_id": champion, "chosen": chosen, "champions": list(CHAMPIONS), "loadout": loadout_of(equipped),
            "progress": progress}


@router.get("/avatar/champion", response_model=ChampionResponse)
def get_champion(user=Depends(require_auth)):
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    return _champion_state(user_id)


@router.put("/avatar/champion", response_model=ChampionResponse)
@limiter.limit("60/minute")
def put_champion(req: ChampionRequest, request: Request, user=Depends(require_auth)):
    user_id = str(user['user_id'])
    if not is_champion(req.champion_id):
        raise AppError("unknown_champion", "That champion doesn't exist.", status_code=422,
                       details={"champions": list(CHAMPIONS)})
    def _dress(eq, ow):
        _drop_other_mastery(eq, req.champion_id)
        if req.loadout:
            _apply_slots(eq, ow, req.loadout, allowed=LOADOUT_SLOTS, champion=req.champion_id)

    with store.transaction():
        store.set_champion(user_id, req.champion_id)
        store.modify_avatar(user_id, _dress)
    return _champion_state(user_id)
