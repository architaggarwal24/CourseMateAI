"""Request / response shapes for plans, usage and invite codes (routers/account.py)."""
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from .base import ApiModel


class PlanOut(ApiModel):
    tier: str
    name: str
    tagline: str
    price_month: int                      # INR
    price_year: int
    currency: str
    limits: Dict[str, int]                # documents, pdf_mb, ai_calls_day, tokens_month, courses
    features: List[str]
    highlights: List[str]


class PlansResponse(ApiModel):
    plans: List[PlanOut]
    invite_only: bool
    managed_ai: bool                      # the server has its own AI: signup needs no provider key
    payments_enabled: bool
    currency: str


class UsageDay(ApiModel):
    day: str
    ai_calls: int
    tokens: int


class OwnKeyUsage(ApiModel):
    active: bool                          # the user saved their own provider key
    exempt: bool                          # ...and its calls are outside the plan's AI quotas
    calls_today: int
    tokens_month: int


class UsageResponse(ApiModel):
    tier: str
    tier_name: str
    source: str                           # default | invite | admin | subscription
    expires_at: Optional[str] = None
    limits: Dict[str, int]
    used: Dict[str, int]                  # ai_calls_day, tokens_month, documents, courses
    own_key: OwnKeyUsage
    resets: Dict[str, str]
    history: List[UsageDay]


class RedeemRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
