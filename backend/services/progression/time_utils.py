from datetime import datetime, timezone, date

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def utc_now_iso() -> str:
    return utc_now().isoformat()

def utc_today() -> date:
    return utc_now().date()

def iso_date(d: date) -> str:
    return d.isoformat()