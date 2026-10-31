"""JSON log lines on stdout, one object per line.

    {"ts": "...Z", "level": "ERROR", "logger": "...", "msg": "...", "request_id": "...", <structured fields>}

What a log line never contains: API keys, prompts, document text. Three layers keep it that way:
  1. call sites log counts, ids and error classes - not the content they handled
  2. `redact()` blanks key-shaped strings, Authorization values, and the app's own secrets in everything written
  3. an exception is logged as its type plus where it was raised (file:line function). Its message is added only
     for the kinds whose text cannot contain content - operating-system and database errors, and the app's own
     user-safe HTTP errors. Provider, parsing and validation errors can quote the prompt, the model's answer or
     the document, so those never get their message logged.
"""
import json
import logging
import os
import re
import sqlite3
import sys
import traceback
from datetime import datetime, timezone
from typing import Iterable

from starlette.exceptions import HTTPException as StarletteHTTPException

from .request_context import current_request_id

REDACTED = "[redacted]"
MAX_MESSAGE = 500
MAX_EXC_MESSAGE = 200
STACK_FRAMES = 8

_PATTERNS = (
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{8,}"),                    # OpenAI / Anthropic style keys
    re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"),                            # Google
    re.compile(r"\bnvapi-[A-Za-z0-9_\-]{8,}"),                           # NVIDIA
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]{8,}"),
    re.compile(r"(?i)\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),   # JWTs
    re.compile(r"(?i)((?:api[_\-]?key|x-api-key|authorization|password|secret|token)[\"']?\s*[:=]\s*[\"']?)[^\s\"',;}&]+"),
)
_secrets: tuple = ()

# Exceptions whose message is system text, never user/model content.
_MESSAGE_SAFE = (OSError, sqlite3.Error, TimeoutError, StarletteHTTPException)

_STANDARD = set(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message", "asctime", "taskName", "color_message"}


def redact(text) -> str:
    out = str(text)
    for secret in _secrets:
        out = out.replace(secret, REDACTED)
    for pattern in _PATTERNS:
        out = pattern.sub(lambda m: (m.group(1) + REDACTED) if m.groups() else REDACTED, out)
    return out


def _clean(value):
    if isinstance(value, str):
        return redact(value)[:MAX_MESSAGE]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value][:20]
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in list(value.items())[:20]}
    return _clean(str(value))


def _exception_fields(exc_info) -> dict:
    exc_type, exc, tb = exc_info
    fields = {"exc_type": exc_type.__name__}
    if issubclass(exc_type, _MESSAGE_SAFE):
        fields["exc_message"] = redact(str(exc))[:MAX_EXC_MESSAGE]
    # file:line function only - source lines and local values are never included
    fields["stack"] = [f"{f.filename.rsplit('/', 1)[-1]}:{f.lineno} {f.name}" for f in traceback.extract_tb(tb)[-STACK_FRAMES:]]
    return fields


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage())[:MAX_MESSAGE],
        }
        rid = getattr(record, "request_id", None) or current_request_id()
        if rid:
            payload["request_id"] = rid
        for key, value in record.__dict__.items():
            if key not in _STANDARD and key != "request_id":
                payload[key] = _clean(value)
        if record.exc_info and record.exc_info[0] is not None:
            payload.update(_exception_fields(record.exc_info))
        return json.dumps(payload, ensure_ascii=False, default=str)


class PrettyFormatter(JsonFormatter):
    """Readable one-liners for a developer's terminal (LOG_FORMAT=pretty; the default when stdout is a terminal):

        13:04:59  POST /api/v1/arena/battles  200  0.4s
        13:05:41  WARN  arena  boss flavour skipped (TimeoutError)

    Same redaction as the JSON lines - only the layout differs."""
    _COLORS = {"WARNING": "\033[33m", "ERROR": "\033[31m", "CRITICAL": "\033[31;1m"}

    def format(self, record: logging.LogRecord) -> str:
        try:
            return self._pretty(record)
        except Exception:                      # an odd record: the JSON line is better than losing it
            return super().format(record)

    def _pretty(self, record: logging.LogRecord) -> str:
        data = json.loads(super().format(record))
        when = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        if data.get("event") == "request":
            status = int(data.get("status") or 0)
            ms = float(data.get("duration_ms") or 0)
            took = f"{ms / 1000:.1f}s" if ms >= 1000 else f"{ms:.0f}ms"
            color = "\033[31m" if status >= 500 else "\033[33m" if status >= 400 else "\033[32m"
            line = f"{when}  {str(data.get('method') or ''):<6} {data.get('path') or ''}  {color}{status}\033[0m  {took}"
            if data.get("error_code"):
                line += f"  ({data['error_code']})"
            return line
        level = record.levelname
        name = record.name.split(".")[-1]
        extra = ""
        if data.get("event") == "llm_call_failed":
            extra = f"  [{data.get('provider')}/{data.get('model')}: {data.get('error_type')} after {float(data.get('duration_ms') or 0) / 1000:.0f}s]"
        tag = f"{self._COLORS.get(level, '')}{level[:4]}\033[0m" if level != "INFO" else "    "
        line = f"{when}  {tag}  {name}  {data.get('msg', '')}{extra}"
        if data.get("exc_type"):
            line += f"  <{data['exc_type']}>"
        return line


def _pretty_wanted(stream) -> bool:
    fmt = os.environ.get("LOG_FORMAT", "").strip().lower()
    if fmt in ("json", "pretty"):
        return fmt == "pretty"
    try:
        return stream is sys.stdout and sys.stdout.isatty()
    except Exception:
        return False


_HANDLER_MARK = "_coursemate_json_handler"


def configure_logging(secrets: Iterable[str] = (), level: int = logging.INFO, stream=None) -> None:
    """Send every log record (the app's, uvicorn's, libraries') to stdout as JSON. Safe to call twice."""
    global _secrets
    _secrets = tuple(sorted({s for s in secrets if s and len(s) >= 8}, key=len, reverse=True))

    root = logging.getLogger()
    root.setLevel(level)
    if not any(getattr(h, _HANDLER_MARK, False) for h in root.handlers):
        out = stream or sys.stdout
        handler = logging.StreamHandler(out)
        handler.setFormatter(PrettyFormatter() if _pretty_wanted(out) else JsonFormatter())
        setattr(handler, _HANDLER_MARK, True)
        root.addHandler(handler)

    # uvicorn installs its own handlers before the app is imported: route them through the JSON handler.
    # Its access log is replaced by the request middleware's line (which also carries the request id).
    for name in ("uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers, lg.propagate = [], True
    access = logging.getLogger("uvicorn.access")
    access.handlers, access.propagate, access.disabled = [], False, True
