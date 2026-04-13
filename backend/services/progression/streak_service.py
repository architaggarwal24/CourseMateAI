from datetime import timedelta
from services.progression.time_utils import utc_today, iso_date

class StreakService:
    def __init__(self, store):
        self.store = store

    def update_streak_for_activity(self, user_id: str) -> int:
        progress = self.store.get_progress(user_id)
        today = utc_today()
        today_s = iso_date(today)

        last_active = progress.get("last_active_utc")
        streak = int(progress.get("streak_days", 0) or 0)
        freezes = int(progress.get("streak_freezes", 0) or 0)

        if last_active == today_s:
            return streak  # already counted today

        # Determine expected yesterday date string
        yesterday_s = iso_date(today - timedelta(days=1))

        if last_active == yesterday_s:
            new_streak = streak + 1
        else:
            # Missed day(s)
            if freezes > 0 and last_active is not None:
                freezes -= 1
                new_streak = streak  # protected
            else:
                new_streak = 1

        # Earn freeze token on each 7-day milestone (only when streak increases)
        if new_streak > streak and new_streak % 7 == 0:
            freezes += 1

        # FIX BUG 24: Write streak_freezes, streak_days, and last_active_utc in
        # a single update. The old code wrote streak_freezes up to twice (once on
        # missed day, once on milestone) causing a race condition and potential
        # double-write. Consolidating into one call is correct and atomic.
        self.store.update_progress_fields(user_id, {
            "streak_days": new_streak,
            "last_active_utc": today_s,
            "streak_freezes": freezes,
        })
        return new_streak