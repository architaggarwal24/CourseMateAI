import json
import os
import re
import time
import hashlib
import logging
import threading
import typing

from collections import OrderedDict as _OrderedDict
from contextlib import aclosing
from contextvars import ContextVar
from dotenv import load_dotenv

import providers
from core_brains.json_utils import extract_json
from core_brains.llm_schemas import wire_schema
from observability import observe_llm_call

load_dotenv()
logger = logging.getLogger(__name__)


# ── Errors the API layer knows how to turn into clean HTTP responses ──────────
class QuotaExceededError(Exception):
    """Raised when the provider returns a quota / billing / rate-limit error."""
    def __init__(self, provider: str = "your provider"):
        self.provider = provider
        self.usage_url = providers.usage_url(provider)
        super().__init__(
            f"API quota exceeded for {providers.provider_label(provider)}. "
            f"You have hit your usage limit with this provider."
        )


class InvalidApiKeyError(Exception):
    """Raised when the provider rejects the user's API key / model access."""
    def __init__(self, provider: str = "your provider"):
        self.provider = provider
        super().__init__(f"The API key for {providers.provider_label(provider)} was rejected.")


class ProviderUnreachableError(Exception):
    """Raised when we can't connect to the provider at all (down, wrong URL, Ollama not running)."""
    def __init__(self, provider: str = "your provider"):
        self.provider = provider
        super().__init__(f"Couldn't reach {providers.provider_label(provider)}.")


class EmptyModelResponse(RuntimeError):
    """The model answered with no text (typically a reasoning model that spent its whole
    token budget on hidden 'thinking')."""


class StructuredOutputError(ValueError):
    """The model answered, but not with anything that fits the requested schema."""


# "429" must be a standalone number (an HTTP status), not part of e.g. "1429 tokens".
_HTTP_429 = re.compile(r"(?<!\d)429(?!\d)")
_QUOTA_WORDS = (
    "quota", "rate limit", "rate_limit", "too many requests",
    "resource_exhausted", "resource exhausted", "billing",
    "insufficient_quota", "exceeded your", "limit exceeded",
)
_AUTH_WORDS = (
    "invalid api key", "invalid_api_key", "incorrect api key", "api key not valid",
    "api_key_invalid", "authentication_error", "unauthorized", "permission_denied",
    "invalid x-api-key",
)
_HTTP_401_403 = re.compile(r"(?<!\d)(401|403)(?!\d)")
_CONNECT_WORDS = (
    "connection error", "connecterror", "connection refused", "failed to connect",
    "name or service not known", "getaddrinfo", "temporary failure in name resolution",
    "timed out", "timeout", "connection reset",
)


def _is_quota_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return bool(_HTTP_429.search(msg)) or any(s in msg for s in _QUOTA_WORDS)


def _is_auth_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(s in msg for s in _AUTH_WORDS) or bool(_HTTP_401_403.search(msg))


def _is_connect_error(exc: Exception) -> bool:
    msg = f"{type(exc).__name__} {exc}".lower()
    return any(s in msg for s in _CONNECT_WORDS)


# A server that has no native structured output answers a response_format / response_schema / tool request with
# a client error (400/422, sometimes 404/501) or a message about it. Auth, quota and rate-limit errors are not that.
_REJECTION_STATUS = (400, 404, 405, 415, 422, 501)
_REJECTION_HINTS = (
    "response_format", "response_schema", "json_schema", "json schema", "structured output", "structured_output",
    "tool_choice", "tool choice", "tools are not supported", "does not support tool", "unsupported parameter",
    "unrecognized request argument", "extra inputs are not permitted", "unknown field", "not supported",
    "invalid schema",
)


def _rejects_structured_output(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if status in (401, 403, 429):
        return False
    if _is_quota_error(exc) or _is_auth_error(exc) or _is_connect_error(exc):
        return False
    if status in _REJECTION_STATUS:
        return True
    msg = str(exc).lower()
    return any(h in msg for h in _REJECTION_HINTS)


# ── Per-request context storage (coroutine-safe) ──────────────────────────────
_ctx_api_key: ContextVar[str] = ContextVar("api_key", default="")
_ctx_provider: ContextVar[str] = ContextVar("provider", default="")
_ctx_model: ContextVar[str | None] = ContextVar("model", default=None)
_ctx_base_url: ContextVar[str | None] = ContextVar("base_url", default=None)


def set_request_key(api_key: str, provider: str = "", model: str = None, base_url: str = None):
    """Call at the start of a request to bind this coroutine's LLM settings."""
    _ctx_api_key.set(api_key or "")
    _ctx_provider.set(provider or "")
    _ctx_model.set(model)
    _ctx_base_url.set(base_url)


def clear_request_key():
    """Reset context vars to defaults after the request completes."""
    _ctx_api_key.set("")
    _ctx_provider.set("")
    _ctx_model.set(None)
    _ctx_base_url.set(None)


# ── Response cleanup ──────────────────────────────────────────────────────────
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _content_to_text(content) -> str:
    """Normalise a LangChain message `.content` to plain text.

    Gemini 3.x and Claude return a LIST of content blocks (text, thinking, signatures…)
    rather than a string, so `content.strip()` crashed. Only text blocks are kept.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") in (None, "text"):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content)


def _strip_reasoning(text: str) -> str:
    """Remove <think>…</think> chain-of-thought that some open models inline in the answer
    (it would otherwise break JSON parsing for quizzes/flashcards)."""
    text = _THINK_BLOCK.sub("", text)
    if "</think>" in text.lower() and "<think>" not in text.lower():
        # Some servers strip the opening tag but leave the closing one.
        text = re.split(r"</think>", text, maxsplit=1, flags=re.IGNORECASE)[1]
    return text.strip()


def _postprocess(content) -> str:
    return _strip_reasoning(_content_to_text(content))


class _ThinkFilter:
    """Streaming version of _strip_reasoning: drops <think>…</think> blocks from a token stream, including
    when a tag is split across two chunks ("<th" + "ink>"). Leading whitespace is dropped, like .strip()."""
    _OPEN, _CLOSE = "<think>", "</think>"

    def __init__(self):
        self._buf = ""
        self._inside = False
        self._started = False            # has visible text been emitted yet?

    @staticmethod
    def _partial_tag_len(low: str, tag: str) -> int:
        """Length of the longest proper prefix of `tag` that `low` ends with (a tag that may be completed next)."""
        for n in range(min(len(tag) - 1, len(low)), 0, -1):
            if low.endswith(tag[:n]):
                return n
        return 0

    def feed(self, text: str) -> str:
        self._buf += text
        out = []
        while True:
            low = self._buf.lower()
            tag = self._CLOSE if self._inside else self._OPEN
            i = low.find(tag)
            if i >= 0:
                if not self._inside:
                    out.append(self._buf[:i])
                self._buf = self._buf[i + len(tag):]
                self._inside = not self._inside
                continue
            keep = self._partial_tag_len(low, tag)
            if not self._inside:
                out.append(self._buf[:len(self._buf) - keep])      # inside reasoning, text is simply discarded
            self._buf = self._buf[len(self._buf) - keep:] if keep else ""
            break
        return self._emit("".join(out))

    def flush(self) -> str:
        rest = "" if self._inside else self._buf                   # an unfinished "<thi" was ordinary text
        self._buf = ""
        return self._emit(rest)

    def _emit(self, text: str) -> str:
        if not self._started:
            text = text.lstrip()
            self._started = bool(text)
        return text


# ── Provider → LangChain model ────────────────────────────────────────────────
# Reasoning models count hidden "thinking" tokens against the output budget. With the
# app's usual 2000-token cap they could burn the whole budget and return nothing, so
# these providers get a larger floor.
# Reasoning models (Nemotron, DeepSeek-R1, Qwen3...) spend part of this budget "thinking" before the JSON starts;
# 4096 cut boss/quiz answers off mid-object (LengthFinishReasonError).
_MIN_OUTPUT_TOKENS = {"gemini": 8192, "openai_compat": 8192, "ollama": 4096}

def _is_truncated(exc: BaseException) -> bool:
    """The model hit its output-token limit (openai's LengthFinishReasonError, or a finish_reason of "length").
    Asking again with the same budget gets cut off the same way, so this is not retried."""
    return type(exc).__name__ == "LengthFinishReasonError" or "finish_reason='length'" in str(exc) \
        or 'finish_reason": "length"' in str(exc)


_NO_TEMPERATURE = re.compile(r"^(gpt-5|o\d)", re.IGNORECASE)


def _accepts_temperature(model: str) -> bool:
    """OpenAI's gpt-5 / o-series reasoning models reject a custom temperature. Match on the
    name after any vendor prefix ("openai/gpt-5.4-nano" via a gateway, too)."""
    return not _NO_TEMPERATURE.match((model or "").rsplit("/", 1)[-1])


def _build_llm(provider: str, api_key: str, model: str = None, base_url: str = None,
               temperature: float = 0.4, max_tokens: int = 2000, timeout: int = 60,
               sdk_retries: int = 2):
    """
    Build the correct LangChain chat model for a provider.
    All provider imports are lazy — a missing package fails only when that provider is used.
    """
    spec = providers.get_provider(provider)
    if spec is None:
        raise ValueError(
            f"Unknown or disabled provider: '{provider}'. Supported: {', '.join(providers.provider_ids())}"
        )
    model = (model or spec.default_model or "").strip()
    if not model:
        raise ValueError(f"No model selected for {spec.label}. Enter a model name.")

    kind = spec.kind

    if kind == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            google_api_key=api_key,
            model=model,
            temperature=temperature,
            max_output_tokens=max(max_tokens, _MIN_OUTPUT_TOKENS["gemini"]),
            timeout=timeout,
            max_retries=sdk_retries,
        )

    if kind == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            api_key=api_key,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
            max_retries=sdk_retries,
        )

    if kind == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            api_key=api_key,
            model=model,
            # langchain-openai also drops this itself for gpt-5/o-series; explicit is safer.
            temperature=temperature if _accepts_temperature(model) else None,
            max_tokens=max_tokens,          # sent as max_completion_tokens (required by gpt-5)
            timeout=timeout,
            max_retries=sdk_retries,
        )

    if kind in ("openai_compat", "ollama"):
        from langchain_openai import ChatOpenAI
        base = providers.resolve_base_url(spec, base_url)      # re-checks the SSRF rules
        if kind == "ollama":
            base = base.rstrip("/") + "/v1"                     # Ollama's OpenAI-compatible route
        return ChatOpenAI(
            api_key=api_key if (api_key and api_key != providers.NO_KEY_PLACEHOLDER) else "none",
            base_url=base,
            model=model,
            temperature=temperature if _accepts_temperature(model) else None,
            timeout=timeout,
            max_retries=sdk_retries,
            # langchain-openai always renames max_tokens → max_completion_tokens, which many
            # OpenAI-compatible servers (NVIDIA NIM, Ollama, most gateways) ignore or reject.
            # extra_body is merged into the JSON as-is, so the classic `max_tokens` reaches them.
            extra_body={"max_tokens": max(max_tokens, _MIN_OUTPUT_TOKENS[kind])},
        )

    raise ValueError(f"Provider '{provider}' has no client implementation")


class LLMClient:
    """
    Centralized LLM client for every provider in providers.py.
    """

    def __init__(
        self,
        model: str = None,
        temperature: float = 0.4,
        max_tokens: int = 2000,
        timeout: int = 60,
        max_retries: int = 3,
        api_key: str = None,
        provider: str = "gemini",
        base_url: str = None,
    ):
        self.max_retries = max_retries
        self._provider = provider
        spec = providers.get_provider(provider)
        self._model_name = model or (spec.default_model if spec else "") or ""   # for logs only
        self._structured_unsupported = False      # set once the server rejects native structured output
        self.llm = _build_llm(
            provider=provider,
            api_key=api_key,
            model=model,
            base_url=base_url,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )

    # -- shared error handling ------------------------------------------------
    def _classify(self, exc: Exception):
        """Return an exception to raise immediately (no retry), or None to retry."""
        if _is_quota_error(exc):
            return QuotaExceededError(provider=self._provider)
        if _is_auth_error(exc):
            return InvalidApiKeyError(provider=self._provider)
        return None

    def _final(self, exc: Exception) -> Exception:
        """What to raise once retries are exhausted."""
        if _is_connect_error(exc):
            return ProviderUnreachableError(provider=self._provider)
        return exc

    def _observed(self, operation: str):
        """Metrics + the single "LLM call failed" log line for one logical call (see observability.metrics)."""
        return observe_llm_call(getattr(self, "_provider", ""), getattr(self, "_model_name", ""), operation)

    def generate(self, messages) -> str:
        with self._observed("generate"):
            return self._generate(messages)

    def _generate(self, messages) -> str:
        if self.max_retries <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc = None
        for attempt in range(self.max_retries):
            try:
                response = self.llm.invoke(messages)
                text = _postprocess(response.content)
                if not text:
                    raise EmptyModelResponse(
                        "The model returned an empty answer (it may have used its whole token "
                        "budget thinking). Try a different model."
                    )
                return text
            except Exception as e:
                last_exc = e
                fatal = self._classify(e)
                if fatal:
                    raise fatal
                if attempt < self.max_retries - 1:
                    wait = 2 ** attempt
                    logger.debug("LLM call failed (attempt %d/%d): %s. Retrying in %ds", attempt + 1, self.max_retries, type(e).__name__, wait)
                    time.sleep(wait)
        raise self._final(last_exc)

    async def generate_async(self, messages, max_attempts: int = None) -> str:
        """Async version — uses ainvoke() so the event loop is never blocked.
        `max_attempts` overrides the client's retry count (1 = a single try, no backoff sleeps)."""
        with self._observed("generate"):
            return await self._generate_async(messages, max_attempts)

    async def _generate_async(self, messages, max_attempts: int = None) -> str:
        import asyncio as _aio
        attempts = max_attempts or self.max_retries
        if attempts <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc = None
        for attempt in range(attempts):
            try:
                response = await self.llm.ainvoke(messages)
                text = _postprocess(response.content)
                if not text:
                    raise EmptyModelResponse(
                        "The model returned an empty answer (it may have used its whole token "
                        "budget thinking). Try a different model."
                    )
                return text
            except Exception as e:
                last_exc = e
                fatal = self._classify(e)
                if fatal:
                    raise fatal
                if attempt < attempts - 1:
                    wait = 2 ** attempt
                    logger.debug("Async LLM call failed (attempt %d/%d): %s. Retrying in %ds", attempt + 1, attempts, type(e).__name__, wait)
                    await _aio.sleep(wait)
        raise self._final(last_exc)

    # -- structured output ----------------------------------------------------
    @property
    def kind(self) -> str:
        spec = providers.get_provider(self._provider)
        return spec.kind if spec else ""

    def _bind_structured(self, wire: dict):
        """The model bound to the provider's native structured output, returning {raw, parsed, parsing_error}.
        Gemini: response schema. OpenAI and OpenAI-compatible / Ollama: response_format json_schema.
        Anthropic: a forced tool call whose input is the answer."""
        method = "function_calling" if self.kind == "anthropic" else "json_schema"
        return self.llm.with_structured_output(wire, method=method, include_raw=True)

    @staticmethod
    def _fallback_messages(messages, wire: dict) -> list:
        """Plain-text request for servers without native structured output: the schema goes into the prompt."""
        from langchain_core.messages import HumanMessage
        return list(messages) + [HumanMessage(content=(
            "Reply with ONLY one JSON document (no prose, no markdown fences) that matches this JSON Schema:\n"
            + json.dumps(wire)))]

    @staticmethod
    def _validate(schema, data, context):
        if isinstance(data, list):                     # a bare array where the schema is {"<field>": [...]}
            lists = [n for n, f in schema.model_fields.items() if typing.get_origin(f.annotation) is list]
            if len(lists) == 1:
                data = {lists[0]: data}
        if not isinstance(data, dict):
            raise StructuredOutputError("The model's answer was not a JSON object.")
        try:
            return schema.model_validate(data, context=context)
        except ValueError as exc:                      # pydantic.ValidationError
            raise StructuredOutputError(f"The model's answer did not match the schema: {str(exc)[:300]}") from exc

    def _read_structured(self, result, schema, context):
        """Native result -> validated model. parsed -> tool-call arguments -> JSON salvaged from the raw text."""
        raw = result.get("raw") if isinstance(result, dict) else None
        parsed = result.get("parsed") if isinstance(result, dict) else result
        if parsed is not None and not (isinstance(parsed, (dict, list)) and not parsed):
            try:
                return self._validate(schema, parsed.model_dump() if hasattr(parsed, "model_dump") else parsed, context)
            except StructuredOutputError as first:
                err = first
        else:
            err = StructuredOutputError("The model returned no structured answer.")
        for call in (getattr(raw, "tool_calls", None) or []):
            args = call.get("args") if isinstance(call, dict) else None
            if args:
                return self._validate(schema, args, context)
        data = extract_json(_postprocess(getattr(raw, "content", "")))
        if data is not None:
            return self._validate(schema, data, context)
        raise err

    def _read_text(self, text: str, schema, context):
        if not text:
            raise EmptyModelResponse("The model returned an empty answer. Try a different model.")
        data = extract_json(text)
        if data is None:
            raise StructuredOutputError("The model's answer contained no JSON.")
        return self._validate(schema, data, context)

    def _structured_attempt(self, messages, schema, context):
        wire = wire_schema(schema)
        if not self._structured_unsupported:
            try:
                return self._read_structured(self._bind_structured(wire).invoke(messages), schema, context)
            except StructuredOutputError:
                raise
            except Exception as exc:
                if not _rejects_structured_output(exc):
                    raise
                logger.warning("%s rejected native structured output (%s); using prompted JSON from now on",
                               self._provider, type(exc).__name__)
                self._structured_unsupported = True
        response = self.llm.invoke(self._fallback_messages(messages, wire))
        return self._read_text(_postprocess(response.content), schema, context)

    async def _structured_attempt_async(self, messages, schema, context):
        wire = wire_schema(schema)
        if not self._structured_unsupported:
            try:
                return self._read_structured(await self._bind_structured(wire).ainvoke(messages), schema, context)
            except StructuredOutputError:
                raise
            except Exception as exc:
                if not _rejects_structured_output(exc):
                    raise
                logger.warning("%s rejected native structured output (%s); using prompted JSON from now on",
                               self._provider, type(exc).__name__)
                self._structured_unsupported = True
        response = await self.llm.ainvoke(self._fallback_messages(messages, wire))
        return self._read_text(_postprocess(response.content), schema, context)

    def generate_structured(self, messages, schema, *, context: dict = None, max_attempts: int = None):
        """Ask for an answer shaped like the Pydantic model `schema` and return a validated instance.

        Provider errors are retried with backoff exactly like generate(); an answer that does not fit the schema is
        asked for once more, then StructuredOutputError is raised."""
        with self._observed("structured"):
            return self._generate_structured(messages, schema, context=context, max_attempts=max_attempts)

    def _generate_structured(self, messages, schema, *, context: dict = None, max_attempts: int = None):
        attempts = max_attempts or self.max_retries
        if attempts <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc, bad_answers = None, 0
        for attempt in range(attempts):
            try:
                return self._structured_attempt(messages, schema, context)
            except StructuredOutputError as e:
                last_exc, bad_answers = e, bad_answers + 1
                logger.warning("structured answer rejected (%d/%d)", attempt + 1, attempts)
                if bad_answers >= 2:
                    break
            except Exception as e:
                last_exc = e
                fatal = self._classify(e)
                if fatal:
                    raise fatal
                if _is_truncated(e):
                    raise StructuredOutputError("The model's answer was cut off (output token limit).") from e
                if attempt < attempts - 1:
                    time.sleep(2 ** attempt)
        raise self._final(last_exc)

    async def generate_structured_async(self, messages, schema, *, context: dict = None, max_attempts: int = None):
        with self._observed("structured"):
            return await self._generate_structured_async(messages, schema, context=context, max_attempts=max_attempts)

    async def _generate_structured_async(self, messages, schema, *, context: dict = None, max_attempts: int = None):
        import asyncio as _aio
        attempts = max_attempts or self.max_retries
        if attempts <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc, bad_answers = None, 0
        for attempt in range(attempts):
            try:
                return await self._structured_attempt_async(messages, schema, context)
            except StructuredOutputError as e:
                last_exc, bad_answers = e, bad_answers + 1
                logger.warning("structured answer rejected (%d/%d)", attempt + 1, attempts)
                if bad_answers >= 2:
                    break
            except Exception as e:
                last_exc = e
                fatal = self._classify(e)
                if fatal:
                    raise fatal
                if _is_truncated(e):
                    raise StructuredOutputError("The model's answer was cut off (output token limit).") from e
                if attempt < attempts - 1:
                    await _aio.sleep(2 ** attempt)
        raise self._final(last_exc)

    async def stream_async(self, messages):
        """Yield the answer as text pieces as the model produces them (astream, so the loop is never blocked).

        Errors are classified exactly like generate_async. A failure BEFORE the first piece is retried (the caller
        has seen nothing yet); once a piece has been yielded it cannot be taken back, so a later failure is raised
        as it is (quota / auth / unreachable mapped to the same exceptions)."""
        with self._observed("stream"):
            # aclosing: when the consumer stops early the inner generator (and with it the provider's stream)
            # is closed at once, not whenever it is garbage collected.
            async with aclosing(self._stream_async(messages)) as pieces:
                async for piece in pieces:
                    yield piece

    async def _stream_async(self, messages):
        import asyncio as _aio
        if self.max_retries <= 0:
            raise RuntimeError("LLMClient.max_retries must be >= 1")
        last_exc = None
        for attempt in range(self.max_retries):
            emitted = False
            think = _ThinkFilter()
            try:
                # aclosing: if the consumer stops early (client disconnected) the provider's own stream is closed
                # right away instead of waiting for garbage collection, which would keep the connection open.
                async with aclosing(self.llm.astream(messages)) as stream:
                    async for chunk in stream:
                        piece = think.feed(_content_to_text(chunk.content))
                        if piece:
                            emitted = True
                            yield piece
                tail = think.flush()
                if tail:
                    emitted = True
                    yield tail
                if not emitted:
                    raise EmptyModelResponse(
                        "The model returned an empty answer (it may have used its whole token "
                        "budget thinking). Try a different model."
                    )
                return
            except Exception as e:
                last_exc = e
                fatal = self._classify(e)
                if fatal:
                    raise fatal
                if emitted:
                    raise self._final(e)
                if attempt < self.max_retries - 1:
                    wait = 2 ** attempt
                    logger.debug("LLM stream failed before any output (attempt %d/%d): %s. Retrying in %ds", attempt + 1, self.max_retries, type(e).__name__, wait)
                    await _aio.sleep(wait)
        raise self._final(last_exc)


def ask_llm(messages) -> str:
    """
    Uses the per-request user settings (set via the inject_user_llm_key dependency).
    Accepts a list of LangChain message objects (SystemMessage/HumanMessage/AIMessage).
    Raises ValueError if no key is configured.
    """
    key = _ctx_api_key.get()
    if key and key.strip():
        return ask_llm_with_key(
            messages, api_key=key, provider=_ctx_provider.get(),
            model=_ctx_model.get(), base_url=_ctx_base_url.get(),
        )
    raise ValueError(
        "No API key configured. Please go to Settings → AI Provider and save your key."
    )


# Bounded LRU cache for LLMClient instances — max 64 entries.
_MAX_CLIENT_CACHE = 64
_client_cache: _OrderedDict = _OrderedDict()
_client_cache_lock = threading.Lock()


def _client_cache_key(api_key: str, provider: str, model, base_url=None) -> tuple:
    """Cache key for an LLM client.

    SECURITY: this used to be (provider, api_key[:8], model). The first 8 characters of a
    key are a fixed vendor prefix ("sk-proj-", "sk-ant-a"), so two different users collided
    and the second user's requests were sent – and billed – on the FIRST user's key.
    We hash the whole key; the raw key is never used as a dict key. The base URL is part
    of the key too, so the same key pointed at two servers never shares a client.
    """
    digest = hashlib.sha256((api_key or "").encode("utf-8")).hexdigest()
    return (provider, digest, model, base_url or "")


def get_or_create_client(api_key: str, provider: str, model, base_url: str = None) -> "LLMClient":
    """Return a cached LLMClient for (provider, sha256(key), model, base_url).
    Bounded to _MAX_CLIENT_CACHE entries – least-recently-used evicted first."""
    cache_key = _client_cache_key(api_key, provider, model, base_url)
    with _client_cache_lock:
        if cache_key in _client_cache:
            _client_cache.move_to_end(cache_key)
            return _client_cache[cache_key]
    client = LLMClient(api_key=api_key, provider=provider, model=model, base_url=base_url)
    with _client_cache_lock:
        _client_cache[cache_key] = client
        _client_cache.move_to_end(cache_key)
        while len(_client_cache) > _MAX_CLIENT_CACHE:
            _client_cache.popitem(last=False)
    return client


def ask_llm_with_key(messages, api_key: str, provider: str = "gemini", model: str = None,
                     base_url: str = None) -> str:
    """Per-request LLM call using the user's own key, model and (optional) base URL."""
    client = get_or_create_client(api_key, provider, model, base_url)
    return client.generate(messages)


import asyncio as _asyncio


async def ask_llm_async(messages) -> str:
    """Non-blocking wrapper — runs ask_llm() in a thread pool executor."""
    return await _asyncio.to_thread(ask_llm, messages)


def snapshot_request_llm() -> dict:
    """The current request's LLM settings as plain values. A streaming response outlives the request's
    dependencies, so the generator must carry these explicitly instead of reading the context variables later.
    Raises ValueError if no key is configured (same as ask_llm)."""
    key = _ctx_api_key.get()
    if not (key and key.strip()):
        raise ValueError("No API key configured. Please go to Settings → AI Provider and save your key.")
    return {"api_key": key, "provider": _ctx_provider.get(), "model": _ctx_model.get(), "base_url": _ctx_base_url.get()}


def generate_structured(messages, schema, *, context: dict = None):
    """Structured answer with the current request's LLM settings (see LLMClient.generate_structured)."""
    s = snapshot_request_llm()
    client = get_or_create_client(s["api_key"], s["provider"], s["model"], s["base_url"])
    return client.generate_structured(messages, schema, context=context)


async def generate_structured_async(messages, schema, *, context: dict = None, max_attempts: int = None):
    """Async version: the event loop is never blocked (client creation may do a DNS lookup, so it runs in a thread).
    `max_attempts=1`: a single try (a caller with its own fallback should not sit through retries)."""
    s = snapshot_request_llm()
    client = await _asyncio.to_thread(get_or_create_client, s["api_key"], s["provider"], s["model"], s["base_url"])
    return await client.generate_structured_async(messages, schema, context=context, max_attempts=max_attempts)


def request_model_id() -> str:
    """Which model the current request will use, e.g. "gemini:gemini-2.5-flash" (the provider's default model when
    the user picked none, and the server for self-hosted providers) - part of the generated-content cache key."""
    provider, model, base_url = _ctx_provider.get(), _ctx_model.get(), _ctx_base_url.get()
    spec = providers.get_provider(provider)
    model = (model or (spec.default_model if spec else "") or "").strip()
    return f"{provider}:{model}" + (f"@{base_url}" if base_url else "")


async def ask_llm_quick_async(messages) -> str:
    """One short call with the request's settings: a single attempt, no retry sleeps. For small helper calls
    (e.g. rewriting a follow-up question) that have a fallback and must never slow the answer down."""
    s = snapshot_request_llm()
    client = await _asyncio.to_thread(get_or_create_client, s["api_key"], s["provider"], s["model"], s["base_url"])
    return await client.generate_async(messages, max_attempts=1)


async def stream_llm_with_key(messages, api_key: str, provider: str = "gemini", model: str = None,
                              base_url: str = None):
    """Per-request streaming call: yields text pieces (see LLMClient.stream_async)."""
    client = await _asyncio.to_thread(get_or_create_client, api_key, provider, model, base_url)
    async for piece in client.stream_async(messages):
        yield piece


async def ask_llm_with_key_async(messages, api_key: str, provider: str = "gemini", model: str = None,
                                 base_url: str = None) -> str:
    """Per-request async LLM call. Uses generate_async() so retries use asyncio.sleep."""
    # Building a client can do a DNS lookup (base-URL safety check) → keep it off the loop.
    client = await _asyncio.to_thread(get_or_create_client, api_key, provider, model, base_url)
    return await client.generate_async(messages)
