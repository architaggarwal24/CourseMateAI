import os
import time
import logging

from contextvars import ContextVar
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


PROVIDER_USAGE_URLS = {
    "mistral": "https://console.mistral.ai/usage",
    "gemini":  "https://aistudio.google.com/app/usage",
    "openai":  "https://platform.openai.com/usage",
    "claude":  "https://console.anthropic.com/settings/plans",
}


class QuotaExceededError(Exception):
    """Raised when the provider returns a quota / billing / rate-limit error."""
    def __init__(self, provider: str = "your provider"):
        self.provider = provider
        self.usage_url = PROVIDER_USAGE_URLS.get(provider.lower(), "")
        super().__init__(
            f"API quota exceeded for {provider}. "
            f"You have hit your usage limit with this provider."
        )


def _is_quota_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(s in msg for s in [
        "429", "quota", "rate limit", "rate_limit", "too many requests",
        "resource_exhausted", "resource exhausted", "billing",
        "insufficient_quota", "exceeded your", "limit exceeded",
    ])

# BUG REMOVED: `from langchain_mistralai import ChatMistralAI` was here as a
# top-level import. This ran unconditionally at server startup for every user,
# regardless of their chosen provider. Combined with `_default_client = LLMClient()`
# below, it crashed the entire module on import if MISTRAL_API_KEY wasn't set.
# All provider imports are now lazy (inside _build_llm) so they only run when needed.


# ── Per-request context storage (coroutine-safe) ──────────────────────────────
# BUG REMOVED: defaults were "mistral". If set_request_key was ever skipped (a
# bug elsewhere), all non-Mistral requests would silently use Mistral defaults.
_ctx_api_key: ContextVar[str] = ContextVar("api_key", default="")
_ctx_provider: ContextVar[str] = ContextVar("provider", default="")
# FIX BUG 12: Correct the type annotation — default is None so the type must be Optional[str].
_ctx_model: ContextVar[str | None] = ContextVar("model", default=None)


def set_request_key(api_key: str, provider: str = "", model: str = None):
    """Call at the start of a request to bind this coroutine's LLM key."""
    _ctx_api_key.set(api_key or "")
    _ctx_provider.set(provider or "")
    _ctx_model.set(model)


def clear_request_key():
    """Reset context vars to defaults after the request completes."""
    _ctx_api_key.set("")
    _ctx_provider.set("")
    _ctx_model.set(None)


class LLMClient:
    """
    Centralized LLM client. Supports mistral, openai, gemini, claude.
    All provider imports are lazy — unused packages don't affect startup.
    """

    def __init__(
        self,
        model: str = None,
        temperature: float = 0.4,
        max_tokens: int = 2000,
        timeout: int = 60,
        max_retries: int = 3,
        api_key: str = None,
        provider: str = "mistral",
    ):
        self.max_retries = max_retries
        # BUG REMOVED: was `api_key or os.getenv("MISTRAL_API_KEY")`.
        # For OpenAI/Gemini/Claude users with a falsy api_key this injected the
        # Mistral env-var key into the wrong provider client → instant 401 errors.
        # Now we pass api_key as-is; a missing key surfaces as a clear auth error.
        self._provider = provider
        self.llm = _build_llm(
            provider=provider,
            api_key=api_key,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )

    def generate(self, messages) -> str:
        # FIX BUG 13: Guard against max_retries=0 — the loop would never run
        # and raise None would throw TypeError rather than a real exception.
        if self.max_retries <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc = None
        for attempt in range(self.max_retries):
            try:
                response = self.llm.invoke(messages)
                return response.content.strip()
            except Exception as e:
                last_exc = e
                # Quota/billing errors — raise immediately, no retry
                if _is_quota_error(e):
                    raise QuotaExceededError(provider=getattr(self, "_provider", "your provider"))
                if attempt < self.max_retries - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        f"LLM call failed (attempt {attempt + 1}/{self.max_retries}): {e}. "
                        f"Retrying in {wait}s..."
                    )
                    time.sleep(wait)
                else:
                    logger.error(f"LLM call failed after {self.max_retries} attempts: {e}")
        raise last_exc

    async def generate_async(self, messages) -> str:
        """
        Async version of generate() — retries use asyncio.sleep so the event
        loop is never blocked during back-off waits between LLM retries.
        """
        if self.max_retries <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc = None
        for attempt in range(self.max_retries):
            try:
                # Run the blocking SDK call in a thread-pool worker
                import asyncio as _aio
                response = await _aio.to_thread(self.llm.invoke, messages)
                return response.content.strip()
            except Exception as e:
                last_exc = e
                if _is_quota_error(e):
                    raise QuotaExceededError(provider=getattr(self, "_provider", "your provider"))
                if attempt < self.max_retries - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        f"Async LLM call failed (attempt {attempt + 1}/{self.max_retries}): {e}. "
                        f"Retrying in {wait}s..."
                    )
                    import asyncio as _aio2
                    await _aio2.sleep(wait)
                else:
                    logger.error(f"Async LLM call failed after {self.max_retries} attempts: {e}")
        raise last_exc


def _build_llm(provider: str, api_key: str, model: str = None,
               temperature: float = 0.4, max_tokens: int = 2000, timeout: int = 60):
    """
    Build the correct LangChain LLM based on provider.
    All imports are lazy — a missing package fails only when that provider is used.
    """
    provider = (provider or "mistral").lower()

    if provider == "mistral":
        from langchain_mistralai import ChatMistralAI
        return ChatMistralAI(
            api_key=api_key,
            model=model or "mistral-large-2512",
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )
    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            api_key=api_key,
            model=model or "gpt-4o-mini",
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            google_api_key=api_key,
            # BUG REMOVED: was "gemini-2.5-flash" but key_service validates with
            # "gemini-1.5-flash". Free-tier Gemini users validated OK then hit
            # 2.5-flash at runtime → 404 on every single LLM call.
            model=model or "gemini-1.5-flash",
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
    elif provider == "claude":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            api_key=api_key,
            model=model or "claude-sonnet-4-6",
            temperature=temperature,
            max_tokens=max_tokens,
        )
    else:
        raise ValueError(
            f"Unknown provider: '{provider}'. Supported: mistral, openai, gemini, claude"
        )


# BUG REMOVED: `_default_client = LLMClient()` used to live here.
# It instantiated a Mistral client at import time with no API key.
# If MISTRAL_API_KEY wasn't in .env this crashed the whole module on startup
# → every endpoint returned 500. It was also dead code: nothing called it.


def ask_llm(messages) -> str:
    """
    Uses the per-request user key (set via inject_user_llm_key dependency).
    Accepts a list of LangChain message objects (SystemMessage/HumanMessage/AIMessage).
    Raises ValueError if no key is configured.
    """
    key = _ctx_api_key.get()
    if key and key.strip():
        provider = _ctx_provider.get()
        model = _ctx_model.get()
        return ask_llm_with_key(messages, api_key=key, provider=provider, model=model)
    raise ValueError(
        "No API key configured. Please go to Settings → AI Provider and save your key."
    )


# Bounded LRU cache for LLMClient instances — max 64 entries.
# Old unbounded dict grew forever as users changed API keys; each stale entry
# held a live SDK connection object in memory indefinitely.
from collections import OrderedDict as _OrderedDict

_MAX_CLIENT_CACHE = 64
_client_cache: _OrderedDict = _OrderedDict()


def get_or_create_client(api_key: str, provider: str, model) -> "LLMClient":
    """Return a cached LLMClient for (provider, key prefix, model).
    Cache is bounded to _MAX_CLIENT_CACHE entries — oldest evicted first (LRU)."""
    cache_key = (provider, api_key[:8] if api_key else "", model)
    if cache_key in _client_cache:
        # Move to end (most-recently-used)
        _client_cache.move_to_end(cache_key)
        return _client_cache[cache_key]
    client = LLMClient(api_key=api_key, provider=provider, model=model)
    _client_cache[cache_key] = client
    if len(_client_cache) > _MAX_CLIENT_CACHE:
        _client_cache.popitem(last=False)  # evict oldest
    return client


def ask_llm_with_key(messages, api_key: str, provider: str = "mistral", model: str = None) -> str:
    """Per-request LLM call using the user's own API key and chosen model. Client is cached."""
    client = get_or_create_client(api_key, provider, model)
    return client.generate(messages)

import asyncio as _asyncio


async def ask_llm_async(messages) -> str:
    """Non-blocking wrapper — runs ask_llm() in a thread pool executor."""
    return await _asyncio.to_thread(ask_llm, messages)


async def ask_llm_with_key_async(messages, api_key: str, provider: str = "mistral", model: str = None) -> str:
    """Per-request async LLM call. Uses generate_async() so retries use asyncio.sleep."""
    client = get_or_create_client(api_key, provider, model)
    return await client.generate_async(messages)