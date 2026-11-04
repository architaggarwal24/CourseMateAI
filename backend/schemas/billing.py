"""Request / response shapes for subscriptions (routers/billing.py)."""
from typing import Dict, Optional

from pydantic import BaseModel, Field

from .base import ApiModel


class CheckoutRequest(BaseModel):
    tier: str = Field(max_length=20)
    period: str = Field(default="month", max_length=10)


class CheckoutResponse(ApiModel):
    provider: str                         # razorpay | stub
    subscription_id: str
    key_id: str                           # Razorpay Checkout's `key` (public)
    short_url: Optional[str] = None
    tier: str
    tier_name: str
    period: str
    currency: str
    amount: int                           # INR, what the plan costs per period
    prefill: Dict[str, str]


class VerifyRequest(BaseModel):
    razorpay_payment_id: str = Field(max_length=64)
    razorpay_subscription_id: str = Field(max_length=64)
    razorpay_signature: str = Field(max_length=256)


class StubCompleteRequest(BaseModel):
    subscription_id: str = Field(max_length=64)


class SubscriptionOut(ApiModel):
    id: str
    provider: str
    tier: str
    tier_name: str
    period: str
    status: str                           # created | authenticated | active | pending | halted | cancelled | completed ...
    current_end: Optional[str] = None
    cancel_at_period_end: bool
    short_url: Optional[str] = None


class BillingStatus(ApiModel):
    enabled: bool
    provider: Optional[str] = None
    key_id: Optional[str] = None
    subscription: Optional[SubscriptionOut] = None


class WebhookAck(ApiModel):
    ok: bool
    duplicate: Optional[bool] = None      # the event was handled before
    ignored: Optional[bool] = None        # about a subscription this server doesn't know
