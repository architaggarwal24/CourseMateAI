"""Retrieval for chat / quiz / notes / flashcards, and the relevance checks that decide whether the
document actually covers what was asked.

Relevance used to be word overlap between the question and the retrieved text, which fails both ways
(paraphrases and synonyms look "unrelated", an unrelated passage that shares a few common words looks
"related"). It is now the cosine similarity between the question and the best retrieved chunk, from the
same embedding model that built the index. The thresholds are settings (see config/settings.py).

The functions here that touch the index (`retrieve`, `get_context_for_query`) embed the query, which is
CPU-bound: call them with `asyncio.to_thread` from async code.
"""
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from config import settings
from errors import AppError
from rag.vectorstore import VectorStore
from utils.context_builder import build_context_and_sources

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Retrieval:
    """What was found for a query."""
    context: str                              # the chunks joined for the prompt
    sources: List[str]                        # "file.pdf · p.4", de-duplicated, in relevance order
    best_similarity: Optional[float]          # cosine similarity of the closest chunk, 0..1 (None: nothing found)
    similarities: Tuple[float, ...] = field(default_factory=tuple)

    @property
    def chunk_count(self) -> int:
        return len(self.similarities)


EMPTY = Retrieval(context="", sources=[], best_similarity=None)


def _norm(text: str) -> str:
    return " ".join((text or "").lower().split())


def _drop_duplicates(hits: List[tuple]) -> List[tuple]:
    """Remove chunks that repeat what an earlier (more relevant) hit already contains: identical text (running
    headers, repeated boilerplate) or text fully contained in another hit."""
    kept: List[tuple] = []
    seen: List[str] = []
    for doc, score in hits:
        text = _norm(doc.page_content)
        if not text or any(text in earlier for earlier in seen):
            continue
        # a longer chunk that swallows an already kept shorter one replaces it
        for i in reversed([i for i, earlier in enumerate(seen) if earlier in text]):
            del kept[i], seen[i]
        kept.append((doc, score))
        seen.append(text)
    return kept


def retrieve(vector_store: Optional[VectorStore], query: str, top_k: int = 5,
             *, mmr_lambda: Optional[float] = None) -> Retrieval:
    """MMR top-k for `query`, de-duplicated, with similarity scores. Blocking: run in a worker thread."""
    if vector_store is None or not (query or "").strip():
        return EMPTY
    lam = settings.retrieval_mmr_lambda if mmr_lambda is None else mmr_lambda
    hits = _drop_duplicates(vector_store.search_scored(query, k=top_k, lambda_mult=lam))
    if not hits:
        return EMPTY
    context, sources = build_context_and_sources([doc for doc, _ in hits])
    scores = tuple(score for _, score in hits)
    return Retrieval(context=context, sources=sources, best_similarity=max(scores), similarities=scores)


def get_context_for_query(vector_store: VectorStore, query: str, top_k: int = 5) -> Tuple[str, list]:
    """(context, sources) for a query - `retrieve` without the scores."""
    found = retrieve(vector_store, query, top_k)
    return found.context, found.sources


# ── Relevance checks ─────────────────────────────────────────────────────────

def assess_relevance(found: Retrieval, *, block_below: Optional[float] = None,
                     clarify_below: Optional[float] = None) -> Dict:
    """Is what was retrieved relevant to the chat question?

      * nothing found, or the best chunk is below `block_below`  -> blocked (the document doesn't cover it)
      * below `clarify_below`                                     -> answer, but ask the student to clarify
      * otherwise                                                 -> fine
    """
    block = settings.relevance_block_below if block_below is None else block_below
    clarify = settings.relevance_clarify_below if clarify_below is None else clarify_below
    best = found.best_similarity

    if not found.context.strip() or best is None:
        return {"is_valid": False, "reason": "insufficient_content", "needs_clarification": False,
                "blocked": True, "similarity": 0.0}
    if best < block:
        return {"is_valid": False, "reason": "not_in_document", "needs_clarification": False,
                "blocked": True, "similarity": best}
    if best < clarify:
        return {"is_valid": True, "reason": "weak_match", "needs_clarification": True,
                "blocked": False, "similarity": best}
    return {"is_valid": True, "reason": "strong_match", "needs_clarification": False,
            "blocked": False, "similarity": best}


def ensure_topic_covered(found: Retrieval, topic: str, *, min_similarity: Optional[float] = None) -> None:
    """Raise AppError(topic_not_found) unless the document has something meaningfully close to `topic`.
    Called before quiz, notes and flashcard generation so the model isn't asked to invent content."""
    minimum = settings.topic_min_similarity if min_similarity is None else min_similarity
    if not found.context or len(found.context.strip()) < 100:
        raise AppError(
            "topic_not_found",
            f"Topic '{topic}' was not found in your PDF. Please enter a topic that appears in the uploaded document.",
            status_code=400)
    if found.best_similarity is None or found.best_similarity < minimum:
        raise AppError(
            "topic_not_found",
            f"Topic '{topic}' does not appear to be covered in your PDF. Try a topic from the document.",
            status_code=400)


def describe(found: Retrieval) -> str:
    """One log line: how close was the best chunk (use it to tune the thresholds)."""
    best = "none" if found.best_similarity is None else f"{found.best_similarity:.3f}"
    return f"best_similarity={best} chunks={found.chunk_count} sources={len(found.sources)}"
