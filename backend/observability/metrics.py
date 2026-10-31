"""Per-provider LLM metrics: how many calls, how long they took, how they failed.

In-process counters (no extra dependency) rendered in the Prometheus text format by GET /metrics.
The endpoint only exists when METRICS_ENABLED=true. Labels are low-cardinality on purpose: the provider id
(from the registry; anything else is "unknown") and a fixed set of error classes - never a model name, a
user, a key or any text.
"""
import logging
import threading
import time
from contextlib import contextmanager
from typing import Dict, Optional, Tuple

import providers

logger = logging.getLogger("coursemate.llm")

BUCKETS = (0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120)

# class name -> error class label. Anything else is "other".
_ERROR_CLASSES = {
    "QuotaExceededError": "quota",
    "InvalidApiKeyError": "auth",
    "ProviderUnreachableError": "unreachable",
    "EmptyModelResponse": "empty_response",
    "StructuredOutputError": "bad_output",
}


def error_class(exc: BaseException) -> str:
    for cls in type(exc).__mro__:
        if cls.__name__ in _ERROR_CLASSES:
            return _ERROR_CLASSES[cls.__name__]
    return "other"


def provider_label(provider: Optional[str]) -> str:
    return provider if provider and providers.get_provider(provider) else "unknown"


class LLMMetrics:
    def __init__(self):
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self._calls: Dict[Tuple[str, str], int] = {}                 # (provider, ok|error)
            self._errors: Dict[Tuple[str, str], int] = {}                # (provider, error class)
            self._latency: Dict[Tuple[str, str], list] = {}              # (provider, ok|error) -> [bucket counts..., count, sum]

    def record(self, provider: str, seconds: float, failure: Optional[str]) -> None:
        status = "error" if failure else "ok"
        with self._lock:
            self._calls[(provider, status)] = self._calls.get((provider, status), 0) + 1
            if failure:
                self._errors[(provider, failure)] = self._errors.get((provider, failure), 0) + 1
            h = self._latency.setdefault((provider, status), [0] * len(BUCKETS) + [0, 0.0])
            for i, upper in enumerate(BUCKETS):
                if seconds <= upper:
                    h[i] += 1
            h[-2] += 1
            h[-1] += seconds

    def snapshot(self) -> dict:
        with self._lock:
            return {"calls": dict(self._calls), "errors": dict(self._errors),
                    "latency": {k: list(v) for k, v in self._latency.items()}}

    def render(self) -> str:
        s = self.snapshot()
        out = ["# HELP coursemate_llm_calls_total LLM calls by provider and outcome.",
               "# TYPE coursemate_llm_calls_total counter"]
        out += [f'coursemate_llm_calls_total{{provider="{p}",status="{st}"}} {n}' for (p, st), n in sorted(s["calls"].items())]
        out += ["# HELP coursemate_llm_errors_total Failed LLM calls by provider and error class.",
                "# TYPE coursemate_llm_errors_total counter"]
        out += [f'coursemate_llm_errors_total{{provider="{p}",error_class="{c}"}} {n}' for (p, c), n in sorted(s["errors"].items())]
        out += ["# HELP coursemate_llm_call_duration_seconds LLM call duration (retries included).",
                "# TYPE coursemate_llm_call_duration_seconds histogram"]
        for (p, st), h in sorted(s["latency"].items()):
            labels = f'provider="{p}",status="{st}"'
            out += [f'coursemate_llm_call_duration_seconds_bucket{{{labels},le="{upper}"}} {h[i]}' for i, upper in enumerate(BUCKETS)]
            out += [f'coursemate_llm_call_duration_seconds_bucket{{{labels},le="+Inf"}} {h[-2]}',
                    f'coursemate_llm_call_duration_seconds_sum{{{labels}}} {h[-1]:.6f}',
                    f'coursemate_llm_call_duration_seconds_count{{{labels}}} {h[-2]}']
        return "\n".join(out) + "\n"


llm_metrics = LLMMetrics()


@contextmanager
def observe_llm_call(provider: str, model: str, operation: str):
    """Wrap ONE logical LLM call (retries included): records its metrics and, if it fails, writes exactly one
    structured log line - provider, model, operation, error class, duration, request id. No prompt, no key, no
    provider message. A caller that stops listening early (client disconnect) is neither a success nor a failure."""
    label = provider_label(provider)
    started = time.perf_counter()
    try:
        yield
    except Exception as exc:
        seconds = time.perf_counter() - started
        cls = error_class(exc)
        llm_metrics.record(label, seconds, cls)
        status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
        logger.error("LLM call failed", extra={
            "event": "llm_call_failed", "provider": label, "model": model, "operation": operation,
            "error_class": cls, "error_type": type(exc).__name__,
            "http_status": status if isinstance(status, int) else None,
            "duration_ms": round(seconds * 1000, 1)})
        raise
    else:
        llm_metrics.record(label, time.perf_counter() - started, None)


def install_metrics_endpoint(app) -> None:
    """Serve GET /metrics on `app`. Only called when METRICS_ENABLED=true. The endpoint has no login: keep the
    backend port off the public internet when it is on."""
    from fastapi.responses import PlainTextResponse

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> PlainTextResponse:
        return PlainTextResponse(llm_metrics.render(), media_type="text/plain; version=0.0.4")
