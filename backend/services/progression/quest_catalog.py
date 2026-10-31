"""Quest catalog: a thin view over backend/content/quests.json (see content.py for the format and validation)."""
import random

from game_content import get_content


def _dump(quests) -> list:
    return [q.model_dump(exclude_unset=True) for q in quests]


def get_daily_quests_for_level(user_level: int, count: int = 3) -> list:
    """Get appropriate daily quests based on user level"""
    available_quests = []
    for group in get_content().quests.groups:                  # in file order: tier 1, 2, 3, 4
        if group.kind == "daily" and user_level >= group.min_level:
            available_quests.extend(_dump(group.quests))

    # Filter by level requirement
    eligible_quests = [q for q in available_quests if q["level_required"] <= user_level]

    # Select random quests
    if len(eligible_quests) <= count:
        return eligible_quests

    return random.sample(eligible_quests, count)


def get_weekly_challenges_for_level(user_level: int) -> list:
    """Get weekly challenges based on level"""
    challenges = [q for g in get_content().quests.groups if g.kind == "weekly" for q in _dump(g.quests)]
    return [c for c in challenges if c["level_required"] <= user_level]


def get_special_quests() -> list:
    """Get special event quests"""
    return [q for g in get_content().quests.groups if g.kind == "special" for q in _dump(g.quests)]
