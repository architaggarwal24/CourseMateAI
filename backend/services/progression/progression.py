import bisect

from game_content import get_content

# XP needed per level comes from backend/content/levels.json; the list length is the maximum level.
_XP_TO_NEXT = tuple(get_content().levels.xp_to_next_level)


def xp_to_next_level(level: int) -> int:
    """XP needed to go from `level` to the next one (beyond the table: the last entry)."""
    return _XP_TO_NEXT[min(max(level, 1), len(_XP_TO_NEXT)) - 1]


# Cache level thresholds to avoid O(n) recomputation on every call.
_LEVEL_THRESHOLDS: list = []  # _LEVEL_THRESHOLDS[i] = total XP needed to BE at level i+1

def _build_thresholds() -> list:
    thresholds = []
    cursor = 0
    for lvl in range(1, len(_XP_TO_NEXT) + 1):
        thresholds.append(cursor)
        cursor += xp_to_next_level(lvl)
    return thresholds

_LEVEL_THRESHOLDS = _build_thresholds()


def level_from_total_xp(total_xp: int) -> int:
    """Return the level for the given total XP. O(log n) via binary search on cached thresholds."""
    # thresholds[i] = XP needed to reach level i+1
    # We want the largest level whose threshold <= total_xp
    idx = bisect.bisect_right(_LEVEL_THRESHOLDS, total_xp) - 1
    return max(1, idx + 1)

def xp_progress(total_xp: int):
    lvl = level_from_total_xp(total_xp)
    # Use precomputed thresholds (O(1)) instead of re-summing levels (O(n))
    cursor = _LEVEL_THRESHOLDS[lvl - 1]
    into_level = total_xp - cursor
    to_next = xp_to_next_level(lvl)
    return lvl, into_level, to_next
