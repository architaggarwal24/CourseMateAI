"""Concept map extraction (Phase 3 Stage 3B): ONE LLM pass per document, cached by the service.

The model reads a digest - passages taken evenly through the whole document, each marked with its page - and
returns the key concepts (name, one sentence, importance, page) and the relations between them. Slow or
reasoning models: the call has its own time limit, and a timeout or an unusable answer is retried ONCE with a
digest half the size (cheaper and faster) before giving up.
"""
import asyncio
import logging
from typing import Awaitable, Callable, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core_brains.llm_connection import generate_structured_async
from core_brains.llm_schemas import MAX_MAP_CONCEPTS, MAX_MAP_RELATIONS, ConceptMapDraft
from prompts.concept_prompts import CONCEPT_MAP_PROMPT

logger = logging.getLogger(__name__)

DIGEST_CHARS = 14000
PASSAGE_CHARS = 700
CALL_TIMEOUT = 150            # seconds; reasoning models think for a while before the JSON starts


def digest(chunks: List, max_chars: int = DIGEST_CHARS) -> str:
    """Passages spread evenly over the document (start, middle, end all represented), each led by its page."""
    usable = [c for c in chunks if (c.page_content or "").strip()]
    if not usable:
        return ""
    per = PASSAGE_CHARS
    n = max(1, min(len(usable), max_chars // (per + 12)))
    step = len(usable) / n
    picked = [usable[int(i * step)] for i in range(n)]
    parts = []
    for c in picked:
        page = (c.metadata or {}).get("page")
        tag = f"[p.{page + 1}]" if isinstance(page, int) else "[p.?]"
        parts.append(f"{tag} {' '.join(c.page_content.split())[:per]}")
    return "\n\n".join(parts)[:max_chars]


async def extract_concept_map(chunks: List, *, on_stage: Optional[Callable[[str], Awaitable[None]]] = None,
                              timeout: float = CALL_TIMEOUT) -> dict:
    """{"concepts": [...], "relations": [...]} for a document's chunks. Raises when both attempts fail."""
    async def stage(text: str):
        if on_stage:
            await on_stage(text)

    pages = len({(c.metadata or {}).get("page") for c in chunks})
    last: Optional[Exception] = None
    for attempt, size in enumerate((DIGEST_CHARS, DIGEST_CHARS // 2)):
        text = digest(chunks, size)
        if not text:
            raise ValueError("no readable text")
        await stage(f"Reading {pages} page{'s' if pages != 1 else ''}…" if attempt == 0
                    else "That took too long - trying again with a shorter summary…")
        messages = [
            SystemMessage(content="You build concept maps of study material. "
                                  "Return ONLY valid JSON with no preamble, explanation, or markdown fences."),
            HumanMessage(content=CONCEPT_MAP_PROMPT.format(
                digest=text, min_concepts=8 if attempt == 0 else 6, max_concepts=MAX_MAP_CONCEPTS,
                max_relations=MAX_MAP_RELATIONS)),
        ]
        await stage("Mapping the concepts and how they connect…")
        try:
            draft = await asyncio.wait_for(generate_structured_async(messages, ConceptMapDraft, max_attempts=1), timeout)
            return {"concepts": [c.model_dump() for c in draft.concepts],
                    "relations": [r.model_dump() for r in draft.relations]}
        except Exception as exc:                    # timeout, truncated or unusable JSON, provider error
            logger.warning("concept map attempt %d failed: %s", attempt + 1, type(exc).__name__)
            last = exc
            if _is_fatal(exc):
                break
    raise last or RuntimeError("concept map failed")


def _is_fatal(exc: Exception) -> bool:
    """A missing key or a quota error won't be fixed by a shorter digest."""
    text = f"{type(exc).__name__} {exc}".lower()
    return any(s in text for s in ("api key", "quota", "unauthor", "permission", "401", "403", "429"))
