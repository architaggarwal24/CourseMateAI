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
import re
import sys
import logging
from typing import Optional, Tuple

import providers

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


# ── Encryption setup ──────────────────────────────────────────────────────────

_fernet_instance = None


def _get_fernet() -> Fernet:
    """
    Returns a (cached) Fernet instance using the ENCRYPTION_KEY env var.

    Generate one with:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

    SECURITY: if ENCRYPTION_KEY is missing we now REFUSE to start. The old code fell
    back to a key derived from a hard-coded default string that is visible in the
    source, which made every stored API key effectively plaintext to anyone with the
    database file.

    Upgrading an existing install that has keys stored under the legacy fallback?
    Set ALLOW_INSECURE_DEV_KEY=true once to keep them readable, have those users
    re-enter their key (or re-encrypt them), then set a real ENCRYPTION_KEY.
    """
    global _fernet_instance
    if _fernet_instance is not None:
        return _fernet_instance

    raw = os.getenv("ENCRYPTION_KEY", "")
    if raw:
        try:
            _fernet_instance = Fernet(raw.encode())
            return _fernet_instance
        except Exception as e:
            raise RuntimeError(
                f"ENCRYPTION_KEY is invalid: {e}\n"
                "It must be a valid Fernet key (URL-safe base64, 32 bytes).\n"
                'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )

    if os.getenv("ALLOW_INSECURE_DEV_KEY", "").lower() == "true":
        logger.warning(
            "ENCRYPTION_KEY is not set and ALLOW_INSECURE_DEV_KEY=true — using the legacy "
            "derived key. This is NOT safe for production."
        )
        import base64
        secret = os.getenv("SECRET_KEY", "fallback-secret-change-me")
        derived = base64.urlsafe_b64encode(secret.encode("utf-8").ljust(32)[:32]).decode()
        _fernet_instance = Fernet(derived.encode())
        return _fernet_instance

    raise RuntimeError(
        "ENCRYPTION_KEY environment variable is required but not set.\n"
        'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"\n'
        "and add it to backend/.env as ENCRYPTION_KEY=<value>."
    )


def check_encryption_config() -> None:
    """Call at startup so a misconfiguration fails immediately, not on first login."""
    _get_fernet()


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

# Kept for backwards compatibility with older imports; the registry is the source of truth.
SUPPORTED_PROVIDERS = providers.provider_ids()

_VALIDATE_TIMEOUT = 20          # seconds. The old 5s limit failed on ordinary cold starts.
_VALIDATE_MAX_TOKENS = 64       # tiny, but enough that reasoning models don't return nothing


def _scrub(text: str, secret: str) -> str:
    """Never echo the user's key back in an error message."""
    if secret and secret in text:
        text = text.replace(secret, "***")
    return text


def _explain_error(spec, model: str, base_url, exc: Exception, api_key: str) -> Tuple[bool, str]:
    """Turn a provider exception into (ok, user-facing message)."""
    raw = _scrub(str(exc), api_key)
    low = raw.lower()
    name = type(exc).__name__.lower()
    host = ""
    if base_url:
        host = base_url.split("//", 1)[-1].split("/", 1)[0]

    if re.search(r"(?<!\d)429(?!\d)", low) or "resource_exhausted" in low or "rate limit" in low:
        if re.search(r"limit:\s*0", low):
            return False, (f"Your key has no free quota for '{model}'. Pick a different model "
                           f"(or enable billing with {spec.label}).")
        return True, ""     # rate-limited ⇒ the key was accepted; don't block signup on a busy minute
    if (re.search(r"(?<!\d)401(?!\d)", low) or "invalid_api_key" in low or "incorrect api key" in low
            or "api key not valid" in low or "api_key_invalid" in low or "authentication" in low
            or "unauthorized" in low or "invalid x-api-key" in low):
        return False, f"{spec.label} rejected the API key — double-check it and try again."
    if re.search(r"(?<!\d)403(?!\d)", low) or "permission_denied" in low or "permission denied" in low:
        return False, f"This key isn't allowed to use '{model}'. Try another model."
    if re.search(r"(?<!\d)404(?!\d)", low) or "not found" in low or "does not exist" in low or "model_not_found" in low:
        return False, (f"Model '{model}' wasn't found on {spec.label}. Choose another model, "
                       f"or check the spelling if you typed a custom one.")
    if "timeout" in name or "timed out" in low:
        return False, f"Timed out waiting for {spec.label}{f' ({host})' if host else ''}. Check the URL and try again."
    if "connect" in name or "connection" in low or "getaddrinfo" in low or "name or service" in low:
        return False, f"Couldn't connect to {spec.label}{f' at {host}' if host else ''}. Check the base URL and your network."
    logger.warning(f"API key validation error ({spec.id}): {raw[:300]}")
    return False, f"{spec.label} returned an error: {raw[:200]}"


def _validate_ollama(base_url: str, model: str) -> Tuple[bool, str]:
    """Ollama has no key: just confirm it's running and the model has been pulled."""
    import json
    import urllib.error
    import urllib.request

    url = base_url.rstrip("/") + "/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:       # nosec - host restricted to loopback
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return False, (f"Couldn't reach Ollama at {base_url}. Is it running? Start it with `ollama serve`.")
    names = {m.get("name", "") for m in data.get("models", [])}
    if model not in names and f"{model}:latest" not in names:
        have = ", ".join(sorted(names)[:6]) or "none"
        return False, f"Ollama hasn't pulled '{model}'. Run `ollama pull {model}` first (installed: {have})."
    return True, ""


# Which request field a failed check is about, read from the message the check produced (the messages above and in
# _validate_ollama / resolve_base_url are the only ones it can return). None = about the combination as a whole.
_FAILURE_FIELDS = (
    ("api key", "api_key"),
    ("model", "llm_model"),                 # "...wasn't found", "...isn't allowed to use 'model'", "no free quota for 'model'"
    ("hasn't pulled", "llm_model"),         # Ollama
    ("base url", "llm_base_url"),
    ("couldn't connect", "llm_base_url"),
    ("couldn't reach", "llm_base_url"),
    ("timed out", "llm_base_url"),
)


def failure_field(message: str) -> Optional[str]:
    """The request field (api_key | llm_model | llm_base_url) a validate_api_key failure message refers to."""
    low = (message or "").lower()
    for needle, field in _FAILURE_FIELDS:
        if needle in low:
            return field
    return None


def validate_api_key(provider: str, api_key: str, model: str = None, base_url: str = None) -> Tuple[bool, str]:
    """
    Check the provider/key/model/base-URL combination with the cheapest possible call.
    Returns (ok: bool, error_message: str). The message is safe to show to the user.
    """
    spec = providers.get_provider(provider)
    if spec is None:
        return False, f"Unsupported provider '{(provider or '').strip()}'. Choose from: {', '.join(providers.provider_ids())}"

    try:
        model = providers.validate_model_id(model) or spec.default_model
    except ValueError as e:
        return False, str(e)
    if not model:
        return False, f"Enter a model name for {spec.label}."

    api_key = (api_key or "").strip()
    if spec.needs_key and not api_key:
        return False, "API key is required"

    try:
        base = providers.resolve_base_url(spec, base_url)
    except ValueError as e:
        return False, str(e)

    if spec.kind == "ollama":
        return _validate_ollama(base, model)

    try:
        from langchain_core.messages import HumanMessage
        from core_brains.llm_connection import _build_llm
        llm = _build_llm(
            provider=spec.id, api_key=api_key, model=model, base_url=base,
            temperature=0.0, max_tokens=_VALIDATE_MAX_TOKENS,
            timeout=_VALIDATE_TIMEOUT, sdk_retries=0,
        )
        llm.invoke([HumanMessage(content="Reply with the single word: ok")])
        return True, ""
    except ImportError as e:
        logger.error(f"Provider package not installed ({spec.id}): {e}")
        return False, f"The {spec.label} provider isn't installed on this server."
    except ValueError as e:
        return False, str(e)
    except Exception as e:
        return _explain_error(spec, model, base, e, api_key)
