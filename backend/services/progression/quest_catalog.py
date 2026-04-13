# Expanded Quest Catalog for CourseMateAI
# Modern quest system with progression tiers

QUEST_CATALOG = {
    # ==========================================
    # TIER 1: BEGINNER QUESTS (Level 1+)
    # ==========================================
    "tier_1_daily": [
        {
            "quest_type": "ask_questions",
            "description": "Ask 10 questions in Chat",
            "target_count": 10,
            "reward_xp": 50,
            "reward_coins": 25,
            "level_required": 1,
            "icon": "💬",
        },
        {
            "quest_type": "complete_quizzes",
            "description": "Complete 3 quizzes",
            "target_count": 3,
            "reward_xp": 60,
            "reward_coins": 30,
            "level_required": 1,
            "icon": "📝",
        },
        {
            "quest_type": "maintain_streak",
            "description": "Do any study activity today",
            "target_count": 1,
            "reward_xp": 50,
            "reward_coins": 100,
            "level_required": 1,
            "icon": "🔥",
        },
    ],

    # ==========================================
    # TIER 2: INTERMEDIATE QUESTS (Level 5+)
    # ==========================================
    "tier_2_daily": [
        {
            "quest_type": "generate_notes",
            "description": "Generate notes twice",
            "target_count": 2,
            "reward_xp": 70,
            "reward_coins": 35,
            "level_required": 5,
            "icon": "📓",
        },
        {
            "quest_type": "perfect_quiz",
            "description": "Get 100% on any quiz",
            "target_count": 1,
            "reward_xp": 100,
            "reward_coins": 50,
            "level_required": 5,
            "icon": "⭐",
        },
        {
            "quest_type": "ask_deep_questions",
            "description": "Ask 5 detailed questions (20+ words)",
            "target_count": 5,
            "reward_xp": 90,
            "reward_coins": 45,
            "level_required": 5,
            "icon": "🤔",
        },
    ],

    # ==========================================
    # TIER 3: ADVANCED QUESTS (Level 10+)
    # ==========================================
    "tier_3_daily": [
        {
            "quest_type": "arena_rounds",
            "description": "Complete 2 arena rounds",
            "target_count": 2,
            "reward_xp": 120,
            "reward_coins": 60,
            "level_required": 10,
            "icon": "⚔️",
        },
        {
            "quest_type": "defeat_boss",
            "description": "Defeat 1 boss in Battle Arena",
            "target_count": 1,
            "reward_xp": 160,
            "reward_coins": 90,
            "level_required": 10,
            "icon": "🐉",
        },
        {
            "quest_type": "quiz_master",
            "description": "Score 90%+ on 3 quizzes",
            "target_count": 3,
            "reward_xp": 150,
            "reward_coins": 75,
            "level_required": 10,
            "icon": "🏆",
        },
    ],

    # ==========================================
    # TIER 4: EXPERT QUESTS (Level 15+)
    # ==========================================
    "tier_4_daily": [
        {
            "quest_type": "quiz_perfectionist",
            "description": "Get 100% on 3 quizzes",
            "target_count": 3,
            "reward_xp": 220,
            "reward_coins": 110,
            "level_required": 15,
            "icon": "💯",
        },
        {
            "quest_type": "notes_scholar",
            "description": "Generate detailed notes 5 times",
            "target_count": 5,
            "reward_xp": 170,
            "reward_coins": 85,
            "level_required": 15,
            "icon": "📖",
        },
        {
            "quest_type": "study_flashcards",
            "description": "Study 3 flashcard decks",
            "target_count": 3,
            "reward_xp": 120,
            "reward_coins": 40,
            "level_required": 1,
            "icon": "🃏",
        },
    ],

    # ==========================================
    # WEEKLY CHALLENGES (All Levels)
    # ==========================================
    "weekly_challenges": [
        {
            "quest_type": "boss_hunter",
            "description": "Defeat 5 bosses this week",
            "target_count": 5,
            "reward_xp": 400,
            "reward_coins": 300,
            "level_required": 10,
            "icon": "🎖️",
            "duration": "weekly",
        },
    ],

    # ==========================================
    # SPECIAL EVENT QUESTS (Seasonal)
    # ==========================================
    "special_events": [
    ],
}


def get_daily_quests_for_level(user_level: int, count: int = 3) -> list:
    """Get appropriate daily quests based on user level"""
    import random

    available_quests = []

    # Add tier 1 quests
    if user_level >= 1:
        available_quests.extend(QUEST_CATALOG["tier_1_daily"])

    # Add tier 2 quests
    if user_level >= 5:
        available_quests.extend(QUEST_CATALOG["tier_2_daily"])

    # Add tier 3 quests
    if user_level >= 10:
        available_quests.extend(QUEST_CATALOG["tier_3_daily"])

    # Add tier 4 quests
    if user_level >= 15:
        available_quests.extend(QUEST_CATALOG["tier_4_daily"])

    # Filter by level requirement
    eligible_quests = [q for q in available_quests if q["level_required"] <= user_level]

    # Select random quests
    if len(eligible_quests) <= count:
        return eligible_quests

    return random.sample(eligible_quests, count)


def get_weekly_challenges_for_level(user_level: int) -> list:
    """Get weekly challenges based on level"""
    challenges = QUEST_CATALOG["weekly_challenges"]
    return [c for c in challenges if c["level_required"] <= user_level]


def get_special_quests() -> list:
    """Get special event quests"""
    return QUEST_CATALOG["special_events"]