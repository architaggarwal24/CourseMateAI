import json
from services.progression.catalog import flatten_catalog, CATEGORY_UNLOCK_LEVELS, CATEGORY_INFO

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
            owned.extend(new_grants)
            self.store.set_avatar(user_id, equipped=equipped, owned=owned)

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

        owned    = json.loads(avatar.get("owned_json",  "[]") or "[]")
        equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")

        # Non-consumables: block repurchase
        if item_id in owned and not it.get("consumable"):
            return {"ok": True, "message": "Already owned"}

        price = int(it["price"])
        if coins < price:
            return {"ok": False, "reason": "Not enough coins", "need": price - coins}

        # ── Pre-purchase checks (BEFORE coin deduction) ────────────────────────
        if it.get("consumable"):
            item_effect = it.get("effect", "")

            if item_id in STACK_LIMITS:
                # Count both inventory AND already-activated buff charges
                inv_rows = self.store.get_inventory(user_id)
                inv_qty  = {r["item_id"]: int(r["quantity"]) for r in inv_rows}.get(item_id, 0)
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
                from datetime import datetime, timezone
                today     = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                daily_key = f"buy_{item_id}"
                rec = self.store.get_daily_action(user_id, today, daily_key)
                if rec and int(rec.get("count", 0)) >= 1:
                    return {"ok": False, "reason": "You can only buy this once per day!"}
                self.store.inc_daily_action(user_id, today, daily_key, 1)

        # ── All checks passed — deduct coins ──────────────────────────────────
        self.store.update_progress_fields(user_id, {"coins": coins - price})

        if it.get("consumable"):
            self.store.add_inventory_item(user_id, item_id, quantity=1)
            if item_id not in owned:
                owned.append(item_id)
        else:
            owned.append(item_id)

        self.store.set_avatar(user_id, equipped=equipped, owned=owned)
        return {"ok": True, "message": "Purchased", "item": it}

    def equip(self, user_id: str, item_id: str) -> dict:
        avatar   = self.store.get_avatar(user_id)
        owned    = json.loads(avatar.get("owned_json",  "[]") or "[]")
        equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")
        it = self._item_map.get(item_id)
        if not it:
            return {"ok": False, "reason": "Item not found"}
        if item_id not in owned:
            return {"ok": False, "reason": "You don't own this item"}
        equipped[it["type"]] = item_id
        # Keep outfit_id in sync so hero-forge page and AvatarDisplay both see the right armor
        if it["type"] == "armor":
            equipped["outfit_id"] = item_id
        self.store.set_avatar(user_id, equipped=equipped, owned=owned)
        return {"ok": True, "equipped": equipped}

    def unequip(self, user_id: str, slot: str) -> dict:
        avatar   = self.store.get_avatar(user_id)
        owned    = json.loads(avatar.get("owned_json",  "[]") or "[]")
        equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")
        valid_slots = ["headgear", "armor", "weapon", "pet", "title"]
        if slot not in valid_slots:
            return {"ok": False, "reason": f"Invalid slot. Must be one of: {valid_slots}"}
        if slot not in equipped or not equipped[slot]:
            return {"ok": False, "reason": f"No item equipped in {slot} slot"}
        unequipped_item_id = equipped.pop(slot)
        # Keep outfit_id in sync when unequipping armor
        if slot == "armor":
            equipped.pop("outfit_id", None)
        self.store.set_avatar(user_id, equipped=equipped, owned=owned)
        it = self._item_map.get(unequipped_item_id)
        return {"ok": True, "message": "Item unequipped", "item": it, "equipped": equipped}