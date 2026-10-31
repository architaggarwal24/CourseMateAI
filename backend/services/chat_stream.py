"""Server-Sent Events for POST /chat/stream.

Frames (each is "event: <name>\\ndata: <one line of JSON>\\n\\n"):

    event: token    data: {"text": "..."}                       zero or more, in order
    event: sources  data: {"sources": [...], "mode": "chat", ...}   the final event of a successful answer
    event: error    data: {"error": {"code","message","action","details"}}   the unified error shape; terminates the stream

A failure before the first token is not a stream at all: the endpoint answers with the normal HTTP error
(status + the same JSON body), so clients only see an `error` event for failures that happen mid-answer.
"""
import asyncio
import json
import logging
from typing import AsyncIterator, Awaitable, Callable, Dict, Optional

from errors import AppError, error_body

logger = logging.getLogger(__name__)

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",          # tell nginx-style proxies not to buffer the stream
}


def sse(event: str, data: Dict) -> str:
    """One SSE frame. JSON never contains a raw newline, so `data:` is always a single line."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def error_frame(err: AppError) -> str:
    return sse("error", error_body(err.code, err.message, err.action, err.details))


async def _aclose(it) -> None:
    close = getattr(it, "aclose", None)
    if close is not None:
        try:
            await close()
        except Exception:                                           # closing must never mask the real outcome
            logger.debug("Closing the token stream failed", exc_info=True)


async def chat_event_stream(
    first: str,
    rest: AsyncIterator[str],
    *,
    finish: Callable[[str], Awaitable[Dict]],
    to_error: Callable[[Exception], AppError],
) -> AsyncIterator[str]:
    """Frames for a streamed answer whose first token has already been received.

    finish(full_answer) runs once the model is done (history, rewards...) and returns the payload of the
    final `sources` event. If the client goes away the generator is cancelled/closed: the model stream is
    closed and `finish` is NOT run, so an abandoned answer earns no rewards and is not logged as an answer."""
    parts = [first]
    final: Optional[Dict] = None
    try:
        yield sse("token", {"text": first})
        async for piece in rest:
            parts.append(piece)
            yield sse("token", {"text": piece})
        final = await finish("".join(parts))
    except (asyncio.CancelledError, GeneratorExit):
        raise
    except Exception as exc:
        err = to_error(exc)
        if err.code == "ai_request_failed":
            logger.exception("Chat stream failed mid-answer")
        yield error_frame(err)
        return
    finally:
        await _aclose(rest)
    yield sse("sources", final)
