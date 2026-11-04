"""What a model call costs (Phase 3 Stage 4b; docs/model-routing.md).

Prices are the operator's to set - providers change them - in MODEL_PRICES_JSON, US dollars per 1M tokens:

    MODEL_PRICES_JSON={"gemini:gemini-3.8-flash": [0.3, 2.5], "openai:gpt-5.4-nano": [0.05, 0.4], "claude:*": [1, 5]}

A key is "provider:model", or "provider:*" for every model of that provider. A model on this machine (Ollama, or the
LOCAL_LLM slot) costs nothing. Anything else without a price counts 0 and is reported as unpriced, so the totals
never pretend to be complete. Costs are kept in millionths of a dollar (integers); USD_TO_INR converts for reports.
"""
import json
import logging
import os
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)


def _prices() -> Dict[str, Tuple[float, float]]:
    raw = (os.environ.get("MODEL_PRICES_JSON") or "").strip()
    if not raw:
        return {}
    try:
        return {k.strip().lower(): (float(v[0]), float(v[1])) for k, v in json.loads(raw).items()}
    except (ValueError, TypeError, IndexError, AttributeError):
        logger.warning("MODEL_PRICES_JSON is not valid JSON ({\"provider:model\": [in, out]}); costs are unpriced")
        return {}


def is_local(provider: str, model: str) -> bool:
    if provider == "ollama":
        return True
    local = (os.environ.get("LOCAL_LLM") or "").strip().lower()
    return bool(local) and local == f"{provider}:{model}".lower()


def price(provider: str, model: str) -> Optional[Tuple[float, float]]:
    """(input, output) USD per 1M tokens, (0, 0) for a local model, None when unknown."""
    if is_local(provider, model):
        return (0.0, 0.0)
    p = _prices()
    return p.get(f"{provider}:{model}".lower()) or p.get(f"{provider}:*".lower())


def cost_micro_usd(provider: str, model: str, tokens_in: int, tokens_out: int) -> int:
    pr = price(provider, model)
    return 0 if not pr else round(tokens_in * pr[0] + tokens_out * pr[1])


def usd_to_inr() -> float:
    try:
        return float(os.environ.get("USD_TO_INR") or 0) or 0.0
    except ValueError:
        return 0.0

