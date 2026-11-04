"""Paid plans through subscriptions: Razorpay (faked HTTP) and the stub (Phase 3 Stage 4c, docs/payments.md)."""
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

import pytest

import state
from services import entitlements

KEY_SECRET, HOOK_SECRET = "rzp_secret_test", "whsec_test"
PLANS = {"scholar:month": "plan_SCH_M", "sage:month": "plan_SAGE_M", "sage:year": "plan_SAGE_Y"}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for t in ("payment_events", "subscriptions", "user_plans"):
        state.store.execute(f"DELETE FROM {t}")
    for v in ("PAYMENTS_ENABLED", "PAYMENTS_PROVIDER", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
              "RAZORPAY_PLAN_IDS_JSON"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("DEFAULT_TIER", "apprentice")
    yield


class FakeRazorpay:
    """requests.request for api.razorpay.com: keeps subscriptions in a dict."""

    def __init__(self):
        self.subs, self.calls = {}, []

    def request(self, method, url, json=None, auth=None, timeout=None):
        path = url.replace("https://api.razorpay.com/v1", "")
        self.calls.append((method, path, json, auth))
        if method == "POST" and path == "/subscriptions":
            sid = f"sub_{len(self.subs) + 1:04d}"
            self.subs[sid] = {"id": sid, "plan_id": json["plan_id"], "status": "created", "short_url": f"https://rzp.io/i/{sid}",
                              "notes": json["notes"], "current_start": None, "current_end": None}
            return _Resp(200, self.subs[sid])
        sid = path.split("/")[2]
        if method == "GET":
            return _Resp(200, self.subs[sid])
        if path.endswith("/cancel"):
            self.subs[sid]["status"] = "active" if json["cancel_at_cycle_end"] else "cancelled"
            return _Resp(200, self.subs[sid])
        return _Resp(404, {})


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


@pytest.fixture()
def razorpay(monkeypatch):
    fake = FakeRazorpay()
    monkeypatch.setenv("PAYMENTS_ENABLED", "1")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", KEY_SECRET)
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", HOOK_SECRET)
    monkeypatch.setenv("RAZORPAY_PLAN_IDS_JSON", json.dumps(PLANS))
    import requests
    monkeypatch.setattr(requests, "request", fake.request)
    return fake


def _sig(payment_id, sub_id):
    return hmac.new(KEY_SECRET.encode(), f"{payment_id}|{sub_id}".encode(), hashlib.sha256).hexdigest()


def _hook(c, event, sub, event_id=None, secret=HOOK_SECRET):
    body = json.dumps({"event": event, "payload": {"subscription": {"entity": sub}}}).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return c.post("/billing/webhook", content=body, headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json",
                                                             "X-Razorpay-Event-Id": event_id or f"evt_{time.time_ns()}"})


def _plan(uid):
    return state.store.fetchone("SELECT * FROM user_plans WHERE user_id = ?", (uid,))


# ═════════════════════════ off by default ═══════════════════════════════════
def test_payments_are_off_unless_enabled_and_configured(make_user, monkeypatch):
    c, _ = make_user()
    assert c.get("/billing").json()["enabled"] is False and c.get("/plans").json()["payments_enabled"] is False
    r = c.post("/billing/checkout", json={"tier": "sage", "period": "month"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "payments_unavailable"
    monkeypatch.setenv("PAYMENTS_ENABLED", "1")                                    # on, but no keys: still off
    assert c.get("/billing").json()["enabled"] is False
    assert c.post("/billing/stub/complete", json={"subscription_id": "x"}).status_code == 404


# ═════════════════════════ the stub ═════════════════════════════════════════
def test_the_stub_runs_the_whole_flow_without_money(make_user, monkeypatch):
    monkeypatch.setenv("PAYMENTS_ENABLED", "1")
    monkeypatch.setenv("PAYMENTS_PROVIDER", "stub")
    c, uid = make_user()
    assert c.get("/billing").json() == {"enabled": True, "provider": "stub", "key_id": "stub", "subscription": None}
    co = c.post("/billing/checkout", json={"tier": "sage", "period": "month"}).json()
    assert co["provider"] == "stub" and co["amount"] == 299 and co["currency"] == "INR"
    assert entitlements.tier_for(uid) == "apprentice"                              # nothing paid yet
    sub = c.post("/billing/stub/complete", json={"subscription_id": co["subscription_id"]}).json()
    assert sub["status"] == "authenticated" or sub["status"] == "active"
    assert entitlements.tier_for(uid) == "sage" and _plan(uid)["source"] == "subscription"
    left = datetime.fromisoformat(_plan(uid)["expires_at"]) - datetime.now(timezone.utc)
    assert timedelta(days=32) < left <= timedelta(days=33)                         # a month + 3 days' grace
    assert c.post("/billing/checkout", json={"tier": "sage", "period": "month"}).status_code == 409


# ═════════════════════════ Razorpay ═════════════════════════════════════════
def test_checkout_creates_a_razorpay_subscription_and_a_valid_signature_switches_the_plan_on(make_user, razorpay):
    c, uid = make_user()
    assert c.get("/billing").json()["key_id"] == "rzp_test_key"
    co = c.post("/billing/checkout", json={"tier": "sage", "period": "year"}).json()
    sid = co["subscription_id"]
    method, path, body, auth = razorpay.calls[0]
    assert (method, path, body["plan_id"], body["notes"]["user_id"], auth) == ("POST", "/subscriptions", "plan_SAGE_Y", str(uid),
                                                                                 ("rzp_test_key", KEY_SECRET))
    assert co["short_url"] == f"https://rzp.io/i/{sid}" and co["amount"] == 2990
    bad = c.post("/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": sid, "razorpay_signature": "nope"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "payment_unverified"
    assert entitlements.tier_for(uid) == "apprentice"
    now = int(time.time())
    razorpay.subs[sid].update(status="active", current_start=now, current_end=now + 365 * 86400)
    ok = c.post("/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": sid,
                                         "razorpay_signature": _sig("pay_1", sid)})
    assert ok.status_code == 200 and ok.json()["status"] == "active"
    assert entitlements.tier_for(uid) == "sage"
    other, _ = make_user()
    assert other.post("/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": sid,
                                               "razorpay_signature": _sig("pay_1", sid)}).status_code == 404


def test_a_plan_that_isnt_on_sale_is_refused(make_user, razorpay):
    c, _ = make_user()
    r = c.post("/billing/checkout", json={"tier": "archmage", "period": "month"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "plan_not_on_sale"
    assert c.post("/billing/checkout", json={"tier": "apprentice", "period": "month"}).status_code == 400


def test_webhooks_keep_the_plan_in_step_and_each_event_counts_once(make_user, razorpay, client):
    c, uid = make_user()
    sid = c.post("/billing/checkout", json={"tier": "scholar", "period": "month"}).json()["subscription_id"]
    now = int(time.time())
    entity = {"id": sid, "status": "active", "current_start": now, "current_end": now + 30 * 86400}
    assert _hook(client, "subscription.activated", entity, secret="wrong").status_code == 400
    assert entitlements.tier_for(uid) == "apprentice"
    assert _hook(client, "subscription.activated", entity, event_id="evt_1").json() == {"ok": True}
    assert entitlements.tier_for(uid) == "scholar"
    first_end = _plan(uid)["expires_at"]
    entity2 = {**entity, "current_start": now + 30 * 86400, "current_end": now + 60 * 86400}
    _hook(client, "subscription.charged", entity2, event_id="evt_2")
    assert _plan(uid)["expires_at"] > first_end                                    # the next month is paid
    assert _hook(client, "subscription.charged", entity2, event_id="evt_2").json()["duplicate"] is True
    _hook(client, "subscription.halted", {**entity2, "status": "halted"})          # payments failed after retries
    assert entitlements.tier_for(uid) == "apprentice"
    assert c.get("/billing").json()["subscription"]["status"] == "halted"
    assert _hook(client, "subscription.activated", {"id": "sub_unknown", "status": "active"}).json()["ignored"] is True


def test_cancelling_keeps_the_plan_until_the_paid_period_ends(make_user, razorpay, client):
    c, uid = make_user()
    sid = c.post("/billing/checkout", json={"tier": "sage", "period": "month"}).json()["subscription_id"]
    now = int(time.time())
    entity = {"id": sid, "status": "active", "current_start": now, "current_end": now + 20 * 86400}
    _hook(client, "subscription.activated", entity)
    r = c.post("/billing/cancel").json()
    assert r["cancel_at_period_end"] is True and razorpay.calls[-1][2] == {"cancel_at_cycle_end": 1}
    assert entitlements.tier_for(uid) == "sage"
    _hook(client, "subscription.cancelled", {**entity, "status": "cancelled"})
    left = datetime.fromisoformat(_plan(uid)["expires_at"]) - datetime.now(timezone.utc)
    assert timedelta(days=19) < left <= timedelta(days=20)                         # until the end, no grace
    assert c.post("/billing/cancel").status_code == 404


def test_switching_plans_cancels_the_old_subscription(make_user, razorpay, client):
    c, uid = make_user()
    now = int(time.time())
    old = c.post("/billing/checkout", json={"tier": "scholar", "period": "month"}).json()["subscription_id"]
    _hook(client, "subscription.activated", {"id": old, "status": "active", "current_start": now, "current_end": now + 86400 * 30})
    new = c.post("/billing/checkout", json={"tier": "sage", "period": "month"}).json()["subscription_id"]
    _hook(client, "subscription.activated", {"id": new, "status": "active", "current_start": now, "current_end": now + 86400 * 30})
    assert entitlements.tier_for(uid) == "sage"
    assert ("POST", f"/subscriptions/{old}/cancel", {"cancel_at_cycle_end": 0}) in [(m, p, b) for m, p, b, _ in razorpay.calls]
    assert state.store.fetchone("SELECT status FROM subscriptions WHERE id = ?", (old,))["status"] == "cancelled"
    _hook(client, "subscription.cancelled", {"id": old, "status": "cancelled", "current_end": now})   # the old one's end
    assert entitlements.tier_for(uid) == "sage"                                    # doesn't touch the new plan
    assert c.get("/billing").json()["subscription"]["id"] == new
