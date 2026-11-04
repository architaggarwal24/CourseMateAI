"""Subscriptions (Phase 3 Stage 4c; docs/payments.md). Off unless PAYMENTS_ENABLED=1.

    GET  /billing                  payments on? which provider, its public key, the user's subscription
    POST /billing/checkout         start a subscription for a plan and period (then Razorpay Checkout)
    POST /billing/verify           Checkout's success handler: signature checked, plan on
    POST /billing/cancel           cancel at the end of the paid period
    POST /billing/webhook          Razorpay's events (no login; X-Razorpay-Signature)
    POST /billing/stub/complete    the test provider's "payment" (PAYMENTS_PROVIDER=stub only)
"""
import asyncio

from fastapi import APIRouter, Depends, Request

from deps import require_auth
from schemas.billing import (BillingStatus, CheckoutRequest, CheckoutResponse, StubCompleteRequest, SubscriptionOut,
                             VerifyRequest, WebhookAck)
from state import billing_service, limiter

router = APIRouter()


@router.get("/billing", response_model=BillingStatus, response_model_exclude_unset=True)
async def billing_status(user=Depends(require_auth)):
    p = billing_service.provider()
    sub = await asyncio.to_thread(billing_service.current, user["user_id"])
    return {"enabled": p is not None, "provider": p.name if p else None, "key_id": p.key_id if p else None,
            "subscription": sub}


@router.post("/billing/checkout", response_model=CheckoutResponse, response_model_exclude_unset=True)
@limiter.limit("10/hour")
async def checkout(req: CheckoutRequest, request: Request, user=Depends(require_auth)):
    return await asyncio.to_thread(billing_service.checkout, user, req.tier, req.period)


@router.post("/billing/verify", response_model=SubscriptionOut, response_model_exclude_unset=True)
@limiter.limit("20/hour")
async def verify(req: VerifyRequest, request: Request, user=Depends(require_auth)):
    return await asyncio.to_thread(billing_service.verify, user, req.razorpay_payment_id, req.razorpay_subscription_id,
                                   req.razorpay_signature)


@router.post("/billing/cancel", response_model=SubscriptionOut, response_model_exclude_unset=True)
@limiter.limit("10/hour")
async def cancel(request: Request, user=Depends(require_auth)):
    return await asyncio.to_thread(billing_service.cancel, user)


@router.post("/billing/webhook", response_model=WebhookAck, response_model_exclude_unset=True)
@limiter.limit("300/minute")
async def webhook(request: Request):
    body = await request.body()
    return await asyncio.to_thread(billing_service.webhook, body, request.headers.get("x-razorpay-signature", ""),
                                   request.headers.get("x-razorpay-event-id", ""))


@router.post("/billing/stub/complete", response_model=SubscriptionOut, response_model_exclude_unset=True)
@limiter.limit("20/hour")
async def stub_complete(req: StubCompleteRequest, request: Request, user=Depends(require_auth)):
    return await asyncio.to_thread(billing_service.stub_complete, user, req.subscription_id)
