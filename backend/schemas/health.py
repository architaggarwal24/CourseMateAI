from typing import Dict

from .base import ApiModel


class HealthResponse(ApiModel):
    status: str


class ReadyResponse(ApiModel):
    status: str
    checks: Dict[str, str]
    active_sessions: int
