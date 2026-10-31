import json
import math
from typing import Tuple, Optional
from services.progression.progression import level_from_total_xp, xp_to_next_level, xp_progress
from services.progression.streak_service import StreakService
from services.progression.quest_service import DailyQuestService
from services.progression.catalog import flatten_catalog
from game_content import get_content
from services.progression.ownership import can_use_item

# Reward tables live in backend/content/rewards.json (validated at startup, see content.py):
#   DAILY_CAPS   - how many times per local day an action is rewarded (chat_bundle_5: 10 bundles = 50 questions)
#   BASE_REWARDS - (xp, coins) before multipliers
_REWARDS = get_content().rewards
DAILY_CAPS = {name: a.daily_cap for name, a in _REWARDS.actions.items()}
BASE_REWARDS = {name: (a.xp, a.coins) for name, a in _REWARDS.actions.items()}
LEVEL_UP_BONUS_COINS_PER_LEVEL = _REWARDS.level_up_bonus_coins_per_level


def tier_multiplier(level: int) -> float:
    tier = (level - 1) // _REWARDS.tier_multiplier.levels_per_tier
    return 1.0 + (_REWARDS.tier_multiplier.bonus_per_tier * tier)

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def _num(value, default: float) -> float:
    """Coerce to a finite float; NaN/inf/None/garbage → default."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


class RewardService:
    def __init__(self, store, achievement_service, buff_service=None):
        self.store = store
        self.achievements = achievement_service
        self.streaks = StreakService(store)
        self.quests = DailyQuestService(store)
        self.buffs = buff_service  # optional — injected from main.py
        # Build item→bonus lookup once at startup (catalog is static)
        _catalog = flatten_catalog()
        self._item_bonus_map = {it["id"]: it.get("bonus", {}) for it in _catalog}

    def _local_date_str(self, user_id: str) -> str:
        """Today's date in the USER's time zone: the day that daily caps count against."""
        return self.store.user_today(user_id).isoformat()

    def can_reward_action(self, user_id: str, action_type: str) -> "Tuple[bool, Optional[str]]":
        cap = DAILY_CAPS.get(action_type)
        if not cap:
            return True, None
        day = self._local_date_str(user_id)
        row = self.store.get_daily_action(user_id, day, action_type)
        count = int(row.get("count", 0) or 0)
        if count >= cap:
            return False, "Daily cap reached"
        return True, None

    def _mark_action_counted(self, user_id: str, action_type: str) -> None:
        day = self._local_date_str(user_id)
        self.store.inc_daily_action(user_id, day, action_type, 1)

    def calculate_rewards(self, action_type: str, player_level: int,
                          accuracy: float = 1.0,
                          difficulty: float = 1.0,
                          streak_days: int = 0,
                          combo_count: int = 1):

        if action_type not in BASE_REWARDS:
            # FIX BUG 22: BASE_REWARDS[action_type] raised KeyError for unknown
            # action types, crashing the reward endpoint with a 500 error.
            raise ValueError(f"Unknown action_type: {action_type!r}. Valid: {list(BASE_REWARDS)}")
        base_xp, base_coins = BASE_REWARDS[action_type]
        base_mult = tier_multiplier(player_level)

        accuracy_mult = 0.5 + clamp(accuracy, 0.0, 1.0)        # 0.5..1.5
        difficulty_mult = clamp(difficulty, 0.8, 2.0)
        streak_mult = 1.0 + min(0.5, max(0, streak_days) * 0.05)  # +5%/day cap +50%

        combo_mult = 1.0
        if action_type in ("arena_round_complete", "boss_defeat"):
            combo_mult = min(2.0, 1.0 + max(0, combo_count - 1) * 0.10)  # capped at 2.0

        final_xp = int(base_xp * base_mult * accuracy_mult * difficulty_mult * streak_mult * combo_mult)
        final_coins = int(base_coins * base_mult * accuracy_mult * difficulty_mult * streak_mult)

        breakdown = {
            "base": {"xp": base_xp, "coins": base_coins},
            "tier_mult": round(base_mult, 2),
            "accuracy_mult": round(accuracy_mult, 2),
            "difficulty_mult": round(difficulty_mult, 2),
            "streak_mult": round(streak_mult, 2),
            "combo_mult": round(combo_mult, 2) if combo_mult > 1 else None,
        }
        return final_xp, final_coins, breakdown

    def apply_bonus(self, user_id: str, xp: int, coins: int, source: str = "bonus", *,
                    idempotency_key: str, kind: str = "bonus", source_id: str = None) -> dict:
        """Pay a one-off bonus (e.g. a daily-quest claim) as ONE ledger event.

        The same idempotency_key can never pay twice: a repeat returns ok=False, reason="Already claimed".
        """
        self.store.ensure_user(user_id)
        with self.store.transaction():
            old_level = int((self.store.get_progress(user_id).get("current_level", 1)) or 1)
            t = self.store.record_reward_event(
                user_id, kind, int(xp), int(coins), source_id or source,
                idempotency_key=idempotency_key)
            if not t["applied"]:
                return {"ok": False, "reason": "Already claimed"}
            newly = self.achievements.check_and_unlock(user_id)
            # achievements may have added XP/coins/levels – report the final numbers
            fin = self.store.get_progress(user_id)
        total_xp = int(fin.get("total_xp", 0) or 0)
        new_level = int(fin.get("current_level", t["level"]) or t["level"])
        _, into, to_next = xp_progress(total_xp)
        return {
            "source": source,
            "xp_gained": xp,
            "coins_gained": coins,
            "totals": {"total_xp": total_xp, "coins": int(fin.get("coins", 0) or 0),
                       "level": new_level, "xp_into_level": into, "xp_to_next": to_next},
            "level_up": {"from": old_level, "to": new_level} if new_level > old_level else None,
            "new_achievements": newly,
        }

    def claim_quest(self, user_id: str, quest_type: str) -> dict:
        """Claim a completed daily quest: mark it claimed AND write its reward event in one transaction.
        Two racing claims (or a retry) pay exactly once - the event key is the quest + the user's local day."""
        with self.store.transaction():
            claim = self.quests.claim_quest(user_id, quest_type)
            if not claim.get("ok"):
                return claim
            bonus = self.apply_bonus(
                user_id=user_id, xp=int(claim["reward_xp"]), coins=int(claim["reward_coins"]),
                source=f"daily_quest:{quest_type}", kind="quest_claim", source_id=quest_type,
                idempotency_key=f"u{user_id}:quest:{claim['quest_date']}:{quest_type}")
        if bonus.get("ok") is False:
            return bonus
        return {"ok": True,
                "xp_gained": bonus.get("xp_gained", claim["reward_xp"]),
                "coins_gained": bonus.get("coins_gained", claim["reward_coins"]),
                **bonus}


    def get_equipment_bonuses(self, user_id: str) -> dict:
        """
        Aggregate all passive bonuses from the user's currently equipped items.
        Returns a dict with totals for: xp_pct, coin_pct, combo_xp_pct, arena_hints,
        streak_freeze_days (the smallest value = most frequent earner wins).
        """
        import json
        avatar = self.store.get_avatar(user_id)
        equipped: dict = json.loads(avatar.get("equipped_json", "{}") or "{}")
        owned = set(json.loads(avatar.get("owned_json", "[]") or "[]"))
        totals = {"xp_pct": 0.0, "coin_pct": 0.0, "combo_xp_pct": 0.0, "arena_hints": 0}
        best_freeze_days = None  # None = no pet with this bonus

        for slot, item_id in equipped.items():
            # Defence in depth: a bonus only counts if the user owns the item. This
            # also neutralises any rows already saved by the old unchecked endpoints.
            if not isinstance(item_id, str) or not can_use_item(item_id, owned):
                continue
            bonus = self._item_bonus_map.get(item_id, {})
            totals["xp_pct"]       += bonus.get("xp_pct", 0.0)
            totals["coin_pct"]     += bonus.get("coin_pct", 0.0)
            totals["combo_xp_pct"] += bonus.get("combo_xp_pct", 0.0)
            totals["arena_hints"]  += bonus.get("arena_hints", 0)
            if "streak_freeze_days" in bonus:
                fd = bonus["streak_freeze_days"]
                best_freeze_days = fd if best_freeze_days is None else min(best_freeze_days, fd)

        if best_freeze_days is not None:
            totals["streak_freeze_days"] = best_freeze_days
        return totals

    def award(self, user_id: str, action_type: str,
              accuracy: float = 1.0,
              difficulty: float = 1.0,
              combo_count: int = 1, source_id: str = None) -> dict:
        """`source_id` names the thing being rewarded (e.g. a quiz_id): the reward's ledger key is built from it,
        so the same source can be paid at most once. Without it the key is the day's cap slot."""

        if action_type not in BASE_REWARDS:
            raise ValueError(f"Unknown action_type: {action_type!r}. Valid: {list(BASE_REWARDS)}")

        # Never trust client numbers (NaN, huge combos, negative accuracy…).
        accuracy = clamp(_num(accuracy, 1.0), 0.0, 1.0)
        difficulty = clamp(_num(difficulty, 1.0), 0.0, 3.0)   # 2.5 = nightmare marker
        combo_count = int(clamp(_num(combo_count, 1), 1, 100))

        self.store.ensure_user(user_id)
        # The whole read-compute-write is one critical section AND one database transaction: concurrent
        # requests can't bypass the daily cap, and a cap slot is used up only together with its reward event.
        with self.store.transaction():
            return self._award_locked(user_id, action_type, accuracy, difficulty, combo_count, source_id)

    def _award_locked(self, user_id, action_type, accuracy, difficulty, combo_count, source_id=None) -> dict:
        progress = self.store.get_progress(user_id)

        # streak update (counts as activity)
        streak_days = self.streaks.update_streak_for_activity(user_id)
        self.quests.get_or_create_daily_quests(user_id, progress=progress)
        self.quests.mark_maintained_streak(user_id)

        # Atomically take a slot under the daily cap (the day is the user's LOCAL date)
        day = self._local_date_str(user_id)
        cap = DAILY_CAPS.get(action_type)
        capped = {
            "ok": False,
            "capped": True,
            "reason": "Daily cap reached",
            "action_type": action_type,
            "xp_gained": 0,
            "coins_gained": 0,
        }
        if cap:
            if not self.store.reserve_daily_action(user_id, day, action_type, cap):
                return capped
        else:
            self.store.inc_daily_action(user_id, day, action_type, 1)
        # The slot number (1st, 2nd... reward of this kind today) names this reward: its ledger event key.
        slot = int(self.store.get_daily_action(user_id, day, action_type).get("count", 0) or 0)

        old_level = int(progress.get("current_level", 1) or 1)

        xp, coins, breakdown = self.calculate_rewards(
            action_type=action_type,
            player_level=old_level,
            accuracy=accuracy,
            difficulty=difficulty,
            streak_days=streak_days,
            combo_count=combo_count
        )

        # Apply active buff multipliers (consumable potions)
        if self.buffs:
            xp_mult = self.buffs.get_xp_multiplier(user_id)
            coin_mult = self.buffs.get_coin_multiplier(user_id)
            if xp_mult != 1.0:
                xp = int(xp * xp_mult)
                breakdown["xp_buff_mult"] = xp_mult
            if coin_mult != 1.0:
                coins = int(coins * coin_mult)
                breakdown["coin_buff_mult"] = coin_mult

        # Apply passive equipment bonuses (owned items only)
        eq_bonus = self.get_equipment_bonuses(user_id)
        if eq_bonus["xp_pct"] > 0:
            xp = int(xp * (1.0 + eq_bonus["xp_pct"]))
            breakdown["xp_equip_pct"] = eq_bonus["xp_pct"]
        if eq_bonus["coin_pct"] > 0:
            coins = int(coins * (1.0 + eq_bonus["coin_pct"]))
            breakdown["coin_equip_pct"] = eq_bonus["coin_pct"]
        if eq_bonus["combo_xp_pct"] > 0 and combo_count >= 3:
            combo_bonus = int(xp * eq_bonus["combo_xp_pct"])
            xp += combo_bonus
            breakdown["xp_combo_equip_bonus"] = combo_bonus

        # One ledger event for the reward; the cached XP / coins / level move in the same transaction.
        event_source = source_id or f"{day}:{slot}"
        totals = self.store.record_reward_event(
            user_id, action_type, xp, coins, event_source,
            idempotency_key=f"u{user_id}:award:{action_type}:{event_source}")
        if not totals["applied"]:        # this very slot was already paid: nothing more to give
            return capped
        new_level = totals["level"]

        # update counters
        counter_map = {
            "arena_round_complete": "total_arena_rounds",
            "boss_defeat": "total_bosses_defeated",
            "quiz_complete": "total_quizzes_completed",
            "chat_bundle_5": "total_chat_bundles",
            "notes_generation": "total_notes_generated",
            "flashcard_complete": "total_flashcards_studied",
        }
        if action_type in counter_map:
            self.store.increment_progress(user_id, counter_map[action_type], 1)

        # Track best quiz accuracy (stored as integer 0-100)
        if action_type == "quiz_complete":
            acc_pct = int(round(accuracy * 100))
            current_best = int((progress.get("best_quiz_accuracy") or 0))
            if acc_pct > current_best:
                self.store.update_progress_fields(user_id, {"best_quiz_accuracy": acc_pct})

        # Track nightmare boss defeats (difficulty marker 2.5 is unique to nightmare)
        if action_type == "boss_defeat" and difficulty >= 2.5:
            self.store.increment_progress(user_id, "nightmare_bosses_defeated", 1)

        level_up = None
        if new_level > old_level:
            bonus = LEVEL_UP_BONUS_COINS_PER_LEVEL * new_level    # level-up bonus coins
            self.store.record_reward_event(
                user_id, "level_up_bonus", 0, bonus, str(new_level),
                idempotency_key=f"u{user_id}:level_up:{new_level}")
            level_up = {
                "from": old_level,
                "to": new_level,
                "bonus_coins": bonus,
                "shop_unlocked": (old_level < 5 <= new_level),
            }

        # quest progress based on action
        self.quests.on_action(user_id, action_type, accuracy=accuracy)

        # achievements (may add bonus XP/coins and even more levels)
        newly = self.achievements.check_and_unlock(user_id, progress=self.store.get_progress(user_id))

        fin = self.store.get_progress(user_id)
        final_xp = int(fin.get("total_xp", 0) or 0)
        _, into, to_next = xp_progress(final_xp)

        return {
            "ok": True,
            "action_type": action_type,
            "xp_gained": xp,
            "coins_gained": coins,
            "breakdown": breakdown,
            "streak_days": streak_days,
            "level_up": level_up,
            "totals": {
                "total_xp": final_xp,
                "coins": int(fin.get("coins", 0) or 0),
                "level": int(fin.get("current_level", new_level) or new_level),
                "xp_into_level": into,
                "xp_to_next": to_next,
            },
            "new_achievements": newly,
        }
