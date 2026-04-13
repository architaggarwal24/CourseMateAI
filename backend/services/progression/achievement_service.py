import json
from services.progression.time_utils import utc_now_iso

class AchievementService:
    def __init__(self, store):
        self.store = store

    def seed(self, achievements_catalog: list[dict]) -> None:
        self.store.seed_achievements(achievements_catalog)

    def _get_stat_value(self, progress: dict, unlock_type: str) -> int:
        if unlock_type == "total_quizzes_completed":
            return int(progress.get("total_quizzes_completed", 0) or 0)
        if unlock_type == "streak_days":
            return int(progress.get("streak_days", 0) or 0)
        if unlock_type == "total_bosses_defeated":
            return int(progress.get("total_bosses_defeated", 0) or 0)
        if unlock_type == "current_level":
            return int(progress.get("current_level", 1) or 1)
        if unlock_type == "best_quiz_accuracy":
            return int(progress.get("best_quiz_accuracy", 0) or 0)
        if unlock_type == "nightmare_bosses_defeated":
            return int(progress.get("nightmare_bosses_defeated", 0) or 0)
        return 0

    def check_and_unlock(self, user_id: str, progress: dict = None) -> list[dict]:
        """
        Check all achievements and unlock any newly earned ones.

        Optimisations vs original:
        - Accepts pre-loaded `progress` dict to avoid a redundant DB read when
          the caller (reward_service) already has it.
        - Fetches ALL already-unlocked achievement IDs in ONE query up front
          instead of one query per achievement (eliminates the N+1 loop).
        - Accumulates XP/coin deltas in memory and writes them in a single
          update_progress_fields call instead of re-reading and re-writing
          progress inside the loop for every achievement.
        """
        if progress is None:
            progress = self.store.get_progress(user_id)

        all_ach = self.store.get_achievements()
        # Single query: all achievement IDs this user already has
        already_unlocked = self.store.get_unlocked_achievement_ids(user_id)

        # Load avatar ownership for cosmetic rewards
        avatar = self.store.get_avatar(user_id)
        owned = json.loads(avatar.get("owned_json", "[]") or "[]")
        equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")

        newly = []
        bonus_xp = 0
        bonus_coins = 0

        for a in all_ach:
            aid = a["achievement_id"]
            if aid in already_unlocked:
                continue

            stat = self._get_stat_value(progress, a["unlock_type"])
            if stat < int(a["unlock_threshold"]):
                continue

            # Unlock
            self.store.unlock_achievement(user_id, aid)

            reward_cos = a.get("reward_cosmetic_id")
            if reward_cos and reward_cos not in owned:
                owned.append(reward_cos)

            reward_xp    = int(a.get("reward_xp", 0) or 0)
            reward_coins = int(a.get("reward_coins", 0) or 0)

            # Accumulate rewards — written in one batch below
            bonus_xp    += reward_xp
            bonus_coins += reward_coins

            newly.append({
                "id": aid,
                "name": a["name"],
                "description": a["description"],
                "tier": a.get("tier", "common"),
                "reward_xp": reward_xp,
                "reward_coins": reward_coins,
                "reward_cosmetic_id": reward_cos,
            })

        # Single write for all accumulated XP/coins (was one write per achievement)
        if bonus_xp > 0 or bonus_coins > 0:
            self.store.update_progress_fields(user_id, {
                "total_xp": int(progress.get("total_xp", 0) or 0) + bonus_xp,
                "coins":    int(progress.get("coins", 0) or 0) + bonus_coins,
            })

        # Persist cosmetic unlocks if changed
        self.store.set_avatar(user_id, equipped=equipped, owned=owned)
        return newly