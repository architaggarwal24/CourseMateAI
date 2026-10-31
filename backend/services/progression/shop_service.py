import json
from services.progression.catalog import flatten_catalog, CATEGORY_UNLOCK_LEVELS, CATEGORY_INFO
from services.progression.ownership import SLOT_BY_TYPE, can_equip_in_slot

# Stack limits for arena consumables (kept in sync with buff_service.ARENA_MAX_STACKS)
STACK_LIMITS = {
    "potion_health_small": 3,   # Crimson Vial
    "fifty_fifty":         2,   # Veil of Duality
}

# Maps item_id → buff effect key (for counting buffed charges toward stack limit)
ITEM_TO_BUFF_EFFECT = {
    "potion_health_small": "heal_1",
    "fifty_fifty":         "fifty_fifty",
}


class ShopService:
    def __init__(self, store, buff_service=None):
        self.store = store
        self.buff_service = buff_service
        self._items = flatten_catalog()
        self._item_map = {i["id"]: i for i in self._items}

    def get_shop_state(self, user_id: str, progress: dict = None) -> dict:
        """Return full shop state. Pass pre-loaded progress to skip a DB read."""
        if progress is None:
            progress = self.store.get_progress(user_id)
        avatar = self.store.get_avatar(user_id)

        level  = int(progress.get("current_level", 1) or 1)
        coins  = int(progress.get("coins", 0) or 0)
        owned  = json.loads(avatar.get("owned_json",  "[]") or "[]")
        equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")

        # ── Auto-grant all free (price=0) items ───────────────────────────────
        # This ensures starter gi outfits and headbands are always owned without
        # requiring a purchase flow.
        free_ids = [
            it["id"] for it in self._items
            if int(it.get("price", 1)) == 0 and not it.get("consumable")
        ]
        new_grants = [fid for fid in free_ids if fid not in owned]
        if new_grants:
            # Re-read + merge under the write lock. The old code wrote back the
            # `owned` list it had read earlier, so a purchase made between the read
            # and the write (the HUD polls /shop constantly) was silently erased –
            # coins spent, item gone.
            def _grant(eq, ow, _g=new_grants):
                for fid in _g:
                    if fid not in ow:
                        ow.append(fid)
            equipped, owned = self.store.modify_avatar(user_id, _grant)

        # Inventory quantity map (items in user_inventory table)
        inv_rows = self.store.get_inventory(user_id)
        inv_map  = {r["item_id"]: int(r["quantity"]) for r in inv_rows}

        # Buff charge counts for arena consumables (items already activated)
        buff_counts = {}
        if self.buff_service:
            active_buffs = self.buff_service.get_active_buffs(user_id)
            for item_id, effect_key in ITEM_TO_BUFF_EFFECT.items():
                buff_counts[item_id] = int(active_buffs.get(effect_key, {}).get("count", 0))

        unlocked = level >= 5  # gates the paid shop UI; free items are always accessible

        visible_items = []
        for it in self._items:
            it2 = dict(it)
            it2["owned"]      = it["id"] in owned
            it2["equipped"]   = (equipped.get(it["type"]) == it["id"])
            it2["can_afford"] = coins >= int(it["price"])
            # Free items (price=0) are never locked regardless of level
            it2["locked"]     = (int(it.get("price", 1)) > 0) and (level < int(it["level_required"]))
            it2["bonus"]      = it.get("bonus", {})
            it2["battle"]     = it.get("battle", {})
            it2["arena_only"] = it.get("arena_only", False)

            if it.get("consumable"):
                inv_qty  = inv_map.get(it["id"], 0)
                buff_qty = buff_counts.get(it["id"], 0)
                # quantity = items in inventory (not yet activated)
                it2["quantity"]   = inv_qty
                # total_available = inventory + already-activated buff charges
                it2["total_available"] = inv_qty + buff_qty
                # buff_count = charges already activated and ready in arena
                it2["buff_count"] = buff_qty
            else:
                it2["quantity"]        = None
                it2["total_available"] = None
                it2["buff_count"]      = None

            max_stack = STACK_LIMITS.get(it["id"])
            it2["max_stack"] = max_stack

            # at_max uses combined total so the buy button disables when truly full
            if max_stack is not None and it.get("consumable"):
                it2["at_max"] = (inv_map.get(it["id"], 0) + buff_counts.get(it["id"], 0)) >= max_stack
            else:
                it2["at_max"] = False

            visible_items.append(it2)

        category_status = {}
        for cat, cat_unlock_lv in CATEGORY_UNLOCK_LEVELS.items():
            category_status[cat] = {
                "unlocked": level >= cat_unlock_lv,
                "unlock_level": cat_unlock_lv,
                **CATEGORY_INFO.get(cat, {}),
            }

        return {
            "shop_unlocked": unlocked,
            "level":  level,
            "coins":  coins,
            "owned":  owned,
            "equipped": equipped,
            "items":  visible_items,
            "category_status": category_status,
        }

    def purchase(self, user_id: str, item_id: str) -> dict:
        # Check-then-spend must be one critical section; otherwise N parallel
        # requests all pass the affordability check, pay once, and get N items. It is also ONE database
        # transaction: the coins (a reward_events row), the item and the once-a-day mark land together.
        with self.store.transaction():
            return self._purchase_locked(user_id, item_id)

    def _purchase_locked(self, user_id: str, item_id: str) -> dict:
        progress = self.store.get_progress(user_id)
        avatar   = self.store.get_avatar(user_id)

        level = int(progress.get("current_level", 1) or 1)
        coins = int(progress.get("coins", 0) or 0)

        if level < 5:
            return {"ok": False, "reason": "Shop locked until Level 5"}

        it = self._item_map.get(item_id)
        if not it:
            return {"ok": False, "reason": "Item not found"}

        if level < int(it["level_required"]):
            return {"ok": False, "reason": f"Locked until Level {it['level_required']}"}

        owned = json.loads(avatar.get("owned_json", "[]") or "[]")

        # Non-consumables: block repurchase
        if item_id in owned and not it.get("consumable"):
            return {"ok": True, "message": "Already owned"}

        price = int(it["price"])
        if coins < price:
            return {"ok": False, "reason": "Not enough coins", "need": price - coins}

        # ── Pre-purchase checks (BEFORE coin deduction) ────────────────────────
        daily_key = None
        today = None
        if it.get("consumable"):
            item_effect = it.get("effect", "")

            if item_id in STACK_LIMITS:
                # Count both inventory AND already-activated buff charges
                inv_qty = self.store.get_inventory_quantity(user_id, item_id)
                buff_qty = 0
                if self.buff_service:
                    active_buffs = self.buff_service.get_active_buffs(user_id)
                    effect_key   = ITEM_TO_BUFF_EFFECT.get(item_id, "")
                    buff_qty     = int(active_buffs.get(effect_key, {}).get("count", 0))
                total_held = inv_qty + buff_qty
                max_stack  = STACK_LIMITS[item_id]
                if total_held >= max_stack:
                    return {"ok": False, "reason": f"Max stack of {max_stack} reached — use one in arena first!"}

            elif item_effect in ("xp_boost_1h", "xp_boost_2h", "coin_boost_1h"):
                if self.buff_service:
                    active_buffs = self.buff_service.get_active_buffs(user_id)
                    if item_effect in active_buffs:
                        return {"ok": False, "reason": "This effect is already active — wait for it to expire first!"}

            elif item_id in ("potion_streak_shield", "potion_quest_reset"):
                today     = self.store.user_today(user_id).isoformat()    # the user's LOCAL day
                daily_key = f"buy_{item_id}"
                rec = self.store.get_daily_action(user_id, today, daily_key)
                if rec and int(rec.get("count", 0)) >= 1:
                    return {"ok": False, "reason": "You can only buy this once per day!"}

        # ── All checks passed — pay by appending a negative-coins ledger event ─────────────────
        # The event is refused if the balance can't cover it. A non-consumable has ONE key for ever
        # (it can only ever be bought once); a consumable's key names which purchase of it this is.
        if it.get("consumable"):
            nth = self.store.count_reward_events(user_id, "shop_purchase", item_id) + 1
            key = f"u{user_id}:purchase:{item_id}:{nth}"
        else:
            key = f"u{user_id}:purchase:{item_id}"
        paid = self.store.record_reward_event(
            user_id, "shop_purchase", 0, -price, item_id, idempotency_key=key)
        if not paid["applied"]:
            if paid["reason"] == "duplicate":
                return {"ok": True, "message": "Already owned"}
            return {"ok": False, "reason": "Not enough coins", "need": max(0, price - coins)}

        # Only now burn the once-per-day allowance (it used to be consumed even if a
        # later check failed).
        if daily_key:
            self.store.inc_daily_action(user_id, today, daily_key, 1)

        if it.get("consumable"):
            self.store.add_inventory_item(user_id, item_id, quantity=1)

        def _add(eq, ow, _id=item_id):
            if _id not in ow:
                ow.append(_id)
        self.store.modify_avatar(user_id, _add)
        return {"ok": True, "message": "Purchased", "item": it}

    def equip(self, user_id: str, item_id: str) -> dict:
        it = self._item_map.get(item_id)
        if not it:
            return {"ok": False, "reason": "Item not found"}
        slot = SLOT_BY_TYPE.get(it["type"])
        if slot is None:
            return {"ok": False, "reason": "This item can't be equipped"}   # e.g. potions

        result = {}

        def _equip(equipped, owned):
            if not can_equip_in_slot(item_id, slot, owned):
                result["err"] = "You don't own this item"
                return
            equipped[slot] = item_id
            # Keep outfit_id in sync so hero-forge page and AvatarDisplay both see the right armor
            if slot == "armor":
                equipped["outfit_id"] = item_id
            result["equipped"] = dict(equipped)

        self.store.modify_avatar(user_id, _equip)
        if "err" in result:
            return {"ok": False, "reason": result["err"]}
        return {"ok": True, "equipped": result["equipped"]}

    def unequip(self, user_id: str, slot: str) -> dict:
        valid_slots = ["headgear", "armor", "weapon", "pet", "title"]
        if slot not in valid_slots:
            return {"ok": False, "reason": f"Invalid slot. Must be one of: {valid_slots}"}

        result = {}

        def _unequip(equipped, owned):
            if slot not in equipped or not equipped[slot]:
                result["err"] = f"No item equipped in {slot} slot"
                return
            result["item_id"] = equipped.pop(slot)
            # Keep outfit_id in sync when unequipping armor
            if slot == "armor":
                equipped.pop("outfit_id", None)
            result["equipped"] = dict(equipped)

        self.store.modify_avatar(user_id, _unequip)
        if "err" in result:
            return {"ok": False, "reason": result["err"]}
        return {"ok": True, "message": "Item unequipped",
                "item": self._item_map.get(result["item_id"]), "equipped": result["equipped"]}
