"""Plans, usage and invite codes (Phase 3 Stage 4a; docs/plans.md).

    GET  /plans             every plan (prices in INR, limits, features) and how signup works here - no login
    GET  /account/usage     the user's plan, limits and what they have used (Account -> Plan & usage)
    POST /account/redeem    use an invite code: the user's plan becomes the code's
"""
import asyncio

from fastapi import APIRouter, Depends, Request

from deps import managed_ai_available, require_auth, uses_own_key
from schemas.account import PlansResponse, RedeemRequest, UsageResponse
from services import entitlements
from services.invite_service import invite_only
from state import billing_service, documents, invite_service, limiter, store, usage_service

router = APIRouter()


def payments_enabled() -> bool:
    return billing_service.enabled()  # Stage 4c: PAYMENTS_ENABLED=1 and a configured provider


@router.get("/plans", response_model=PlansResponse, response_model_exclude_unset=True)
def plans():
    return {"plans": entitlements.plans_catalog(), "invite_only": invite_only(), "managed_ai": managed_ai_available(),
            "payments_enabled": payments_enabled(), "currency": "INR"}


def _usage(user) -> dict:
    uid = user["user_id"]
    courses = store.fetchone("SELECT COUNT(*) AS n FROM courses WHERE user_id = ?", (int(uid),))["n"]
    return usage_service.summary(uid, documents=documents.repo.count_for_user(int(uid)), courses=courses,
                                 byok=uses_own_key(user))


@router.get("/account/usage", response_model=UsageResponse, response_model_exclude_unset=True)
async def account_usage(user=Depends(require_auth)):
    return await asyncio.to_thread(_usage, user)


@router.post("/account/redeem", response_model=UsageResponse, response_model_exclude_unset=True)
@limiter.limit("10/hour")
async def redeem(req: RedeemRequest, request: Request, user=Depends(require_auth)):
    await asyncio.to_thread(invite_service.redeem, user["user_id"], req.code)
    return await asyncio.to_thread(_usage, user)
