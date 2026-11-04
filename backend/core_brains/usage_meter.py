"""Per-user AI usage metering (Phase 3 Stage 4a, model attribution and costs in 4b; docs/plans.md).

Every model call made while a request (or a background task it started) is being served is counted for that
request's user: one AI call per logical call (retries included), and the tokens of every model response (the
provider's `usage_metadata` when it sends one, else an estimate of ~4 characters per token) - each with the
provider and model that answered and the job it was for (core_brains/model_router.py), so the cost can be worked
out per model. A fallback from one model to the next is counted too.

The request sets who is being metered (`begin`, from deps.inject_user_llm_key); the LLM client reports what it
used. The numbers go to a sink the app installs at startup (state.py -> UsageService.record). With no meter set
(scripts, tests that call the client directly) nothing is recorded. A failing sink never breaks a model call.
"""
import logging
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Callable, Optional

from core_brains.model_router import current_job

logger = logging.getLogger(__name__)

CHARS_PER_TOKEN = 4


@dataclass(frozen=True)
class Meter:
    user_id: int
    byok: bool                      # the user's own provider key: metered, but outside the plan's AI quotas
    job: str = ""
    tier: str = ""                  # the user's plan: picks the models when the call runs on the server's AI


_meter: ContextVar[Optional[Meter]] = ContextVar("usage_meter", default=None)
_sink: Optional[Callable[..., None]] = None


def set_sink(fn: Optional[Callable[..., None]]) -> None:
    """fn(user_id, *, calls, tokens_in, tokens_out, byok, job, provider, model, fallbacks)."""
    global _sink
    _sink = fn


def begin(user_id, byok: bool, job: str = "", tier: str = "") -> None:
    _meter.set(Meter(int(user_id), bool(byok), job, tier))


def end() -> None:
    _meter.set(None)


def current() -> Optional[Meter]:
    return _meter.get()


def estimate_tokens(text) -> int:
    return (len(text or "") + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN


def _text_of(messages) -> str:
    out = []
    for m in messages or []:
        c = getattr(m, "content", m)
        out.append(c if isinstance(c, str) else str(c))
    return "\n".join(out)


def _emit(provider: str = "", model: str = "", **kw) -> None:
    m = _meter.get()
    if m is None or _sink is None:
        return
    kw.setdefault("calls", 0)
    kw.setdefault("tokens_in", 0)
    kw.setdefault("tokens_out", 0)
    kw.setdefault("fallbacks", 0)
    try:
        _sink(m.user_id, byok=m.byok, job=m.job or current_job(), provider=provider or "", model=model or "", **kw)
    except Exception as exc:                      # metering must never fail the call it measures
        logger.warning("usage metering failed: %s", type(exc).__name__)


def add_tokens(messages, response, provider: str = "", model: str = "") -> None:
    """One model response: its real token counts when the provider reports them, else an estimate."""
    if _meter.get() is None:
        return
    raw = response.get("raw") if isinstance(response, dict) else response
    usage = getattr(raw, "usage_metadata", None) or {}
    tin, tout = usage.get("input_tokens"), usage.get("output_tokens")
    if not isinstance(tin, int) or not isinstance(tout, int):
        content = getattr(raw, "content", None)
        if not content and isinstance(response, dict):
            content = str(response.get("parsed") or "")
        tin = estimate_tokens(_text_of(messages))
        tout = estimate_tokens(content if isinstance(content, str) else str(content or ""))
    _emit(provider, model, tokens_in=max(0, tin), tokens_out=max(0, tout))


def add_stream_tokens(messages, text: str, provider: str = "", model: str = "") -> None:
    if _meter.get() is None:
        return
    _emit(provider, model, tokens_in=estimate_tokens(_text_of(messages)), tokens_out=estimate_tokens(text))


def add_call(provider: str = "", model: str = "") -> None:
    """One logical AI call finished (success)."""
    _emit(provider, model, calls=1)


def add_fallback(provider: str = "", model: str = "") -> None:
    """A model failed (down, slow, refused) and the call moved on to the next one."""
    _emit(provider, model, fallbacks=1)


async def carry(gen, meter: Optional[Meter]):
    """Iterate an async generator with `meter` set: a streamed answer outlives the request's dependencies (which
    end the meter), so the stream sets it again for the rest of the answer."""
    from contextlib import aclosing
    if meter is not None:
        _meter.set(meter)
    async with aclosing(gen) as inner:          # closing this closes the model's stream too
        async for item in inner:
            yield item
