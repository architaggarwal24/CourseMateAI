"""
embeddings.py — Local embedding model using sentence-transformers.

Uses HuggingFace's all-MiniLM-L6-v2 which runs entirely locally.
No API key required — works for every user regardless of their LLM provider.
Model is downloaded once on first use and cached automatically.
"""

from langchain_huggingface import HuggingFaceEmbeddings
import threading
_embedding_model = None
_lock = threading.Lock()


# Delete the first get_embedding_model() definition entirely, keep only this:
def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        with _lock:
            if _embedding_model is None:
                _embedding_model = HuggingFaceEmbeddings(
                    model_name="BAAI/bge-large-en-v1.5",
                    model_kwargs={"device": "cpu"},
                    encode_kwargs={"normalize_embeddings": True},
                )
    return _embedding_model