"""Shop and consumable items."""
from fastapi import APIRouter, Depends

from errors import AppError
from deps import require_auth
from schemas import ShopEquipRequest, ShopPurchaseRequest, ShopUnequipRequest, UseItemRequest
from schemas.shop import ShopActionResponse, ShopStateResponse, UseItemResponse
from state import buff_service, shop_service, store

router = APIRouter()


@router.get("/shop", response_model=ShopStateResponse, response_model_exclude_unset=True)
def get_shop(user=Depends(require_auth)):
    user_id = str(user['user_id'])
    return shop_service.get_shop_state(user_id)


@router.post("/shop/purchase", response_model=ShopActionResponse, response_model_exclude_unset=True)
def shop_purchase(req: ShopPurchaseRequest, user=Depends(require_auth)):
    user_id = str(user['user_id'])
    return shop_service.purchase(user_id, req.item_id)


@router.post("/shop/equip", response_model=ShopActionResponse, response_model_exclude_unset=True)
def shop_equip(req: ShopEquipRequest, user=Depends(require_auth)):
    user_id = str(user['user_id'])
    return shop_service.equip(user_id, req.item_id)


@router.post("/shop/unequip", response_model=ShopActionResponse, response_model_exclude_unset=True)
def shop_unequip(req: ShopUnequipRequest, user=Depends(require_auth)):
    """Unequip an item from a specific equipment slot"""
    user_id = str(user['user_id'])
    return shop_service.unequip(user_id, req.slot)


@router.post("/items/use", response_model=UseItemResponse, response_model_exclude_unset=True)
def use_item(req: UseItemRequest, user=Depends(require_auth)):
    """Use a consumable item from inventory. Applies its effect immediately."""
    user_id = str(user['user_id'])

    item = shop_service._item_map.get(req.item_id)
    if not item:
        raise AppError("item_not_found", "That item doesn't exist.", status_code=404)
    if not item.get("consumable"):
        raise AppError("item_not_usable", "That item can't be used.", status_code=400)
    effect = item.get("effect")
    if not effect:
        raise AppError("item_not_usable", "That item can't be used.", status_code=400)

    # Check quantity → apply buff → consume must be ONE critical section. Before, two
    # parallel requests both saw qty=1, both applied the buff, and only one consume
    # succeeded – so one potion produced two effects.
    with store.atomic():
        if store.get_inventory_quantity(user_id, req.item_id) < 1:
            raise AppError("item_not_owned", "You don't have that item in your inventory.", status_code=400)

        result = buff_service.apply_buff(user_id, effect)
        if not result.get("ok"):
            raise AppError("item_not_usable", result.get("reason") or "You can't use that item right now.", status_code=400)

        if not store.consume_inventory_item(user_id, req.item_id):
            raise AppError("item_use_failed", "Couldn't use that item. Please try again.", status_code=400, action="retry")
        active_buffs = buff_service.get_active_buffs(user_id)

    return {
        "ok": True,
        "item_id": req.item_id,
        "item_name": item["name"],
        "effect": effect,
        "message": result.get("message", "Item used!"),
        "expires_at": result.get("expires_at"),
        "active_buffs": active_buffs,
        # For hint_scroll: tell client how many charges are now available
        "hint_charges": active_buffs.get("hint_charges", {}).get("count", 0) if effect == "hint_charge" else None,
    }
