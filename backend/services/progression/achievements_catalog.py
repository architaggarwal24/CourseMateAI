ACHIEVEMENTS = [
    # ── Tier: Common ─────────────────────────────────────────────────────────
    {"id": "first_quiz",   "name": "First Steps",     "description": "Complete your first quiz",
     "unlock_type": "total_quizzes_completed", "threshold": 1,  "reward_xp": 50,  "reward_coins": 20,  "tier": "common"},

    {"id": "quiz_10",      "name": "Quiz Apprentice", "description": "Complete 10 quizzes",
     "unlock_type": "total_quizzes_completed", "threshold": 10, "reward_xp": 200, "reward_coins": 100, "tier": "common"},

    {"id": "quiz_50",      "name": "Quiz Veteran",    "description": "Complete 50 quizzes",
     "unlock_type": "total_quizzes_completed", "threshold": 50, "reward_xp": 500, "reward_coins": 250, "tier": "rare"},

    {"id": "quiz_100",     "name": "Quiz Master",     "description": "Complete 100 quizzes",
     "unlock_type": "total_quizzes_completed", "threshold": 100, "reward_xp": 1000, "reward_coins": 500,
     "reward_cosmetic_id": "badge_quiz_master", "tier": "epic"},

    # ── Streak milestones ─────────────────────────────────────────────────────
    {"id": "streak_3",     "name": "Getting Started", "description": "Maintain a 3-day streak",
     "unlock_type": "streak_days", "threshold": 3,  "reward_xp": 100, "reward_coins": 50,  "tier": "common"},

    {"id": "streak_7",     "name": "Week Warrior",    "description": "Maintain a 7-day streak",
     "unlock_type": "streak_days", "threshold": 7,  "reward_xp": 300, "reward_coins": 150,
     "reward_cosmetic_id": "badge_week_warrior", "tier": "rare"},

    {"id": "streak_14",    "name": "Fortnight Scholar", "description": "Maintain a 14-day streak",
     "unlock_type": "streak_days", "threshold": 14, "reward_xp": 600, "reward_coins": 300,
     "reward_cosmetic_id": "badge_fortnight", "tier": "rare"},

    {"id": "streak_30",    "name": "Monthly Legend",  "description": "Maintain a 30-day streak",
     "unlock_type": "streak_days", "threshold": 30, "reward_xp": 1500, "reward_coins": 750,
     "reward_cosmetic_id": "badge_monthly_legend", "tier": "legendary"},

    # ── Boss kills ────────────────────────────────────────────────────────────
    {"id": "first_boss",   "name": "Boss Hunter",     "description": "Defeat your first boss",
     "unlock_type": "total_bosses_defeated", "threshold": 1,  "reward_xp": 150, "reward_coins": 100, "tier": "common"},

    {"id": "boss_5",       "name": "Monster Slayer",  "description": "Defeat 5 bosses",
     "unlock_type": "total_bosses_defeated", "threshold": 5,  "reward_xp": 400, "reward_coins": 200, "tier": "rare"},

    {"id": "boss_10",      "name": "Dragon Bane",     "description": "Defeat 10 bosses",
     "unlock_type": "total_bosses_defeated", "threshold": 10, "reward_xp": 800, "reward_coins": 400,
     "reward_cosmetic_id": "badge_dragon_bane", "tier": "epic"},

    {"id": "boss_25",      "name": "Boss Destroyer",  "description": "Defeat 25 bosses",
     "unlock_type": "total_bosses_defeated", "threshold": 25, "reward_xp": 2000, "reward_coins": 1000,
     "reward_cosmetic_id": "badge_boss_destroyer", "tier": "legendary"},

    # ── Level gates ───────────────────────────────────────────────────────────
    {"id": "level_5",      "name": "Shop Unlocked",   "description": "Reach Level 5",
     "unlock_type": "current_level", "threshold": 5,  "reward_xp": 0,   "reward_coins": 200, "tier": "common"},

    {"id": "level_10",     "name": "Rising Scholar",  "description": "Reach Level 10",
     "unlock_type": "current_level", "threshold": 10, "reward_xp": 300, "reward_coins": 400,
     "reward_cosmetic_id": "badge_rising_scholar", "tier": "rare"},

    {"id": "level_20",     "name": "Knowledge Seeker","description": "Reach Level 20",
     "unlock_type": "current_level", "threshold": 20, "reward_xp": 600, "reward_coins": 800,
     "reward_cosmetic_id": "badge_knowledge_seeker", "tier": "epic"},

    {"id": "level_30",     "name": "Grand Scholar",   "description": "Reach Level 30",
     "unlock_type": "current_level", "threshold": 30, "reward_xp": 1000, "reward_coins": 1500,
     "reward_cosmetic_id": "badge_grand_scholar", "tier": "legendary"},

    # ── Accuracy achievements ─────────────────────────────────────────────────
    {"id": "accuracy_90",  "name": "Sharp Mind",      "description": "Score 90%+ accuracy on a quiz",
     "unlock_type": "best_quiz_accuracy", "threshold": 90, "reward_xp": 200, "reward_coins": 100, "tier": "rare"},

    # ── Nightmare mode ────────────────────────────────────────────────────────
    {"id": "nightmare_clear", "name": "Nightmare Survivor", "description": "Defeat a boss on Nightmare difficulty",
     "unlock_type": "nightmare_bosses_defeated", "threshold": 1, "reward_xp": 500, "reward_coins": 300,
     "reward_cosmetic_id": "badge_nightmare_survivor", "tier": "epic"},

    {"id": "nightmare_5",  "name": "Nightmare Champion", "description": "Defeat 5 bosses on Nightmare difficulty",
     "unlock_type": "nightmare_bosses_defeated", "threshold": 5, "reward_xp": 1200, "reward_coins": 600,
     "reward_cosmetic_id": "badge_nightmare_champion", "tier": "legendary"},
]