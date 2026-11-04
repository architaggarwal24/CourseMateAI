"""Plans: what each one unlocks and allows (Phase 3 Stage 3A stub, Stage 4a real plans; docs/plans.md).

The four tiers, lowest first: Apprentice (free), Scholar (Pro), Sage (Pro Plus), Archmage (Max). A feature names the
LOWEST tier that has it; every higher tier has it too. Each tier also has limits (PLANS): documents, PDF size, AI
calls a day, tokens a month, courses - enforced by the documents, courses and usage services.

A user's plan is their row in user_plans while it hasn't expired (an invite code, an admin, a subscription), else
the server default DEFAULT_TIER (env; "archmage" when unset so a dev setup has everything - set it to "apprentice"
for testers and production). Endpoints call `require(user_id, feature)` / `limits_for(user_id)`; the UI reads
GET /entitlements, GET /plans and GET /account/usage.
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict, Optional

from errors import AppError

logger = logging.getLogger(__name__)

TIERS = ("apprentice", "scholar", "sage", "archmage")
TIER_NAMES = {"apprentice": "Apprentice", "scholar": "Scholar", "sage": "Sage", "archmage": "Archmage"}

# feature -> the lowest tier that has it (docs/coursemateai-context.md, "Tiers")
FEATURES: Dict[str, str] = {
    "review_queue": "scholar",     # spaced-repetition review queue (FSRS)
    "exam_mode": "sage",           # timed mock exams with a PDF score report
    "courses": "sage",             # several PDFs grouped into a course, studied together
    "concept_map": "sage",         # the concept map of a document / course
    "pdf_viewer": "sage",          # citations open the PDF beside the chat, at the page
}
FEATURE_NAMES = {"review_queue": "Spaced-repetition review", "exam_mode": "Exam mode", "courses": "Courses",
                 "concept_map": "The concept map", "pdf_viewer": "The PDF page viewer"}

DEFAULT_TIER_ENV = "DEFAULT_TIER"
PLAN_LIMITS_ENV = "PLAN_LIMITS_JSON"        # optional overrides: {"scholar": {"ai_calls_day": 200}, ...}

# Prices in INR (paise-free whole rupees) and limits per tier. 0 courses = no courses (the feature is Sage+).
PLANS: Dict[str, Dict] = {
    "apprentice": {"price_month": 0, "price_year": 0, "documents": 3, "pdf_mb": 10, "ai_calls_day": 25,
                   "tokens_month": 300_000, "courses": 0},
    "scholar": {"price_month": 149, "price_year": 1490, "documents": 15, "pdf_mb": 25, "ai_calls_day": 150,
                "tokens_month": 3_000_000, "courses": 0},
    "sage": {"price_month": 299, "price_year": 2990, "documents": 50, "pdf_mb": 50, "ai_calls_day": 400,
             "tokens_month": 10_000_000, "courses": 10},
    "archmage": {"price_month": 599, "price_year": 5990, "documents": 150, "pdf_mb": 50, "ai_calls_day": 1200,
                 "tokens_month": 30_000_000, "courses": 30},
}
TAGLINES = {
    "apprentice": "Try every core tool on a few PDFs.",
    "scholar": "For a semester: more PDFs and the daily review queue.",
    "sage": "Courses, exams, the concept map and the PDF viewer.",
    "archmage": "Everything, with the most room and the strongest models.",
}
HIGHLIGHTS = {
    "apprentice": ["Chat, quizzes, notes and flashcards", "The arena and your champion"],
    "scholar": ["Everything in Apprentice", "Spaced-repetition review"],
    "sage": ["Everything in Scholar", "Courses across PDFs", "Mock exams with a report", "Concept map and PDF viewer"],
    "archmage": ["Everything in Sage", "Strongest models first", "The largest limits"],
}
LIMIT_KEYS = ("documents", "pdf_mb", "ai_calls_day", "tokens_month", "courses")

_store = None


def bind(store) -> None:
    """state.py hands over the database once, so tier_for can read user_plans."""
    global _store
    _store = store


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _overrides() -> Dict[str, Dict]:
    raw = os.environ.get(PLAN_LIMITS_ENV, "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return {t: {k: int(v) for k, v in (data.get(t) or {}).items() if k in LIMIT_KEYS} for t in TIERS}
    except (ValueError, TypeError, AttributeError):
        logger.warning("%s is not valid JSON; using the built-in limits", PLAN_LIMITS_ENV)
        return {}


def limits(tier: str) -> Dict[str, int]:
    base = {k: PLANS[tier][k] for k in LIMIT_KEYS}
    base.update(_overrides().get(tier, {}))
    return base


def default_tier() -> str:
    tier = (os.environ.get(DEFAULT_TIER_ENV) or "archmage").strip().lower()
    return tier if tier in TIERS else "archmage"


def plan_row(user_id) -> Optional[Dict]:
    """The user's plan row while it is in force (not expired), else None."""
    if _store is None or user_id is None:
        return None
    try:
        row = _store.fetchone("SELECT * FROM user_plans WHERE user_id = ?", (int(user_id),))
    except (ValueError, TypeError):
        return None
    if not row:
        return None
    exp = row["expires_at"]
    if exp and datetime.fromisoformat(exp) <= _now():
        return None
    return dict(row)


def tier_for(user_id) -> str:
    """The user's plan: their plan row while it is in force, else DEFAULT_TIER."""
    row = plan_row(user_id)
    return row["tier"] if row and row["tier"] in TIERS else default_tier()


def limits_for(user_id) -> Dict[str, int]:
    return limits(tier_for(user_id))


def next_tier(tier: str) -> Optional[str]:
    i = TIERS.index(tier)
    return TIERS[i + 1] if i + 1 < len(TIERS) else None


def lowest_tier_with(key: str, needed: int) -> Optional[str]:
    """The cheapest tier whose `key` limit is at least `needed` (for "upgrade to X" prompts)."""
    return next((t for t in TIERS if limits(t)[key] >= needed), None)


def plan_limit(user_id, key: str, used: int, allowed: int, message: str, *, status_code: int = 403,
               resets_at: Optional[str] = None) -> AppError:
    """The error for a plan limit: 403 (documents, size, courses) or 429 (AI calls, tokens), action "plans"."""
    tier = tier_for(user_id)
    up = lowest_tier_with(key, max(allowed + 1, used + 1)) if TIERS.index(tier) < len(TIERS) - 1 else None
    if up and TIERS.index(up) <= TIERS.index(tier):
        up = next_tier(tier)
    details = {"limit": key, "used": used, "allowed": allowed, "tier": tier, "tier_name": TIER_NAMES[tier],
               "upgrade_tier": up, "upgrade_tier_name": TIER_NAMES[up] if up else None}
    if resets_at:
        details["resets_at"] = resets_at
    return AppError("plan_limit", message, status_code=status_code, action="plans", details=details)


def plans_catalog() -> list:
    """GET /plans: every tier with its price, limits, features and highlights."""
    return [{"tier": t, "name": TIER_NAMES[t], "tagline": TAGLINES[t], "price_month": PLANS[t]["price_month"],
             "price_year": PLANS[t]["price_year"], "currency": "INR", "limits": limits(t),
             "features": [f for f, need in FEATURES.items() if has(t, f)], "highlights": HIGHLIGHTS[t]}
            for t in TIERS]


def has(tier: str, feature: str) -> bool:
    need = FEATURES[feature]
    return TIERS.index(tier) >= TIERS.index(need)


def allowed(user_id, feature: str) -> bool:
    return has(tier_for(user_id), feature)


def summary(user_id) -> dict:
    """What GET /entitlements answers: the plan, and per feature whether it is on and which plan has it."""
    tier = tier_for(user_id)
    return {
        "tier": tier, "tier_name": TIER_NAMES[tier],
        "features": {f: {"enabled": has(tier, f), "required_tier": need, "required_tier_name": TIER_NAMES[need],
                         "name": FEATURE_NAMES[f]}
                     for f, need in FEATURES.items()},
    }


def feature_locked(user_id, feature: str) -> AppError:
    tier, need = tier_for(user_id), FEATURES[feature]
    return AppError("feature_locked", f"{FEATURE_NAMES[feature]} comes with the {TIER_NAMES[need]} plan.",
                    status_code=403, action="plans",
                    details={"feature": feature, "tier": tier, "required_tier": need,
                             "required_tier_name": TIER_NAMES[need]})


def require(user_id, feature: str) -> None:
    """Raise 403 feature_locked unless the user's plan has `feature`."""
    if not allowed(user_id, feature):
        raise feature_locked(user_id, feature)
