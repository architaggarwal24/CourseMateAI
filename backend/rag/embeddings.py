"""
embeddings.py — Local embedding model using sentence-transformers.

The model comes from settings (EMBEDDING_MODEL, default BAAI/bge-large-en-v1.5; a smaller choice such
as BAAI/bge-small-en-v1.5 needs far less RAM/CPU). It runs entirely locally: no API key required, so it
works for every user regardless of their LLM provider. The model is downloaded once on first use and
cached automatically.

Every saved index records the model name it was built with (documents.embedding_model); an index is
only used while that matches the configured model.
"""

import threading

from langchain_huggingface import HuggingFaceEmbeddings

from config import settings

_embedding_model = None
_lock = threading.Lock()


def embedding_model_name() -> str:
    return settings.embedding_model


def embedding_model_loaded() -> bool:
    """True once the model is in memory (the first load downloads it). Readiness checks use this; it never loads."""
    return _embedding_model is not None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        with _lock:
            if _embedding_model is None:
                _embedding_model = _load()
    return _embedding_model


def _load():
    """From the local cache first (no network, no Hub chatter in the logs, faster start); the first run - nothing
    cached yet - downloads it once."""
    def make(**extra):
        return HuggingFaceEmbeddings(
            model_name=settings.embedding_model,
            model_kwargs={"device": "cpu", **extra},
            encode_kwargs={"normalize_embeddings": True},
            show_progress=False,
        )
    try:
        return make(local_files_only=True)
    except Exception:                    # not downloaded yet
        return make()
