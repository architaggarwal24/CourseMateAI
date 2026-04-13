import json
from datetime import datetime, timezone
from typing import Tuple, Optional
from services.progression.progression import level_from_total_xp, xp_to_next_level, xp_progress
from services.progression.streak_service import StreakService
from services.progression.quest_service import DailyQuestService
from services.progression.catalog import flatten_catalog

DAILY_CAPS = {
    "chat_bundle_5": 10,         # max 10 bundles/day = 50 questions/day rewarded
    "notes_generation": 10,
    "flashcard_complete": 10,
    "quiz_complete": 30,
    "arena_round_complete": 15,
    "boss_defeat": 5,
}

BASE_REWARDS = {
    "arena_round_complete": (120, 35),
    "boss_defeat":          (350, 120),
    "quiz_complete":        (100, 25),
    "chat_bundle_5":        (35, 10),
    "notes_generation":     (45, 8),
    "flashcard_complete":    (55, 12),
}

def tier_multiplier(level: int) -> float:
    tier = (level - 1) // 5
    return 1.0 + (0.30 * tier)

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

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

    def _utc_date_str(self) -> str:
        return datetime.now(timezone.utc).date().isoformat()

    def can_reward_action(self, user_id: str, action_type: str) -> "Tuple[bool, Optional[str]]":
        cap = DAILY_CAPS.get(action_type)
        if not cap:
            return True, None
        day = self._utc_date_str()
        row = self.store.get_daily_action(user_id, day, action_type)
        count = int(row.get("count", 0) or 0)
        if count >= cap:
            return False, "Daily cap reached"
        return True, None

    def _mark_action_counted(self, user_id: str, action_type: str) -> None:
        day = self._utc_date_str()
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

    def apply_bonus(self, user_id: str, xp: int, coins: int, source: str = "bonus") -> dict:
        progress = self.store.get_progress(user_id)
        old_level = int(progress.get("current_level", 1) or 1)

        new_total_xp = int(progress.get("total_xp", 0) or 0) + int(xp)
        new_coins = int(progress.get("coins", 0) or 0) + int(coins)

        new_level = level_from_total_xp(new_total_xp)

        self.store.update_progress_fields(user_id, {
            "total_xp": new_total_xp,
            "coins": new_coins,
            "current_level": new_level,
        })

        newly = self.achievements.check_and_unlock(user_id)

        lvl, into, to_next = xp_progress(new_total_xp)
        return {
            "source": source,
            "xp_gained": xp,
            "coins_gained": coins,
            "totals": {"total_xp": new_total_xp, "coins": new_coins, "level": new_level,
                       "xp_into_level": into, "xp_to_next": to_next},
            "level_up": {"from": old_level, "to": new_level} if new_level > old_level else None,
            "new_achievements": newly,
        }


    def get_equipment_bonuses(self, user_id: str) -> dict:
        """
        Aggregate all passive bonuses from the user's currently equipped items.
        Returns a dict with totals for: xp_pct, coin_pct, combo_xp_pct, arena_hints,
        streak_freeze_days (the smallest value = most frequent earner wins).
        """
        import json
        avatar = self.store.get_avatar(user_id)
        equipped: dict = json.loads(avatar.get("equipped_json", "{}") or "{}")
        totals = {"xp_pct": 0.0, "coin_pct": 0.0, "combo_xp_pct": 0.0, "arena_hints": 0}
        best_freeze_days = None  # None = no pet with this bonus

        for slot, item_id in equipped.items():
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
              combo_count: int = 1) -> dict:

        self.store.ensure_user(user_id)

        # Fetch progress once up front — passed to sub-services to avoid repeat reads
        progress = self.store.get_progress(user_id)

        # streak update (counts as activity)
        streak_days = self.streaks.update_streak_for_activity(user_id)
        self.quests.get_or_create_daily_quests(user_id, progress=progress)
        self.quests.mark_maintained_streak(user_id)

        # cap check
        ok, reason = self.can_reward_action(user_id, action_type)
        if not ok:
            return {
                "ok": False,
                "capped": True,
                "reason": reason,
                "action_type": action_type,
                "xp_gained": 0,
                "coins_gained": 0,
            }
        old_level = int(progress.get("current_level", 1) or 1)
        old_total_xp = int(progress.get("total_xp", 0) or 0)
        old_coins = int(progress.get("coins", 0) or 0)

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

        # Apply passive equipment bonuses (equipped armor, headgear, weapon, pet, title)
        eq_bonus = self.get_equipment_bonuses(user_id)
        if eq_bonus["xp_pct"] > 0:
            xp = int(xp * (1.0 + eq_bonus["xp_pct"]))
            breakdown["xp_equip_pct"] = eq_bonus["xp_pct"]
        if eq_bonus["coin_pct"] > 0:
            coins = int(coins * (1.0 + eq_bonus["coin_pct"]))
            breakdown["coin_equip_pct"] = eq_bonus["coin_pct"]
        if eq_bonus["combo_xp_pct"] > 0 and combo_count >= 3:
            # combo_xp_pct is a bonus applied on top when the player is on a streak
            combo_bonus = int(xp * eq_bonus["combo_xp_pct"])
            xp += combo_bonus
            breakdown["xp_combo_equip_bonus"] = combo_bonus

        # count action for caps
        self._mark_action_counted(user_id, action_type)

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

        # Track nightmare boss defeats (difficulty multiplier 2.5 is unique to nightmare)
        if action_type == "boss_defeat" and difficulty >= 2.5:
            self.store.increment_progress(user_id, "nightmare_bosses_defeated", 1)

        # apply xp/coins
        new_total_xp = old_total_xp + xp
        new_coins = old_coins + coins
        new_level = level_from_total_xp(new_total_xp)

        level_up = None
        if new_level > old_level:
            # level-up bonus coins (simple, feels good)
            bonus = 50 * new_level
            new_coins += bonus
            level_up = {
                "from": old_level,
                "to": new_level,
                "bonus_coins": bonus,
                "shop_unlocked": (old_level < 5 <= new_level),
            }

        self.store.update_progress_fields(user_id, {
            "total_xp": new_total_xp,
            "coins": new_coins,
            "current_level": new_level,
        })

        # quest progress based on action
        self.quests.on_action(user_id, action_type, accuracy=accuracy)

        # achievements — pass already-loaded progress to avoid redundant DB read
        newly = self.achievements.check_and_unlock(user_id, progress=self.store.get_progress(user_id))

        lvl, into, to_next = xp_progress(new_total_xp)

        return {
            "ok": True,
            "action_type": action_type,
            "xp_gained": xp,
            "coins_gained": coins,
            "breakdown": breakdown,
            "streak_days": streak_days,
            "level_up": level_up,
            "totals": {
                "total_xp": new_total_xp,
                "coins": new_coins,
                "level": new_level,
                "xp_into_level": into,
                "xp_to_next": to_next,
            },
            "new_achievements": newly,
        }