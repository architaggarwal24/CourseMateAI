import random
from services.progression.time_utils import utc_today, iso_date
from services.progression.quest_catalog import get_daily_quests_for_level

class DailyQuestService:
    def __init__(self, store):
        self.store = store

    def _quest_pool(self, level: int) -> "list[dict]":
        """Return level-appropriate quests from the tiered catalog."""
        raw = get_daily_quests_for_level(level, count=20)
        return [
            {
                "quest_type":   q["quest_type"],
                "target":       q["target_count"],
                "reward_xp":    q["reward_xp"],
                "reward_coins": q["reward_coins"],
                "description":  q["description"],
                "min_level":    q.get("level_required", 1),
            }
            for q in raw
        ]

    def get_or_create_daily_quests(self, user_id: str, progress: dict = None) -> "list[dict]":
        """Pass pre-loaded progress dict to avoid redundant DB read."""
        if progress is None:
            progress = self.store.get_progress(user_id)
        level = int(progress.get("current_level", 1) or 1)

        today_s = iso_date(utc_today())
        existing = self.store.get_daily_quests(user_id, today_s)
        if existing:
            # Attach description dynamically (UI convenience)
            desc_map = {q["quest_type"]: q["description"] for q in self._quest_pool(level)}
            for e in existing:
                e["description"] = desc_map.get(e["quest_type"], e["quest_type"])
            return existing

        pool = self._quest_pool(level)
        chosen = random.sample(pool, k=min(3, len(pool)))

        quests = []
        for q in chosen:
            quests.append({
                "user_id": user_id,
                "quest_date_utc": today_s,
                "quest_type": q["quest_type"],
                "target_count": q["target"],
                "current_count": 0,
                "reward_xp": q["reward_xp"],
                "reward_coins": q["reward_coins"],
                "completed": 0,
                "claimed": 0,
            })
        self.store.insert_daily_quests(quests)

        # Return with descriptions
        out = self.store.get_daily_quests(user_id, today_s)
        desc_map = {q["quest_type"]: q["description"] for q in chosen}
        for e in out:
            e["description"] = desc_map.get(e["quest_type"], e["quest_type"])
        return out

    def _inc_quest(self, user_id: str, quest_type: str, amount: int = 1) -> None:
        today_s = iso_date(utc_today())
        quests = self.store.get_daily_quests(user_id, today_s)
        for q in quests:
            if q["quest_type"] != quest_type:
                continue
            if int(q["claimed"]) == 1:
                continue
            if int(q["completed"]) == 1:
                continue

            new_count = int(q["current_count"]) + amount
            target = int(q["target_count"])
            completed = 1 if new_count >= target else 0

            self.store.update_quest(user_id, today_s, quest_type, {
                "current_count": new_count,
                "completed": completed
            })

    def mark_maintained_streak(self, user_id: str) -> None:
        self._inc_quest(user_id, "maintain_streak", 1)

    def on_chat_question(self, user_id: str) -> None:
        self._inc_quest(user_id, "ask_questions", 1)

    def on_action(self, user_id: str, action_type: str, accuracy: float = 0.0) -> None:
        """Advance quest counters for all quest types triggered by this action."""
        if action_type == "quiz_complete":
            self._inc_quest(user_id, "complete_quizzes", 1)
            # Accuracy-gated quiz quests
            if accuracy >= 1.0:
                self._inc_quest(user_id, "perfect_quiz", 1)
                self._inc_quest(user_id, "quiz_perfectionist", 1)
            if accuracy >= 0.9:
                self._inc_quest(user_id, "quiz_master", 1)
        elif action_type == "arena_round_complete":
            self._inc_quest(user_id, "arena_rounds", 1)
        elif action_type == "boss_defeat":
            self._inc_quest(user_id, "defeat_boss", 1)
            self._inc_quest(user_id, "boss_hunter", 1)
        elif action_type == "notes_generation":
            self._inc_quest(user_id, "generate_notes", 1)
            self._inc_quest(user_id, "notes_scholar", 1)
        elif action_type == "flashcard_complete":
            self._inc_quest(user_id, "study_flashcards", 1)

    def claim_quest(self, user_id: str, quest_type: str) -> dict:
        today_s = iso_date(utc_today())
        quests = self.store.get_daily_quests(user_id, today_s)
        q = next((x for x in quests if x["quest_type"] == quest_type), None)
        if not q:
            return {"ok": False, "reason": "Quest not found"}

        if int(q["claimed"]) == 1:
            return {"ok": False, "reason": "Already claimed"}

        if int(q["completed"]) != 1:
            return {"ok": False, "reason": "Quest not completed"}

        self.store.update_quest(user_id, today_s, quest_type, {"claimed": 1})
        return {
            "ok": True,
            "reward_xp": int(q["reward_xp"]),
            "reward_coins": int(q["reward_coins"]),
        }