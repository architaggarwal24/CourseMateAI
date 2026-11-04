"""Usage metering and the plan's AI quotas (Phase 3 Stage 4a; docs/plans.md).

    record()   the sink of core_brains/usage_meter.py: adds one user's AI calls and tokens to today's row
               (UTC day). Calls made with the user's own provider key are counted apart (byok_*).
    check_ai() before an AI request: today's AI calls against the plan's `ai_calls_day`, this month's tokens
               against `tokens_month`. Over either -> 429 plan_limit (action "plans", details.resets_at).
               Calls on the user's own key don't count (QUOTA_BYOK_EXEMPT, default on): they cost us nothing.
    summary()  GET /account/usage: the plan, its limits and what has been used.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Dict

from services import costs, entitlements

BYOK_EXEMPT_ENV = "QUOTA_BYOK_EXEMPT"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def byok_exempt() -> bool:
    return os.environ.get(BYOK_EXEMPT_ENV, "1").strip().lower() not in ("0", "false", "no")


def _day(now: datetime) -> str:
    return now.strftime("%Y-%m-%d")


def _next_day(now: datetime) -> str:
    return (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat()


def _next_month(now: datetime) -> str:
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (first.replace(year=first.year + 1, month=1) if first.month == 12 else first.replace(month=first.month + 1)).isoformat()


class UsageService:
    def __init__(self, store, now=_utc_now):
        self.store = store
        self.now = now

    # ── metering ─────────────────────────────────────────────────────────────
    def record(self, user_id, *, calls: int = 0, tokens_in: int = 0, tokens_out: int = 0, byok: bool = False,
               job: str = "", provider: str = "", model: str = "", fallbacks: int = 0) -> None:
        tokens = int(tokens_in) + int(tokens_out)
        day = _day(self.now())
        # A call on the user's own key costs the server nothing.
        cost = 0 if byok else costs.cost_micro_usd(provider, model, int(tokens_in), int(tokens_out))
        self.store.execute(
            "INSERT INTO usage_daily (user_id, day, ai_calls, byok_calls, tokens_in, tokens_out, byok_tokens, cost_micro_usd) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET "
            "ai_calls = ai_calls + excluded.ai_calls, byok_calls = byok_calls + excluded.byok_calls, "
            "tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out, "
            "byok_tokens = byok_tokens + excluded.byok_tokens, cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd",
            (int(user_id), day, int(calls), int(calls) if byok else 0, int(tokens_in), int(tokens_out),
             tokens if byok else 0, cost))
        if provider:
            self.store.execute(
                "INSERT INTO model_usage_daily (day, provider, model, job, calls, tokens_in, tokens_out, cost_micro_usd, "
                "fallbacks, byok_calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, provider, model, job) DO UPDATE SET "
                "calls = calls + excluded.calls, tokens_in = tokens_in + excluded.tokens_in, "
                "tokens_out = tokens_out + excluded.tokens_out, cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd, "
                "fallbacks = fallbacks + excluded.fallbacks, byok_calls = byok_calls + excluded.byok_calls",
                (day, provider, model or "default", job or "strong", int(calls), int(tokens_in), int(tokens_out), cost,
                 int(fallbacks), int(calls) if byok else 0))

    def costs(self, days: int = 30) -> Dict:
        """The operator's view (scripts/admin.py costs): per model and job over the last `days` days, and the
        users who cost the most. Calls on users' own keys are counted but cost nothing."""
        since = _day(self.now() - timedelta(days=days - 1))
        rows = self.store.fetchall(
            "SELECT provider, model, job, SUM(calls) AS calls, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, "
            "SUM(cost_micro_usd) AS cost, SUM(fallbacks) AS fallbacks, SUM(byok_calls) AS byok_calls "
            "FROM model_usage_daily WHERE day >= ? GROUP BY provider, model, job ORDER BY cost DESC, calls DESC", (since,))
        models = [{**dict(r), "cost_usd": r["cost"] / 1e6,
                   "priced": costs.price(r["provider"], r["model"]) is not None} for r in rows]
        users = self.store.fetchall(
            "SELECT user_id, SUM(ai_calls) AS calls, SUM(cost_micro_usd) AS cost FROM usage_daily WHERE day >= ? "
            "GROUP BY user_id ORDER BY cost DESC, calls DESC LIMIT 10", (since,))
        total = sum(m["cost"] for m in models)
        rate = costs.usd_to_inr()
        return {"days": days, "total_usd": total / 1e6, "total_inr": round(total / 1e6 * rate, 2) if rate else None,
                "unpriced": sorted({f"{m['provider']}:{m['model']}" for m in models if not m["priced"] and m["calls"] > m["byok_calls"]}),
                "models": models, "top_users": [{"user_id": int(u["user_id"]), "calls": u["calls"], "cost_usd": u["cost"] / 1e6} for u in users]}

    def today(self, user_id) -> Dict[str, int]:
        row = self.store.fetchone("SELECT * FROM usage_daily WHERE user_id = ? AND day = ?", (int(user_id), _day(self.now())))
        return {"ai_calls": row["ai_calls"] if row else 0, "byok_calls": row["byok_calls"] if row else 0}

    def month(self, user_id) -> Dict[str, int]:
        prefix = self.now().strftime("%Y-%m-")
        row = self.store.fetchone(
            "SELECT COALESCE(SUM(ai_calls), 0) AS calls, COALESCE(SUM(byok_calls), 0) AS byok_calls, "
            "COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(byok_tokens), 0) AS byok_tokens "
            "FROM usage_daily WHERE user_id = ? AND day LIKE ?", (int(user_id), prefix + "%"))
        return {k: int(row[k]) for k in ("calls", "byok_calls", "tokens", "byok_tokens")}

    def history(self, user_id, days: int = 30) -> list:
        since = _day(self.now() - timedelta(days=days - 1))
        rows = self.store.fetchall("SELECT * FROM usage_daily WHERE user_id = ? AND day >= ? ORDER BY day",
                                   (int(user_id), since))
        return [{"day": r["day"], "ai_calls": r["ai_calls"], "tokens": r["tokens_in"] + r["tokens_out"]} for r in rows]

    # ── quotas ───────────────────────────────────────────────────────────────
    def counted(self, user_id) -> Dict[str, int]:
        """What counts against the plan: everything not made on the user's own key (when that is exempt)."""
        t, m = self.today(user_id), self.month(user_id)
        exempt = byok_exempt()
        return {"ai_calls_day": t["ai_calls"] - (t["byok_calls"] if exempt else 0),
                "tokens_month": m["tokens"] - (m["byok_tokens"] if exempt else 0)}

    def check_ai(self, user_id, *, byok: bool = False) -> None:
        if byok and byok_exempt():
            return
        lim, used, now = entitlements.limits_for(user_id), self.counted(user_id), self.now()
        if used["ai_calls_day"] >= lim["ai_calls_day"]:
            raise entitlements.plan_limit(
                user_id, "ai_calls_day", used["ai_calls_day"], lim["ai_calls_day"],
                f"You've used today's {lim['ai_calls_day']} AI calls. They come back at midnight (UTC), or upgrade for more.",
                status_code=429, resets_at=_next_day(now))
        if used["tokens_month"] >= lim["tokens_month"]:
            raise entitlements.plan_limit(
                user_id, "tokens_month", used["tokens_month"], lim["tokens_month"],
                "You've used this month's AI allowance. It renews on the 1st, or upgrade for more.",
                status_code=429, resets_at=_next_month(now))

    # ── the usage page ───────────────────────────────────────────────────────
    def summary(self, user_id, *, documents: int, courses: int, byok: bool) -> Dict:
        tier = entitlements.tier_for(user_id)
        row = entitlements.plan_row(user_id)
        used, now = self.counted(user_id), self.now()
        t, m = self.today(user_id), self.month(user_id)
        return {
            "tier": tier, "tier_name": entitlements.TIER_NAMES[tier],
            "source": row["source"] if row else "default", "expires_at": row["expires_at"] if row else None,
            "limits": entitlements.limits(tier),
            "used": {"ai_calls_day": used["ai_calls_day"], "tokens_month": used["tokens_month"],
                     "documents": documents, "courses": courses},
            "own_key": {"active": byok, "exempt": byok_exempt(), "calls_today": t["byok_calls"],
                        "tokens_month": m["byok_tokens"]},
            "resets": {"ai_calls_day": _next_day(now), "tokens_month": _next_month(now)},
            "history": self.history(user_id),
        }
