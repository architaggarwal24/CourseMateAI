# NOTE: validate_topic_in_pdf is called in main.py before quiz, notes,
# flashcard, and arena generation to block hallucinated off-topic content.
from typing import Dict, Tuple
from fastapi import HTTPException

from rag.vectorstore import VectorStore
from utils.context_builder import build_context_and_sources


def get_vector_store(session_id: str, vector_stores: Dict) -> VectorStore:
    """
    Retrieve vector store for a session.

    Args:
        session_id: Session ID to retrieve
        vector_stores: Dictionary of session_id -> session data

    Returns:
        VectorStore instance

    Raises:
        HTTPException: If session not found or has no vector store
    """
    if session_id not in vector_stores:
        raise HTTPException(
            status_code=400,
            detail="No PDF uploaded for this session"
        )

    vector_store = vector_stores.get(session_id, {}).get("store")

    if vector_store is None:
        raise HTTPException(
            status_code=400,
            detail="No document uploaded for this session"
        )

    return vector_store


def get_context_for_query(
        vector_store: VectorStore,
        query: str,
        top_k: int = 5
) -> Tuple[str, list]:
    """
    Retrieve context and sources for a query from vector store.

    Args:
        vector_store: VectorStore instance to query
        query: Search query
        top_k: Number of top results to retrieve

    Returns:
        Tuple of (context_string, sources_list)
    """
    if vector_store is None:
        return "", []

    # Search vector store
    docs = vector_store.search(query, k=top_k)

    # Build context and extract sources
    context, sources = build_context_and_sources(docs)

    return context, sources


_STOP_WORDS = frozenset({
    "the", "a", "an", "of", "in", "is", "are", "was", "were",
    "to", "and", "or", "for", "with", "on", "at", "by", "from",
    "this", "that", "it", "be", "as", "i", "do", "does",
})

def validate_context_quality(context: str, query: str) -> Dict[str, any]:
    """
    Validate if the retrieved context is relevant to the query.
    Uses stopword-filtered overlap for a more accurate relevance signal.
    """
    if not context or len(context.strip()) < 200:
        return {
            "is_valid": False,
            "reason": "insufficient_content",
            "needs_clarification": False,
            "blocked": True
        }

    # Filter stop words so short function words don't inflate overlap
    q_terms = {w for w in query.lower().split() if w not in _STOP_WORDS and len(w) > 2}
    if not q_terms:
        # All-stopword query — fall through as valid
        return {"is_valid": True, "reason": "strong_match", "needs_clarification": False, "blocked": False, "overlap_score": 1.0}

    c_terms = set(context.lower().split())
    overlap = len(q_terms & c_terms) / len(q_terms)

    if overlap < 0.15:
        return {
            "is_valid": True,
            "reason": "weak_match",
            "needs_clarification": True,
            "blocked": False,
            "overlap_score": overlap
        }

    return {
        "is_valid": True,
        "reason": "strong_match",
        "needs_clarification": False,
        "blocked": False,
        "overlap_score": overlap
    }

def validate_topic_in_pdf(context: str, topic: str) -> None:
    """
    Raises HTTPException(400) if the topic has no meaningful presence in the PDF.
    Called before quiz, notes, flashcard, and arena generation.

    Uses word-level overlap between the topic and the retrieved context.
    Threshold is deliberately lenient (0.10) to avoid false negatives on
    paraphrased or technical topics, but strict enough to catch completely
    unrelated topics.
    """
    if not context or len(context.strip()) < 100:
        raise HTTPException(
            status_code=400,
            detail=f"Topic '{topic}' was not found in your PDF. Please enter a topic that appears in the uploaded document."
        )

    # Ignore common stop words that inflate overlap artificially
    stop_words = {"the","a","an","of","in","is","are","was","were","to","and","or",
                  "for","with","on","at","by","from","this","that","it","be","as","i"}
    q_words = {w for w in topic.lower().split() if w not in stop_words and len(w) > 2}
    c_words = set(context.lower().split())

    if not q_words:
        return  # Single stop-word topic — let it through

    overlap = len(q_words & c_words) / len(q_words)

    if overlap < 0.10:
        raise HTTPException(
            status_code=400,
            detail=f"Topic '{topic}' does not appear to be covered in your PDF. Try a topic from the document."
        )