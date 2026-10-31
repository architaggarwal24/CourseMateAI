"""Operational basics: structured logs, a request id on everything, LLM metrics.

    request_context  the X-Request-ID middleware and the current request id
    logs             JSON log lines (and what they never contain)
    metrics          per-provider LLM call count / latency / error class, rendered at /metrics
"""
from .logs import configure_logging, redact
from .metrics import install_metrics_endpoint, llm_metrics, observe_llm_call
from .request_context import RequestContextMiddleware, current_request_id

__all__ = ["RequestContextMiddleware", "configure_logging", "current_request_id", "install_metrics_endpoint", "llm_metrics", "observe_llm_call", "redact"]
