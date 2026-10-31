from datetime import datetime, timezone, date

from utils.timezones import DEFAULT_TIMEZONE, is_valid_timezone, normalize_timezone, zone  # noqa: F401


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def utc_today() -> date:
    return utc_now().date()


def iso_date(d: date) -> str:
    return d.isoformat()


# ── per-user local day ────────────────────────────────────────────────────────
# A "day" in the game (streak, daily caps, daily quests, leaderboard) is the user's LOCAL calendar date,
# from the IANA time zone stored on their account. 01:00 in Asia/Kolkata is already tomorrow there,
# even though it is still yesterday in UTC.

def local_now(tz_name: object = DEFAULT_TIMEZONE) -> datetime:
    return utc_now().astimezone(zone(normalize_timezone(tz_name)) or timezone.utc)


def local_today(tz_name: object = DEFAULT_TIMEZONE) -> date:
    return local_now(tz_name).date()
