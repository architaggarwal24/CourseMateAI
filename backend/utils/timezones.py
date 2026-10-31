"""IANA time-zone names: validation only (no imports from the rest of the app, so anything can use it)."""
from functools import lru_cache
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "UTC"


@lru_cache(maxsize=512)
def zone(name: str) -> Optional[ZoneInfo]:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None


def is_valid_timezone(name: object) -> bool:
    """True for a real IANA zone name such as "Asia/Kolkata" ("UTC" included)."""
    return isinstance(name, str) and 0 < len(name) <= 64 and zone(name) is not None


def normalize_timezone(name: object) -> str:
    """`name` when it is a valid IANA zone, else "UTC" (an unknown value never breaks a request)."""
    return name if is_valid_timezone(name) else DEFAULT_TIMEZONE
