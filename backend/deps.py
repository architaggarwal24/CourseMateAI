"""Shared FastAPI dependencies and request helpers: authentication and per-request LLM key."""
import logging
from typing import Optional

from fastapi import Depends, Request

import providers
from config import settings
from core_brains.llm_connection import (
    InvalidApiKeyError, ProviderUnreachableError, QuotaExceededError,
    clear_request_key, set_request_key,
)
from errors import AppError, provider_key_rejected, provider_quota, provider_unreachable
from key_service import decrypt_key
from state import auth_middleware, db

logger = logging.getLogger(__name__)

# Same dependency object the endpoints used before: `Depends(require_auth)`.
require_auth = auth_middleware.require_auth


async def get_optional_user(request: Request) -> Optional[dict]:
    """Returns user dict if authenticated, None if guest."""
    try:
        return await auth_middleware.get_current_user(request)
    except Exception:
        return None


def provider_error_for(exc: Exception) -> Optional[AppError]:
    """The API's coded error for a provider failure, or None if `exc` isn't one.

    * QuotaExceededError  → 429 provider_quota (details.usage_url)
    * InvalidApiKeyError  → 400 provider_key_rejected (NOT 401: the frontend redirects to /login on any 401)
    * ProviderUnreachableError → 502 provider_unreachable
    """
    if isinstance(exc, InvalidApiKeyError):
        return provider_key_rejected(providers.provider_label(exc.provider))
    if isinstance(exc, ProviderUnreachableError):
        return provider_unreachable(providers.provider_label(exc.provider))
    if isinstance(exc, QuotaExceededError):
        return provider_quota(exc.provider, providers.provider_label(exc.provider), exc.usage_url)
    return None


def raise_quota_if_needed(exc: Exception):
    """Raise the coded error for a provider failure; anything else is left for the caller to handle."""
    err = provider_error_for(exc)
    if err is not None:
        raise err


def get_user_llm(user: dict):
    """Fetch the user's decrypted API key, provider, model and base URL.
    Returns (key, provider, model, base_url)."""
    key_data = db.get_api_key_data(user["user_id"])
    if not key_data or not key_data.get("api_key_encrypted"):
        # No saved key: fall back to a provider key from the server environment (read once at startup).
        for provider, val in settings.fallback_llm_keys:
            return val, provider, None, None
        return "", "", None, None  # no key anywhere — ask_llm() raises a clear error to the user

    provider = key_data.get("llm_provider") or ""
    if providers.get_provider(provider) is None:
        # e.g. accounts created when Mistral was supported. Say exactly what to do.
        raise AppError(
            "provider_unsupported",
            f"Your saved AI provider ({provider or 'unknown'}) is no longer available. "
            "Open Settings → AI Provider and pick a new one.",
            status_code=400, action="settings",
        )
    return (
        decrypt_key(key_data["api_key_encrypted"]),
        provider,
        key_data.get("llm_model"),
        key_data.get("llm_base_url"),
    )


async def inject_user_llm_key(user=Depends(require_auth)):
    """FastAPI dependency: sets the per-request LLM settings for this request."""
    api_key, provider, model, base_url = get_user_llm(user)
    set_request_key(api_key, provider, model, base_url)
    try:
        yield user
    finally:
        clear_request_key()
