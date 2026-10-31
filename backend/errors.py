"""One error shape for the whole API.

Every non-2xx response is

    {"error": {"code": str, "message": str, "action": str | null, "details": object | null, "request_id": str | null}}

* code     machine-readable, stable ("session_expired", "provider_quota", ...)
* message  one user-safe sentence the UI may show as-is (never internals, paths or keys)
* action   what the UI should offer next: settings | relogin | retry | reupload | null
* details  optional structured extras (per-field validation errors, usage_url, ...)
* request_id  the id of the request (also the X-Request-ID response header) - quote it when reporting a problem

Raise `AppError` (or one of the factories below) from endpoints and services; `register_handlers`
turns it - and every other HTTPException, validation error, rate-limit hit and unexpected
exception - into that shape. This module is a leaf (no app imports) so services can use it.
"""
import logging
from http import HTTPStatus
from typing import Any, Dict, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from observability.request_context import HEADER as REQUEST_ID_HEADER, current_request_id, request_id_of

logger = logging.getLogger(__name__)

Action = Optional[Literal["settings", "relogin", "retry", "reupload"]]

RATE_LIMIT_RETRY_SECONDS = 60


class AppError(HTTPException):
    """An error with a stable code and a safe message. Subclasses HTTPException so existing
    `except HTTPException` blocks and status-code handling keep working."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        action: Action = None,
        details: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ):
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.code = code
        self.message = message
        self.action = action
        self.details = details


# ── Factories for the cases the frontend reacts to ────────────────────────────

def unauthenticated() -> AppError:
    return AppError("unauthenticated", "Please log in to continue.", status_code=401, action="relogin")


def session_expired(status_code: int = 400) -> AppError:
    """The uploaded document is gone (expired, never uploaded, or the session id is unusable)."""
    return AppError(
        "session_expired",
        "Your document session has expired. Please upload your PDF again.",
        status_code=status_code, action="reupload",
    )


def document_not_found() -> AppError:
    return AppError("document_not_found", "That document couldn't be found.", status_code=404)


def document_not_ready(status: str) -> AppError:
    stage = {"queued": "waiting in line", "reading": "being read", "indexing": "being indexed"}.get(status, "being processed")
    return AppError(
        "document_not_ready",
        f"Your document is still {stage}. Try again in a moment.",
        status_code=409, action="retry", details={"status": status},
    )


def document_failed(reason: Optional[str]) -> AppError:
    return AppError(
        "document_failed",
        reason or "We couldn't process that PDF. Please upload it again.",
        status_code=409, action="reupload",
    )


def document_needs_reindex() -> AppError:
    return AppError(
        "document_needs_reindex",
        "This document was indexed with a different embedding model. Upload it again to re-index it.",
        status_code=409, action="reupload", details={"status": "needs_reindex"},
    )


def provider_key_rejected(provider_label: str) -> AppError:
    # 400, NOT 401: the frontend logs the user out on any 401.
    return AppError(
        "provider_key_rejected",
        f"{provider_label} rejected your API key (or it can't use this model). "
        "Update it in Settings → AI Provider.",
        status_code=400, action="settings",
    )


def provider_unreachable(provider_label: str) -> AppError:
    return AppError(
        "provider_unreachable",
        f"Couldn't reach {provider_label}. Check that the service is up "
        "and your provider settings (base URL / model) are right.",
        status_code=502, action="retry",
    )


def provider_quota(provider: str, provider_label: str, usage_url: str = "") -> AppError:
    return AppError(
        "provider_quota",
        f"You have exceeded your API quota for {provider_label}. Check your usage or upgrade your plan.",
        status_code=429, action="settings",
        details={"usage_url": usage_url or "", "provider": provider or ""},
    )


def provider_settings_invalid(message: str, field: Optional[str] = None) -> AppError:
    """The provider / model / base URL / key combination the user entered can't be used.
    `field` (when known) names the request field it is about: llm_provider | llm_model | llm_base_url | api_key."""
    return AppError("provider_settings_invalid", message, status_code=400, action="settings",
                    details={"field": field} if field else None)


def invalid_input(message: str, *, details: Optional[Dict[str, Any]] = None, field: Optional[str] = None) -> AppError:
    """`field` names the request field the message is about; it is sent as details.field so a form can show the
    message beside that field."""
    if field:
        details = {**(details or {}), "field": field}
    return AppError("invalid_input", message, status_code=400, details=details)


class FieldValueError(ValueError):
    """A ValueError that knows which request field it is about (a taken username, an email already registered)."""

    def __init__(self, message: str, field: str):
        super().__init__(message)
        self.field = field


def forbidden(message: str = "You don't have access to that.", code: str = "forbidden") -> AppError:
    return AppError(code, message, status_code=403)


def generation_failed(message: str = "Something went wrong while generating that. Please try again.") -> AppError:
    return AppError("generation_failed", message, status_code=500, action="retry")


# ── Response building ─────────────────────────────────────────────────────────

def error_body(code: str, message: str, action: Action = None, details: Optional[Dict[str, Any]] = None,
               request_id: Optional[str] = None) -> dict:
    return {"error": {"code": code, "message": message, "action": action, "details": details,
                      "request_id": request_id or current_request_id()}}


def error_response(
    status_code: int, code: str, message: str, action: Action = None,
    details: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None,
    request_id: Optional[str] = None,
) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error_body(code, message, action, details, request_id),
                        headers=headers)


# Defaults for plain HTTPExceptions (framework 404/405, anything not raised as AppError).
_STATUS_DEFAULTS: Dict[int, tuple] = {
    400: ("bad_request", "That request couldn't be processed.", None),
    401: ("unauthenticated", "Please log in to continue.", "relogin"),
    403: ("forbidden", "You don't have access to that.", None),
    404: ("not_found", "That couldn't be found.", None),
    405: ("method_not_allowed", "That action isn't supported here.", None),
    409: ("conflict", "That conflicts with the current state. Please refresh and try again.", None),
    413: ("payload_too_large", "That request is too large.", None),
    422: ("validation_error", "Some of the information you entered is invalid.", None),
    429: ("rate_limited", "Too many requests. Please wait a minute and try again.", "retry"),
}
_INTERNAL = ("internal", "Something went wrong on our side. Please try again.", "retry")


def _defaults_for(status_code: int) -> tuple:
    if status_code in _STATUS_DEFAULTS:
        return _STATUS_DEFAULTS[status_code]
    if status_code >= 500:
        return _INTERNAL
    return ("bad_request", "That request couldn't be processed.", None)


def _is_http_phrase(text: str, status_code: int) -> bool:
    try:
        return text == HTTPStatus(status_code).phrase
    except ValueError:
        return False


# ── Handlers ──────────────────────────────────────────────────────────────────

async def app_error_handler(request: Request, exc: StarletteHTTPException):
    if isinstance(exc, AppError):
        return error_response(exc.status_code, exc.code, exc.message, exc.action, exc.details, exc.headers)

    code, message, action = _defaults_for(exc.status_code)
    details = None
    detail = exc.detail
    if isinstance(detail, dict):                       # legacy structured detail
        message = str(detail.get("message") or message)
        rest = {k: v for k, v in detail.items() if k != "message"}
        details = rest or None
    elif isinstance(detail, str) and detail and not _is_http_phrase(detail, exc.status_code):
        message = detail
    if exc.status_code >= 500:
        message = _INTERNAL[1]                          # never pass internals through on a 5xx
    return error_response(exc.status_code, code, message, action, details, exc.headers)


async def validation_error_handler(request: Request, exc: RequestValidationError):
    fields = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", ())]
        # Only location + pydantic's generic message: never echo the submitted value (it may be a password).
        fields.append({
            "field": ".".join(loc[1:]) if len(loc) > 1 else (loc[0] if loc else ""),
            "in": loc[0] if loc else "",
            "message": str(err.get("msg", "Invalid value")),
            "type": str(err.get("type", "")),
        })
    return error_response(
        422, "validation_error", "Some of the information you entered is invalid.",
        details={"fields": fields},
    )


async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return error_response(
        429, "rate_limited",
        "You're going a bit fast — too many requests. Please wait a minute and try again.",
        action="retry",
        details={"retry_after_seconds": RATE_LIMIT_RETRY_SECONDS},
        headers={"Retry-After": str(RATE_LIMIT_RETRY_SECONDS)},
    )


async def unexpected_error_handler(request: Request, exc: Exception):
    # This handler runs in the outermost error middleware, outside the request-id middleware: it adds the id itself.
    rid = request_id_of(request)
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, extra={"request_id": rid})
    return error_response(500, *_INTERNAL[:2], action=_INTERNAL[2], request_id=rid,
                          headers={REQUEST_ID_HEADER: rid} if rid else None)


def register_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, app_error_handler)   # also catches fastapi.HTTPException / AppError
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
    app.add_exception_handler(Exception, unexpected_error_handler)
