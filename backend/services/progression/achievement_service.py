import json
from services.progression.time_utils import utc_now_iso

class AchievementService:
    def __init__(self, store):
        self.store = store

    def seed(self, achievements) -> None:
        """Make the `achievements` table match backend/content/achievements.json (validated Achievement models)."""
        self.store.seed_achievements([a.as_row() for a in achievements])

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

        Changes vs the previous version:
        - Runs under the store's write lock and only pays a reward when
          unlock_achievement() reports that THIS call created the row, so two
          racing requests can't both collect the same reward.
        - Each reward is one reward_events row (kind "achievement", key = user + achievement id), written
          in the same transaction as the unlock row, so it can be paid at most once. The ledger also
          recomputes the level. Before, achievement XP raised total_xp but left current_level stale.
        - Re-checks after rewards: bonus XP can level the player up, which can
          unlock level-based achievements in the same call.
        - Only touches avatar ownership when a cosmetic was actually granted.
        """
        newly: list[dict] = []
        with self.store.atomic():
            all_ach = self.store.get_achievements()
            for _pass in range(5):   # bounded: chained unlocks settle in a few passes
                if progress is None or _pass > 0:
                    progress = self.store.get_progress(user_id)
                already_unlocked = self.store.get_unlocked_achievement_ids(user_id)

                unlocked_this_pass = False
                cosmetics: list[str] = []

                for a in all_ach:
                    aid = a["achievement_id"]
                    if aid in already_unlocked:
                        continue
                    stat = self._get_stat_value(progress, a["unlock_type"])
                    if stat < int(a["unlock_threshold"]):
                        continue
                    reward_xp = int(a.get("reward_xp", 0) or 0)
                    reward_coins = int(a.get("reward_coins", 0) or 0)
                    with self.store.transaction():      # unlock row + reward event: both or neither
                        if not self.store.unlock_achievement(user_id, aid):
                            continue   # someone else unlocked it first
                        self.store.record_reward_event(
                            user_id, "achievement", reward_xp, reward_coins, aid,
                            idempotency_key=f"u{user_id}:achievement:{aid}")

                    unlocked_this_pass = True
                    reward_cos = a.get("reward_cosmetic_id")
                    if reward_cos:
                        cosmetics.append(reward_cos)
                    newly.append({
                        "id": aid,
                        "name": a["name"],
                        "description": a["description"],
                        "tier": a.get("tier", "common"),
                        "reward_xp": reward_xp,
                        "reward_coins": reward_coins,
                        "reward_cosmetic_id": reward_cos,
                    })

                if cosmetics:
                    def _grant(equipped, owned, _c=cosmetics):
                        for c in _c:
                            if c not in owned:
                                owned.append(c)
                    self.store.modify_avatar(user_id, _grant)

                if not unlocked_this_pass:
                    break
        return newly
