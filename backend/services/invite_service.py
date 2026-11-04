"""Invite codes and plan grants (Phase 3 Stage 4a; docs/plans.md).

A code grants a plan (tier) for some days (or for good), up to `max_uses` users, until it expires or is revoked.
INVITE_ONLY=1 makes signup need a valid code. A signed-in user can redeem one too (Account -> Plan & usage).
Redeeming never lowers a plan that is in force: a code for a lower tier than the user's current one is refused;
a code for the same tier extends the end date.

Codes are made, listed and revoked from the command line (scripts/admin.py); nothing here is reachable by
users except `redeem` and `validate`.
"""
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from errors import AppError
from services import entitlements

INVITE_ONLY_ENV = "INVITE_ONLY"
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{3,39}$")
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"          # no 0/O, 1/I


def invite_only() -> bool:
    return os.environ.get(INVITE_ONLY_ENV, "0").strip().lower() in ("1", "true", "yes")


def normalise(code: str) -> str:
    return re.sub(r"\s+", "", (code or "")).upper()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat(timespec="seconds") if dt else None


def invalid_code(message: str = "That invite code isn't valid.") -> AppError:
    return AppError("invite_invalid", message, status_code=400, details={"field": "invite_code"})


class InviteService:
    def __init__(self, store, now=_now):
        self.store = store
        self.now = now

    # ── admin ────────────────────────────────────────────────────────────────
    def create(self, tier: str, *, days: Optional[int] = 30, max_uses: int = 1, code: Optional[str] = None,
               note: str = "", valid_days: Optional[int] = None) -> Dict:
        if tier not in entitlements.TIERS:
            raise ValueError(f"unknown tier {tier!r}")
        if code is None:
            code = f"{tier[:4].upper()}-" + "".join(secrets.choice(_ALPHABET) for _ in range(8))
        code = normalise(code)
        if not CODE_RE.match(code):
            raise ValueError("a code is 4-40 letters, digits and dashes")
        now = self.now()
        self.store.execute(
            "INSERT INTO invite_codes (code, tier, days, max_uses, uses, note, created_at, expires_at, revoked) "
            "VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)",
            (code, tier, days, int(max_uses), note or None, _stamp(now),
             _stamp(now + timedelta(days=valid_days)) if valid_days else None))
        return self.get(code)

    def get(self, code: str) -> Optional[Dict]:
        row = self.store.fetchone("SELECT * FROM invite_codes WHERE code = ?", (normalise(code),))
        return dict(row) if row else None

    def list(self) -> List[Dict]:
        return [dict(r) for r in self.store.fetchall("SELECT * FROM invite_codes ORDER BY created_at DESC")]

    def revoke(self, code: str) -> bool:
        return self.store.execute("UPDATE invite_codes SET revoked = 1 WHERE code = ?", (normalise(code),)) > 0

    def set_plan(self, user_id, tier: str, *, days: Optional[int] = None, source: str = "admin", ref: str = "",
                 from_time: Optional[datetime] = None) -> Dict:
        """Put a user on a plan (an admin, or a redeemed code) for `days` from now (or from `from_time`, to extend
        a plan still running). days None = no end."""
        if tier not in entitlements.TIERS:
            raise ValueError(f"unknown tier {tier!r}")
        now = self.now()
        expires = _stamp(max(now, from_time or now) + timedelta(days=days)) if days else None
        self.store.execute(
            "INSERT INTO user_plans (user_id, tier, source, source_ref, started_at, expires_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, "
            "source = excluded.source, source_ref = excluded.source_ref, started_at = excluded.started_at, "
            "expires_at = excluded.expires_at, updated_at = excluded.updated_at",
            (int(user_id), tier, source, ref or None, _stamp(now), expires, _stamp(now)))
        return dict(self.store.fetchone("SELECT * FROM user_plans WHERE user_id = ?", (int(user_id),)))

    def clear_plan(self, user_id) -> None:
        self.store.execute("DELETE FROM user_plans WHERE user_id = ?", (int(user_id),))

    # ── users ────────────────────────────────────────────────────────────────
    def validate(self, code: str) -> Dict:
        """The code's row if it can be used now, else 400 invite_invalid."""
        row = self.get(code) if code else None
        if not row or row["revoked"]:
            raise invalid_code()
        if row["expires_at"] and datetime.fromisoformat(row["expires_at"]) <= self.now():
            raise invalid_code("That invite code has expired.")
        if row["uses"] >= row["max_uses"]:
            raise invalid_code("That invite code has been used up.")
        return row

    def redeem(self, user_id, code: str) -> Dict:
        """Use a code for this user: their plan becomes the code's tier for its days. Returns the plan row."""
        row = self.validate(normalise(code))
        if self.store.fetchone("SELECT 1 FROM invite_redemptions WHERE code = ? AND user_id = ?", (row["code"], int(user_id))):
            raise invalid_code("You've already used this invite code.")
        current = entitlements.plan_row(user_id)
        if current and entitlements.TIERS.index(row["tier"]) < entitlements.TIERS.index(current["tier"]):
            raise invalid_code(f"You're already on {entitlements.TIER_NAMES[current['tier']]}; this code is for a lower plan.")
        days, start = row["days"], None
        if current and current["tier"] == row["tier"] and current["expires_at"] and days:
            start = datetime.fromisoformat(current["expires_at"])  # same plan: the time adds up
        elif current and current["tier"] == row["tier"] and not current["expires_at"]:
            days = None                                           # already for good: stays for good
        # Count the use first, guarded, so two people racing for the last use can't both get it.
        took = self.store.execute("UPDATE invite_codes SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND revoked = 0",
                                  (row["code"],))
        if not took:
            raise invalid_code("That invite code has been used up.")
        self.store.execute("INSERT INTO invite_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)",
                           (row["code"], int(user_id), _stamp(self.now())))
        return self.set_plan(user_id, row["tier"], days=days, source="invite", ref=row["code"], from_time=start)
