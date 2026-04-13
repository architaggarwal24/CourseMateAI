import json
from datetime import datetime, timezone, timedelta
from services.progression.time_utils import utc_now_iso

# Arena consumables that use count-based stacking (not timed expiry)
ARENA_CONSUMABLE_EFFECTS = {"heal_1", "fifty_fifty", "hint_charges"}
# How long arena consumable buffs stay valid (long enough to never silently expire)
ARENA_CONSUMABLE_EXPIRY_DAYS = 30


class BuffService:
    """
    Manages consumable item buffs:
      - heal_1       → count-based pending heals for arena (up to 3)
      - fifty_fifty  → count-based 50/50 charges for arena (up to 2)
      - xp_boost_*   → timed XP multiplier
      - coin_boost_* → timed coin multiplier
    """

    BUFF_DURATION = {
        "xp_boost_1h": 3600,
        "xp_boost_2h": 7200,   # Grand XP Elixir: +100% for 2 hours
        "coin_boost_1h": 3600,
    }

    # Max stack sizes for arena consumables (must match shop_service.STACK_LIMITS)
    ARENA_MAX_STACKS = {
        "heal_1": 3,
        "fifty_fifty": 2,
    }

    def __init__(self, store):
        self.store = store

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------
    def get_active_buffs(self, user_id: str) -> dict:
        """Return dict of active (non-expired) buffs for a user."""
        raw = self.store.fetchone(
            "SELECT buffs_json FROM user_buffs WHERE user_id = ?", (user_id,)
        )
        if not raw:
            return {}
        try:
            buffs = json.loads(raw["buffs_json"] or "{}")
        except Exception:
            return {}

        now = datetime.now(timezone.utc).timestamp()
        active = {}
        changed = False
        for key, data in buffs.items():
            if data.get("expires_at", 0) > now:
                active[key] = data
            else:
                changed = True  # expired — will be pruned on next write

        if changed:
            self._save_buffs(user_id, active)

        return active

    def get_xp_multiplier(self, user_id: str) -> float:
        buffs = self.get_active_buffs(user_id)
        if "xp_boost_2h" in buffs:
            return 2.0
        return 1.5 if "xp_boost_1h" in buffs else 1.0

    def get_coin_multiplier(self, user_id: str) -> float:
        buffs = self.get_active_buffs(user_id)
        return 1.5 if "coin_boost_1h" in buffs else 1.0

    def has_pending_heal(self, user_id: str) -> bool:
        return self.get_heal_count(user_id) > 0

    def get_heal_count(self, user_id: str) -> int:
        """Return number of pending heal charges ready for arena use."""
        buffs = self.get_active_buffs(user_id)
        return int(buffs.get("heal_1", {}).get("count", 0))

    def get_fifty_fifty_count(self, user_id: str) -> int:
        """Return number of 50/50 charges ready for arena use."""
        buffs = self.get_active_buffs(user_id)
        return int(buffs.get("fifty_fifty", {}).get("count", 0))

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------
    def apply_buff(self, user_id: str, effect: str) -> dict:
        """
        Apply a buff effect. Returns result dict with ok/reason.
        Arena consumables (heal_1, fifty_fifty) increment a count — they stack.
        Timed buffs block if already active.
        """
        if effect == "heal_1":
            return self._apply_heal(user_id)
        elif effect == "hint_charge":
            return self._apply_hint_charge(user_id)
        elif effect == "fifty_fifty":
            return self._apply_fifty_fifty(user_id)
        elif effect in ("xp_boost_1h", "xp_boost_2h", "coin_boost_1h"):
            return self._apply_timed_buff(user_id, effect)
        elif effect == "streak_freeze":
            return self._apply_streak_freeze(user_id)
        elif effect == "reset_daily_quests":
            return self._apply_quest_reset(user_id)
        else:
            return {"ok": False, "reason": f"Unknown effect: {effect}"}

    def consume_hint_charge(self, user_id: str) -> int:
        """Consume one hint charge. Returns remaining count."""
        buffs = self.get_active_buffs(user_id)
        if "hint_charges" not in buffs:
            return 0
        current = int(buffs["hint_charges"].get("count", 0))
        if current <= 1:
            del buffs["hint_charges"]
            self._save_buffs(user_id, buffs)
            return 0
        buffs["hint_charges"]["count"] = current - 1
        self._save_buffs(user_id, buffs)
        return current - 1

    def consume_fifty_fifty_charge(self, user_id: str) -> int:
        """Consume one 50/50 charge. Returns remaining count."""
        buffs = self.get_active_buffs(user_id)
        if "fifty_fifty" not in buffs:
            return 0
        current = int(buffs["fifty_fifty"].get("count", 0))
        if current <= 1:
            del buffs["fifty_fifty"]
            self._save_buffs(user_id, buffs)
            return 0
        buffs["fifty_fifty"]["count"] = current - 1
        self._save_buffs(user_id, buffs)
        return current - 1

    def consume_heal(self, user_id: str) -> bool:
        """
        Consume one pending heal charge from buff slot.
        Returns True if a charge was consumed, False if none were available.
        """
        buffs = self.get_active_buffs(user_id)
        if "heal_1" not in buffs:
            return False
        current = int(buffs["heal_1"].get("count", 0))
        if current <= 0:
            # Stale entry — clean it up
            del buffs["heal_1"]
            self._save_buffs(user_id, buffs)
            return False
        if current <= 1:
            del buffs["heal_1"]
        else:
            buffs["heal_1"]["count"] = current - 1
        self._save_buffs(user_id, buffs)
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _arena_expiry(self) -> float:
        """30-day expiry for arena consumables so they never silently vanish."""
        return (datetime.now(timezone.utc) + timedelta(days=ARENA_CONSUMABLE_EXPIRY_DAYS)).timestamp()

    def _apply_heal(self, user_id: str) -> dict:
        """Increment pending heal count (max 3). Count-based, never blocks on 2nd use."""
        buffs = self.get_active_buffs(user_id)
        current = int(buffs.get("heal_1", {}).get("count", 0))
        max_heals = self.ARENA_MAX_STACKS["heal_1"]
        if current >= max_heals:
            return {"ok": False, "reason": f"Max {max_heals} heals already queued for arena"}
        buffs["heal_1"] = {
            "effect": "heal_1",
            "count": current + 1,
            "expires_at": self._arena_expiry(),
            "applied_at": utc_now_iso(),
        }
        self._save_buffs(user_id, buffs)
        total = current + 1
        return {
            "ok": True,
            "effect": "heal_1",
            "count": total,
            "message": f"Crimson Vial ready! You have {total} heal{'s' if total > 1 else ''} for the Arena.",
        }

    def _apply_hint_charge(self, user_id: str) -> dict:
        """Add a hint charge for use in arena."""
        buffs = self.get_active_buffs(user_id)
        current = int(buffs.get("hint_charges", {}).get("count", 0))
        buffs["hint_charges"] = {
            "effect": "hint_charge",
            "count": current + 1,
            "expires_at": self._arena_expiry(),
            "applied_at": utc_now_iso(),
        }
        self._save_buffs(user_id, buffs)
        return {"ok": True, "effect": "hint_charge", "count": current + 1,
                "message": f"Hint ready! You now have {current + 1} hint(s) for the Arena."}

    def _apply_fifty_fifty(self, user_id: str) -> dict:
        """Increment 50/50 charge count (max 2)."""
        buffs = self.get_active_buffs(user_id)
        current = int(buffs.get("fifty_fifty", {}).get("count", 0))
        max_fifty = self.ARENA_MAX_STACKS["fifty_fifty"]
        if current >= max_fifty:
            return {"ok": False, "reason": f"Max {max_fifty} Veil charges already queued for arena"}
        buffs["fifty_fifty"] = {
            "effect": "fifty_fifty",
            "count": current + 1,
            "expires_at": self._arena_expiry(),
            "applied_at": utc_now_iso(),
        }
        self._save_buffs(user_id, buffs)
        total = current + 1
        return {"ok": True, "effect": "fifty_fifty", "count": total,
                "message": f"Veil of Duality ready! You have {total} charge(s) for the Arena."}

    def _apply_timed_buff(self, user_id: str, effect: str) -> dict:
        buffs = self.get_active_buffs(user_id)
        if effect in buffs:
            remaining = int(buffs[effect]["expires_at"] - datetime.now(timezone.utc).timestamp())
            return {
                "ok": False,
                "reason": f"Buff already active ({remaining}s remaining)",
                "remaining_seconds": remaining,
            }
        duration = self.BUFF_DURATION[effect]
        expires = datetime.now(timezone.utc) + timedelta(seconds=duration)
        buffs[effect] = {
            "effect": effect,
            "expires_at": expires.timestamp(),
            "expires_iso": expires.isoformat(),
            "applied_at": utc_now_iso(),
            "duration_seconds": duration,
        }
        self._save_buffs(user_id, buffs)
        if effect == "xp_boost_2h":
            label = "+100% XP for 2 hours!"
        elif effect == "xp_boost_1h":
            label = "+50% XP for 1 hour!"
        else:
            label = "+50% Coins for 1 hour!"
        return {
            "ok": True,
            "effect": effect,
            "message": label,
            "expires_at": expires.isoformat(),
        }

    def _apply_streak_freeze(self, user_id: str) -> dict:
        progress = self.store.get_progress(user_id)
        freezes = int(progress.get("streak_freezes", 0) or 0)
        self.store.update_progress_fields(user_id, {"streak_freezes": freezes + 1})
        return {"ok": True, "effect": "streak_freeze",
                "message": f"Streak Shield activated! You now have {freezes + 1} streak freeze(s)."}

    def _apply_quest_reset(self, user_id: str) -> dict:
        from services.progression.time_utils import iso_date, utc_today
        today = iso_date(utc_today())
        self.store.execute(
            "DELETE FROM daily_quests WHERE user_id = ? AND quest_date_utc = ?",
            (user_id, today)
        )
        return {"ok": True, "effect": "reset_daily_quests",
                "message": "Daily quests reset! Refresh to get a new set."}

    def _save_buffs(self, user_id: str, buffs: dict) -> None:
        now = utc_now_iso()
        self.store.execute(
            """
            INSERT INTO user_buffs (user_id, buffs_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET buffs_json = excluded.buffs_json, updated_at = excluded.updated_at
            """,
            (user_id, json.dumps(buffs), now),
        )