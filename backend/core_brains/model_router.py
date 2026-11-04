"""Which model answers which AI job, per plan (Phase 3 Stage 4b; docs/model-routing.md).

Only for accounts on the server's own AI. A user who saved their own provider key always gets their own model.

Jobs
    small    flavour and helper calls: boss dialogue, rewriting a follow-up question. Cheap or local first.
    strong   everything a student reads as an answer: chat, quizzes, flashcards, notes, exams, battles, maps.

Slots (env; each "provider:model", the model part optional = that provider's default model)
    LLM_FAST       a cheap API model                    default: the first server key's provider, its default model
    LLM_STRONG     the model for questions and answers  default: LLM_FAST
    LLM_PREMIUM    the strongest, for Archmage           default: LLM_STRONG
    LOCAL_LLM      a model on this machine, e.g. "ollama:qwen3:8b" or "openai-compatible:llama-3.1-8b"
                   LOCAL_LLM_BASE_URL (default http://localhost:11434 for ollama), LOCAL_LLM_TIMEOUT (s, default 25)

Routes: per tier and job, an ordered list of slots; the first that is configured answers, the next ones are the
fallbacks (a local model that is down or slow, a provider that refuses). MODEL_ROUTES_JSON overrides any of it,
e.g. {"apprentice": {"strong": ["local", "fast"]}}. A slot's API key comes from the server's environment
(GOOGLE_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY); a slot whose provider has no key is skipped.
"""
import json
import logging
import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

JOBS = ("small", "strong")
SLOTS = ("local", "fast", "strong", "premium")
NO_KEY = "no-key-required"          # providers.NO_KEY_PLACEHOLDER (kept here so this module stays a leaf)

ROUTES: Dict[str, Dict[str, List[str]]] = {
    "apprentice": {"small": ["local", "fast"], "strong": ["fast", "strong"]},
    "scholar":    {"small": ["local", "fast"], "strong": ["strong", "fast"]},
    "sage":       {"small": ["local", "fast"], "strong": ["strong", "fast"]},
    "archmage":   {"small": ["fast", "local"], "strong": ["premium", "strong", "fast"]},
}

_job: ContextVar[str] = ContextVar("llm_job", default="strong")


@contextmanager
def llm_job(job: str):
    """Mark the model calls inside as `job` ("small" or "strong")."""
    token = _job.set(job if job in JOBS else "strong")
    try:
        yield
    finally:
        _job.reset(token)


def current_job() -> str:
    return _job.get()


@dataclass(frozen=True)
class Target:
    slot: str
    provider: str
    api_key: str
    model: Optional[str]
    base_url: Optional[str]
    trusted: bool = False                 # set by the server's own config: the base URL needs no SSRF check
    timeout: Optional[float] = None       # per call; a slow local model falls through to the next target

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model or 'default'}"


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _split(spec: str) -> Tuple[str, Optional[str]]:
    provider, _, model = spec.partition(":")          # only the first ":" (ollama models have one: "qwen3:8b")
    return provider.strip().lower(), (model.strip() or None)


def routes() -> Dict[str, Dict[str, List[str]]]:
    out = {t: {j: list(v) for j, v in r.items()} for t, r in ROUTES.items()}
    raw = _env("MODEL_ROUTES_JSON")
    if raw:
        try:
            for tier, jobs in (json.loads(raw) or {}).items():
                for job, slots in (jobs or {}).items():
                    if tier in out and job in JOBS and isinstance(slots, list):
                        out[tier][job] = [s for s in slots if s in SLOTS]
        except (ValueError, AttributeError, TypeError):
            logger.warning("MODEL_ROUTES_JSON is not valid JSON; using the built-in routes")
    return out


def slot_target(slot: str, server_keys: Sequence[Tuple[str, str]]) -> Optional[Target]:
    """The model a slot names, with its key - or None when it isn't configured (or its provider has no key)."""
    keys = dict(server_keys)
    if slot == "local":
        spec = _env("LOCAL_LLM")
        if not spec:
            return None
        provider, model = _split(spec)
        base = _env("LOCAL_LLM_BASE_URL") or ("http://localhost:11434" if provider == "ollama" else "")
        if provider not in ("ollama", "openai-compatible") or not base:
            logger.warning("LOCAL_LLM must be ollama:<model> or openai-compatible:<model> (with LOCAL_LLM_BASE_URL)")
            return None
        try:
            timeout = float(_env("LOCAL_LLM_TIMEOUT") or 25)
        except ValueError:
            timeout = 25.0
        return Target("local", provider, keys.get(provider) or NO_KEY, model, base, trusted=True, timeout=timeout)
    names = {"fast": ["LLM_FAST"], "strong": ["LLM_STRONG", "LLM_FAST"], "premium": ["LLM_PREMIUM", "LLM_STRONG", "LLM_FAST"]}[slot]
    spec = next((_env(n) for n in names if _env(n)), "")
    if spec:
        provider, model = _split(spec)
    elif server_keys:
        provider, model = server_keys[0][0], None       # no slots set: the first server key, its default model
    else:
        return None
    key = keys.get(provider)
    if not key:
        logger.warning("%s names %s, but the server has no key for it", names[0], provider)
        return None
    return Target(slot, provider, key, model, None)


def plan(job: str, tier: str, server_keys: Sequence[Tuple[str, str]]) -> List[Target]:
    """The targets for one call, best first, each (provider, model, server) at most once."""
    order = routes().get(tier, ROUTES["apprentice"]).get(job if job in JOBS else "strong", [])
    out, seen = [], set()
    for slot in order:
        t = slot_target(slot, server_keys)
        if t and (t.provider, t.model, t.base_url) not in seen:
            seen.add((t.provider, t.model, t.base_url))
            out.append(t)
    return out
