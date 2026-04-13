def round_to_50(x: float) -> int:
    return int(round(x / 50.0) * 50)

def xp_to_next_level(level: int) -> int:
    # Progressive curve (Clash Royale vibe), tuned:
    # total XP to reach Level 5 ≈ 1300
    return max(100, round_to_50(75 * (level ** 1.5)))

# Cache level thresholds to avoid O(n) recomputation on every call.
# Build up to level 200 which covers any realistic user.
_LEVEL_THRESHOLDS: list = []  # _LEVEL_THRESHOLDS[i] = total XP needed to BE at level i+1

def _build_thresholds(max_level: int = 200) -> list:
    thresholds = []
    cursor = 0
    for lvl in range(1, max_level + 1):
        thresholds.append(cursor)
        cursor += xp_to_next_level(lvl)
    return thresholds

_LEVEL_THRESHOLDS = _build_thresholds()


def level_from_total_xp(total_xp: int) -> int:
    """Return the level for the given total XP. O(log n) via binary search on cached thresholds."""
    import bisect
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