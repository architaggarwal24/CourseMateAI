"""Error monitoring with Sentry (Phase 3 Stage 4d; docs/security.md). Off unless SENTRY_DSN is set.

Nothing personal or secret leaves the server: no request bodies, cookies, auth or signature headers, query
strings, IP addresses or emails (send_default_pii off, plus scrub_event), and anything that looks like a provider
key, a Razorpay secret or a Fernet token is replaced with [redacted] wherever it appears - exception messages,
breadcrumbs, extras. Errors only by default; SENTRY_TRACES_SAMPLE_RATE turns on a share of performance traces.
"""
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

SECRET_RE = re.compile(
    r"(sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_\-]{12,}|AIza[0-9A-Za-z_\-]{20,}|nvapi-[A-Za-z0-9_\-]{12,}"
    r"|rzp_(?:test|live)_[A-Za-z0-9]{8,}|gAAAAA[A-Za-z0-9_\-=]{10,}|whsec_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._\-]+)")
DROP_HEADERS = {"cookie", "authorization", "x-razorpay-signature", "x-api-key", "set-cookie"}
SECRET_KEYS = re.compile(r"pass|secret|token|key|signature|cookie|auth", re.I)


def _clean(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return value
    if isinstance(value, str):
        return SECRET_RE.sub("[redacted]", value)
    if isinstance(value, dict):
        return {k: ("[redacted]" if isinstance(k, str) and SECRET_KEYS.search(k) else _clean(v, depth + 1))
                for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v, depth + 1) for v in value]
    return value


def scrub_event(event: dict, hint: dict) -> dict:
    """Sentry's before_send / before_send_transaction: strip what could identify a user or unlock anything."""
    req = event.get("request")
    if isinstance(req, dict):
        req["headers"] = {k: v for k, v in (req.get("headers") or {}).items() if k.lower() not in DROP_HEADERS}
        for k in ("cookies", "data", "query_string", "env"):
            req.pop(k, None)
    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if "id" in user else {}
    for k in ("exception", "breadcrumbs", "extra", "logentry", "message"):
        if k in event:
            event[k] = _clean(event[k])
    return event


def init_monitoring() -> bool:
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk isn't installed")
        return False
    try:
        rate = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE") or 0)
    except ValueError:
        rate = 0.0
    sentry_sdk.init(
        dsn=dsn, environment=os.environ.get("SENTRY_ENVIRONMENT") or "production",
        release=os.environ.get("SENTRY_RELEASE") or None, send_default_pii=False, include_local_variables=False,
        max_request_body_size="never", traces_sample_rate=rate,
        before_send=scrub_event, before_send_transaction=scrub_event,
    )
    logger.info("error monitoring on (Sentry, %s)", os.environ.get("SENTRY_ENVIRONMENT") or "production")
    return True
