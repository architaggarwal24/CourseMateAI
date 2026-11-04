"""Paid plans through subscriptions (Phase 3 Stage 4c; docs/payments.md).

Off unless PAYMENTS_ENABLED=1. The provider is Razorpay (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
RAZORPAY_WEBHOOK_SECRET, plan ids in RAZORPAY_PLAN_IDS_JSON) - or, only when PAYMENTS_PROVIDER=stub is set on
purpose, a stub that "pays" at once, for trying the whole flow without real keys or money.

    checkout   a subscription is created at the provider for the plan and period; the browser opens Razorpay
               Checkout with its id (the stub: a test dialog).
    verify     Checkout's handler sends back payment id + subscription id + signature; the signature is
               HMAC-SHA256(payment_id|subscription_id, key secret). A valid one switches the plan on at once.
    webhook    Razorpay tells us everything else (charged every period, pending, halted, cancelled, completed):
               X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret); each event id is handled once.
    cancel     at the end of the paid period (the plan stays until then).

Plan sync (user_plans, source 'subscription', source_ref = subscription id):
    authenticated / active / pending   the plan, until the paid period ends + GRACE_DAYS (renewals move it on)
    cancelled / completed              the plan until the paid period ends, no grace
    halted / paused / expired          back to the default plan now
A new subscription that becomes active cancels the user's previous one (switching plans).
"""
import hashlib
import hmac
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from errors import AppError
from services import entitlements

logger = logging.getLogger(__name__)

GRACE_DAYS = 3
PERIOD_DAYS = {"month": 30, "year": 365}
PAID_TIERS = ("scholar", "sage", "archmage")
LIVE = ("authenticated", "active", "pending")
ENDED_AT_PERIOD_END = ("cancelled", "completed")
ENDED_NOW = ("halted", "paused", "expired")
API = "https://api.razorpay.com/v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat(timespec="seconds") if dt else None


def _from_unix(v) -> Optional[datetime]:
    try:
        return datetime.fromtimestamp(int(v), tz=timezone.utc) if v else None
    except (TypeError, ValueError):
        return None


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def payments_off() -> AppError:
    return AppError("payments_unavailable", "Payments aren't open yet. Plans come with invite codes for now.",
                    status_code=503)


# ── providers ────────────────────────────────────────────────────────────────
class RazorpayProvider:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str, plan_ids: Dict[str, str], http=None):
        self.key_id, self.key_secret, self.webhook_secret, self.plan_ids = key_id, key_secret, webhook_secret, plan_ids
        self._http = http

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        import requests
        http = self._http or requests
        r = http.request(method, API + path, json=body, auth=(self.key_id, self.key_secret), timeout=20)
        if r.status_code >= 400:
            logger.warning("razorpay %s %s -> %s", method, path, r.status_code)
            raise AppError("payment_provider_error", "The payment provider didn't accept that. Please try again.",
                           status_code=502, action="retry")
        return r.json()

    def plan_id(self, tier: str, period: str) -> Optional[str]:
        return self.plan_ids.get(f"{tier}:{period}")

    def create(self, user_id: int, tier: str, period: str) -> dict:
        plan = self.plan_id(tier, period)
        if not plan:
            raise AppError("plan_not_on_sale", f"{entitlements.TIER_NAMES[tier]} ({period}ly) isn't on sale yet.", status_code=400)
        return self._request("POST", "/subscriptions", {
            "plan_id": plan, "total_count": 120 if period == "month" else 10, "customer_notify": 1,
            "notes": {"user_id": str(user_id), "tier": tier, "period": period}})

    def fetch(self, sub_id: str) -> dict:
        return self._request("GET", f"/subscriptions/{sub_id}")

    def cancel(self, sub_id: str, at_cycle_end: bool = True) -> dict:
        return self._request("POST", f"/subscriptions/{sub_id}/cancel", {"cancel_at_cycle_end": 1 if at_cycle_end else 0})

    def _hmac(self, secret: str, message: bytes) -> str:
        return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()

    def verify_checkout(self, payment_id: str, sub_id: str, signature: str) -> bool:
        expected = self._hmac(self.key_secret, f"{payment_id}|{sub_id}".encode())
        return hmac.compare_digest(expected, signature or "")

    def verify_webhook(self, body: bytes, signature: str) -> bool:
        if not self.webhook_secret:
            return False
        return hmac.compare_digest(self._hmac(self.webhook_secret, body), signature or "")


class StubProvider:
    """Pays at once, with no money and no network - for trying the flow (PAYMENTS_PROVIDER=stub)."""
    name = "stub"
    key_id = "stub"

    def create(self, user_id: int, tier: str, period: str) -> dict:
        return {"id": "sub_stub_" + secrets.token_hex(6), "status": "created", "short_url": None}

    def fetch(self, sub_id: str) -> dict:
        now = _now()
        return {"id": sub_id, "status": "active", "current_start": int(now.timestamp()), "current_end": None}

    def cancel(self, sub_id: str, at_cycle_end: bool = True) -> dict:
        return {"id": sub_id, "status": "active" if at_cycle_end else "cancelled"}

    def verify_checkout(self, payment_id, sub_id, signature) -> bool:
        return signature == "stub"

    def verify_webhook(self, body, signature) -> bool:
        return False


def configured_provider():
    """The provider in force, or None when payments are off (or Razorpay is chosen but not configured)."""
    if _env("PAYMENTS_ENABLED").lower() not in ("1", "true", "yes"):
        return None
    if _env("PAYMENTS_PROVIDER").lower() == "stub":
        return StubProvider()
    kid, secret = _env("RAZORPAY_KEY_ID"), _env("RAZORPAY_KEY_SECRET")
    if not (kid and secret):
        logger.warning("PAYMENTS_ENABLED is on but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing: payments stay off")
        return None
    try:
        plan_ids = json.loads(_env("RAZORPAY_PLAN_IDS_JSON") or "{}")
    except ValueError:
        logger.warning("RAZORPAY_PLAN_IDS_JSON is not valid JSON")
        plan_ids = {}
    return RazorpayProvider(kid, secret, _env("RAZORPAY_WEBHOOK_SECRET"), plan_ids)


# ── the service ──────────────────────────────────────────────────────────────
class BillingService:
    def __init__(self, store, provider_factory=configured_provider, now=_now):
        self.store = store
        self.provider_factory = provider_factory
        self.now = now

    def provider(self):
        return self.provider_factory()

    def enabled(self) -> bool:
        return self.provider() is not None

    def _row(self, sub_id: str) -> Optional[Dict]:
        return self.store.fetchone("SELECT * FROM subscriptions WHERE id = ?", (sub_id,))

    def current(self, user_id) -> Optional[Dict]:
        """The user's subscription that matters now: a live one, else the latest."""
        rows = self.store.fetchall("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC", (int(user_id),))
        live = [r for r in rows if r["status"] in LIVE]
        row = live[0] if live else (rows[0] if rows else None)
        return self.public(row) if row else None

    @staticmethod
    def public(row: Dict) -> Dict:
        return {"id": row["id"], "provider": row["provider"], "tier": row["tier"], "tier_name": entitlements.TIER_NAMES[row["tier"]],
                "period": row["period"], "status": row["status"], "current_end": row["current_end"],
                "cancel_at_period_end": bool(row["cancel_at_period_end"]), "short_url": row["short_url"]}

    # ── starting one ─────────────────────────────────────────────────────────
    def checkout(self, user: Dict, tier: str, period: str) -> Dict:
        p = self.provider()
        if p is None:
            raise payments_off()
        if tier not in PAID_TIERS or period not in PERIOD_DAYS:
            raise AppError("invalid_input", "Choose Scholar, Sage or Archmage, monthly or yearly.", status_code=400)
        cur = self.current(user["user_id"])
        if cur and cur["status"] in ("active", "authenticated") and (cur["tier"], cur["period"]) == (tier, period) \
                and not cur["cancel_at_period_end"]:
            raise AppError("already_subscribed", f"You're already on {cur['tier_name']}.", status_code=409)
        sub = p.create(int(user["user_id"]), tier, period)
        now = _iso(self.now())
        self.store.execute(
            "INSERT INTO subscriptions (id, user_id, provider, tier, period, status, short_url, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (sub["id"], int(user["user_id"]), p.name, tier, period, sub.get("status") or "created", sub.get("short_url"), now, now))
        plan = entitlements.PLANS[tier]
        return {"provider": p.name, "subscription_id": sub["id"], "key_id": p.key_id, "short_url": sub.get("short_url"),
                "tier": tier, "tier_name": entitlements.TIER_NAMES[tier], "period": period, "currency": "INR",
                "amount": plan["price_month"] if period == "month" else plan["price_year"],
                "prefill": {"name": user.get("full_name") or "", "email": user.get("email") or ""}}

    def verify(self, user: Dict, payment_id: str, sub_id: str, signature: str) -> Dict:
        """Checkout's success handler: a valid signature switches the plan on now (webhooks follow up)."""
        p = self.provider()
        if p is None:
            raise payments_off()
        row = self._row(sub_id)
        if not row or int(row["user_id"]) != int(user["user_id"]):
            raise AppError("subscription_not_found", "That subscription isn't yours.", status_code=404)
        if not p.verify_checkout(payment_id, sub_id, signature):
            raise AppError("payment_unverified", "The payment couldn't be verified. If you were charged, it will "
                           "show up shortly; otherwise try again.", status_code=400)
        try:
            entity = p.fetch(sub_id)
        except AppError:
            entity = {"id": sub_id, "status": "authenticated"}          # the webhook will bring the real dates
        entity.setdefault("status", "authenticated")
        if entity["status"] == "created":
            entity["status"] = "authenticated"
        return self._update(row, entity)

    # ── what the provider tells us ───────────────────────────────────────────
    def webhook(self, body: bytes, signature: str, event_id: str) -> Dict:
        p = self.provider()
        if p is None or p.name != "razorpay":
            raise payments_off()
        if not p.verify_webhook(body, signature):
            raise AppError("webhook_unverified", "Bad signature.", status_code=400)
        try:
            data = json.loads(body)
        except ValueError:
            raise AppError("invalid_input", "Bad JSON.", status_code=400)
        event = str(data.get("event") or "")
        entity = (((data.get("payload") or {}).get("subscription") or {}).get("entity")) or {}
        eid = event_id or hashlib.sha256(body).hexdigest()
        took = self.store.execute("INSERT OR IGNORE INTO payment_events (id, provider, event, subscription_id, received_at) "
                                  "VALUES (?, 'razorpay', ?, ?, ?)", (eid, event, entity.get("id"), _iso(self.now())))
        if not took:
            return {"ok": True, "duplicate": True}
        row = self._row(entity.get("id") or "")
        if not row:
            logger.info("webhook %s for an unknown subscription", event)
            return {"ok": True, "ignored": True}
        self._update(row, entity)
        return {"ok": True}

    def cancel(self, user: Dict) -> Dict:
        p = self.provider()
        if p is None:
            raise payments_off()
        rows = self.store.fetchall("SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('authenticated', 'active', 'pending') "
                                   "ORDER BY created_at DESC", (int(user["user_id"]),))
        if not rows:
            raise AppError("subscription_not_found", "You have no subscription to cancel.", status_code=404)
        row = rows[0]
        p.cancel(row["id"], at_cycle_end=True)
        self.store.execute("UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?",
                           (_iso(self.now()), row["id"]))
        return self.public(self._row(row["id"]))

    def stub_complete(self, user: Dict, sub_id: str) -> Dict:
        """The stub's "payment": what Checkout + verify do for real."""
        p = self.provider()
        if p is None or p.name != "stub":
            raise AppError("not_found", "Not found.", status_code=404)
        return self.verify(user, "pay_stub", sub_id, "stub")

    # ── plan sync ────────────────────────────────────────────────────────────
    def _update(self, row: Dict, entity: Dict) -> Dict:
        status = str(entity.get("status") or row["status"])
        start = _from_unix(entity.get("current_start"))
        end = _from_unix(entity.get("current_end"))
        if status in LIVE and not end and not row["current_end"]:
            end = (start or self.now()) + timedelta(days=PERIOD_DAYS[row["period"]])
        self.store.execute(
            "UPDATE subscriptions SET status = ?, current_start = COALESCE(?, current_start), current_end = COALESCE(?, current_end), "
            "short_url = COALESCE(?, short_url), updated_at = ? WHERE id = ?",
            (status, _iso(start), _iso(end), entity.get("short_url"), _iso(self.now()), row["id"]))
        row = self._row(row["id"])
        self._sync_plan(row)
        if status in ("authenticated", "active"):
            self._retire_others(row)
        return self.public(row)

    def _sync_plan(self, row: Dict) -> None:
        uid, now = int(row["user_id"]), self.now()
        end = datetime.fromisoformat(row["current_end"]) if row["current_end"] else None
        if row["status"] in LIVE:
            expires = (end or now) + timedelta(days=GRACE_DAYS)
        elif row["status"] in ENDED_AT_PERIOD_END:
            expires = max(end or now, now)
        elif row["status"] in ENDED_NOW:
            expires = now
        else:
            return                                              # created: nothing paid yet
        plan = self.store.fetchone("SELECT * FROM user_plans WHERE user_id = ?", (uid,))
        if row["status"] not in LIVE and plan and not (plan["source"] == "subscription" and plan["source_ref"] == row["id"]):
            return                                              # an old subscription ending doesn't touch a newer plan
        self.store.execute(
            "INSERT INTO user_plans (user_id, tier, source, source_ref, started_at, expires_at, updated_at) "
            "VALUES (?, ?, 'subscription', ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, "
            "source = 'subscription', source_ref = excluded.source_ref, expires_at = excluded.expires_at, "
            "updated_at = excluded.updated_at, started_at = CASE WHEN user_plans.source_ref = excluded.source_ref "
            "THEN user_plans.started_at ELSE excluded.started_at END",
            (uid, row["tier"], row["id"], _iso(now), _iso(expires), _iso(now)))

    def _retire_others(self, row: Dict) -> None:
        """Switching plans: the user's other live subscriptions are cancelled now (best effort)."""
        others = self.store.fetchall("SELECT * FROM subscriptions WHERE user_id = ? AND id != ? AND status IN ('authenticated', 'active', 'pending')",
                                     (row["user_id"], row["id"]))
        p = self.provider()
        for o in others:
            try:
                if p is not None:
                    p.cancel(o["id"], at_cycle_end=False)
            except AppError:
                logger.warning("could not cancel the previous subscription %s", o["id"])
            self.store.execute("UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE id = ?", (_iso(self.now()), o["id"]))
