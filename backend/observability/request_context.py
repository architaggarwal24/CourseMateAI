"""The request id: one short token per HTTP request, carried everywhere the request goes.

* taken from the caller's X-Request-ID when it looks like an id (so a reverse proxy's id is kept), else generated
* returned in the X-Request-ID response header and in every error body ({"error": {..., "request_id"}})
* stamped on every log line written while the request is handled - including the worker threads it starts

A pure ASGI middleware (not BaseHTTPMiddleware): streaming (SSE) responses are passed through untouched.
It also writes the one access line per request: method, path (never the query string), status, duration.
"""
import logging
import re
import time
import uuid
from contextvars import ContextVar
from typing import Optional

from starlette.datastructures import MutableHeaders

HEADER = "X-Request-ID"
_ACCEPTABLE = re.compile(r"^[A-Za-z0-9._\-]{8,64}$")      # never echo arbitrary header content back into logs

_request_id: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
logger = logging.getLogger("coursemate.request")


def current_request_id() -> Optional[str]:
    """The id of the request being handled, or None outside a request."""
    return _request_id.get()


def request_id_of(request) -> Optional[str]:
    """The id for a Request object (also valid in the handlers of the outermost error middleware)."""
    return request.scope.get("request_id") or _request_id.get()


def _incoming(scope) -> Optional[str]:
    for name, value in scope.get("headers", ()):
        if name == b"x-request-id":
            text = value.decode("latin-1")
            return text if _ACCEPTABLE.match(text) else None
    return None


class RequestContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = _incoming(scope) or uuid.uuid4().hex
        scope["request_id"] = rid
        token = _request_id.set(rid)
        started = time.perf_counter()
        status = 500                                   # what the client gets if the app raises

        async def send_with_id(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)[HEADER] = rid
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            logger.log(
                (logging.WARNING if status == 503 else logging.ERROR) if status >= 500 else logging.INFO, "request",
                extra={"event": "request", "method": scope.get("method"), "path": scope.get("path"),
                       "status": status, "duration_ms": round((time.perf_counter() - started) * 1000, 1)})
            _request_id.reset(token)
