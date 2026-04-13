"""
key_service.py — Encrypt/decrypt user API keys and validate them with a cheap test call.
Uses Fernet symmetric encryption. The ENCRYPTION_KEY env var must be a valid Fernet key
(URL-safe base64, 32 bytes).

Generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

IMPORTANT: Once set, ENCRYPTION_KEY must NEVER change. Changing it means every user's
stored API key in the database becomes permanently unreadable (InvalidToken). If you need
to rotate the key, first decrypt all existing keys with the old key and re-encrypt them
with the new one before swapping.
"""

import os
import sys
import logging
from typing import Tuple

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


# ── Encryption setup ──────────────────────────────────────────────────────────

def _get_fernet() -> Fernet:
    """
    Returns a Fernet instance using ENCRYPTION_KEY env var.

    Set ENCRYPTION_KEY in your .env file. Generate with:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

    BACKWARD COMPATIBILITY: If ENCRYPTION_KEY is not set, falls back to deriving
    a key from SECRET_KEY (the original behaviour) so existing accounts keep working.
    A loud warning is logged. Always set ENCRYPTION_KEY in production.
    """
    raw = os.getenv("ENCRYPTION_KEY", "")
    if raw:
        try:
            return Fernet(raw.encode())
        except Exception as e:
            raise RuntimeError(
                f"ENCRYPTION_KEY is invalid: {e}\n"
                "It must be a valid Fernet key (URL-safe base64, 32 bytes).\n"
                'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )

    # Fallback: derive from SECRET_KEY for backward-compat with existing accounts.
    # Same derivation as the original code — previously-encrypted keys still decrypt correctly.
    # Upgrade path: set ENCRYPTION_KEY in .env, then have users re-enter their API key once.
    logger.warning(
        "ENCRYPTION_KEY is not set — falling back to key derived from SECRET_KEY. "
        "Safe for local dev, but set ENCRYPTION_KEY before going to production. "
        'Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    )
    import base64
    secret = os.getenv("SECRET_KEY", "fallback-secret-change-me")
    derived = base64.urlsafe_b64encode(secret.encode("utf-8").ljust(32)[:32]).decode()
    return Fernet(derived.encode())


def encrypt_key(plaintext: str) -> str:
    """Encrypt an API key for storage."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_key(ciphertext: str) -> str:
    """Decrypt a stored API key."""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError(
            "Failed to decrypt API key — ENCRYPTION_KEY may have changed since the key was stored. "
            "The user will need to re-enter their API key."
        )


# ── Validation ────────────────────────────────────────────────────────────────

SUPPORTED_PROVIDERS = ("mistral", "openai", "gemini", "claude")


def validate_api_key(provider: str, api_key: str, model: str = None) -> Tuple[bool, str]:
    """
    Make the cheapest possible test call for each provider.
    Returns (ok: bool, error_message: str).
    """
    provider = provider.lower().strip()
    if provider not in SUPPORTED_PROVIDERS:
        return False, f"Unsupported provider '{provider}'. Choose from: {', '.join(SUPPORTED_PROVIDERS)}"

    try:
        if provider == "mistral":
            # FIX #7: Validate against mistral-large-2512 (same as runtime default in llm_connection.py).
            # The old code validated with mistral-small-latest, which passes for free-tier keys,
            # but llm_connection.py uses mistral-large-2512 at runtime — a paid model.
            # Free-tier keys would pass validation but fail every actual LLM call with a 403.
            return _validate_mistral(api_key, model or "mistral-large-2512")
        elif provider == "openai":
            # FIX #6: gpt-oss-20b does not exist. Use a real OpenAI model name.
            return _validate_openai(api_key, model or "gpt-4o-mini")
        elif provider == "gemini":
            # FIX: gemini-2.5-flash is not available on free-tier Google AI keys.
            # When no model is explicitly provided, validate against gemini-1.5-flash
            # (available on all tiers). If the user explicitly selected a 2.5 model,
            # that model string is passed through — if their key can't access it they
            # get a clear "model not found" error rather than a confusing crash.
            return _validate_gemini(api_key, model or "gemini-1.5-flash")
        elif provider == "claude":
            return _validate_anthropic(api_key, model or "claude-sonnet-4-6")
    except ImportError as e:
        logger.error(f"Provider package not installed ({provider}): {e}")
        return False, f"Server is missing the {provider} package — run: pip install langchain-anthropic langchain-google-genai"
    except Exception as e:
        logger.warning(f"API key validation error ({provider}): {e}")
        err_str = str(e)
        if "401" in err_str or "invalid_api_key" in err_str.lower() or "authentication" in err_str.lower():
            return False, "Invalid API key — double-check it and try again"
        if "403" in err_str:
            return False, "API key doesn't have permission for this model"
        if "404" in err_str:
            return False, "Model not found — key may be valid but model unavailable"
        return False, f"Validation failed: {err_str[:200]}"

    return False, "Unknown error"


def _validate_mistral(api_key: str, model: str = "mistral-large-2512") -> Tuple[bool, str]:
    # FIX #7: Default matches llm_connection.py runtime default
    from langchain_mistralai import ChatMistralAI
    from langchain_core.messages import HumanMessage
    llm = ChatMistralAI(api_key=api_key, model=model, max_tokens=5, timeout=5)
    llm.invoke([HumanMessage(content="hi")])
    return True, ""


def _validate_openai(api_key: str, model: str = "gpt-4o-mini") -> Tuple[bool, str]:
    # FIX #6: Real OpenAI model name (gpt-oss-20b does not exist)
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage
    llm = ChatOpenAI(api_key=api_key, model=model, max_tokens=5, timeout=5)
    llm.invoke([HumanMessage(content="hi")])
    return True, ""


def _validate_gemini(api_key: str, model: str = "gemini-1.5-flash") -> Tuple[bool, str]:
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.messages import HumanMessage
    llm = ChatGoogleGenerativeAI(google_api_key=api_key, model=model, max_output_tokens=5, timeout=5)
    llm.invoke([HumanMessage(content="hi")])
    return True, ""


def _validate_anthropic(api_key: str, model: str = "claude-sonnet-4-6") -> Tuple[bool, str]:
    # FIX BUG-F13 (verified): "claude-sonnet-4-6" IS the correct Anthropic API model string
    # for Claude Sonnet 4.6 as of 2025. Bug report flagged this incorrectly.
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import HumanMessage
    llm = ChatAnthropic(api_key=api_key, model=model, max_tokens=5, timeout=5)
    llm.invoke([HumanMessage(content="hi")])
    return True, ""