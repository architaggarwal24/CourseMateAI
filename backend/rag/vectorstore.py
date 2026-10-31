import os
from pathlib import Path
from typing import List, Optional, Tuple

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from rag.embeddings import get_embedding_model


class VectorStore:
    """
    Wrapper around the vector database, now with disk persistence.
    """

    def __init__(self, documents=None):
        self.embedding_model = get_embedding_model()
        self.store = None

        if documents:
            self.store = FAISS.from_documents(documents, self.embedding_model)

    def add_documents(self, documents):
        if not self.store:
            self.store = FAISS.from_documents(documents, self.embedding_model)
        else:
            self.store.add_documents(documents)

    def search(self, query: str, k: int = 5):
        if not self.store:
            raise ValueError("Vector store is not initialized")
        return self.store.similarity_search(query, k=k)

    def search_scored(self, query: str, k: int = 5, *, fetch_k: Optional[int] = None,
                      lambda_mult: float = 0.7) -> List[Tuple[Document, float]]:
        """Top-k by MMR (relevant AND not redundant), each hit with its cosine similarity to the query (0..1).

        FAISS returns squared L2 distances; for unit-length embeddings (the app's models are configured to
        normalise) cosine = 1 - distance / 2. The first MMR pick is always the single most similar chunk, so
        the best similarity is the first result's. Blocking (embeds the query): run it in a worker thread."""
        if not self.store:
            raise ValueError("Vector store is not initialized")
        fetch_k = max(fetch_k or 0, k * 4, 20)
        embedding = self.embedding_model.embed_query(query)
        hits = self.store.max_marginal_relevance_search_with_score_by_vector(
            embedding, k=k, fetch_k=fetch_k, lambda_mult=lambda_mult)
        return [(doc, max(0.0, min(1.0, 1.0 - float(distance) / 2.0))) for doc, distance in hits]

    def save(self, path: str):
        """Persist the FAISS index to disk."""
        if not self.store:
            raise ValueError("No store to save")
        Path(path).mkdir(parents=True, exist_ok=True)
        self.store.save_local(path)

    @classmethod
    def load(cls, path: str) -> "VectorStore":
        """Reconstruct a VectorStore from a saved FAISS index."""
        instance = cls()  # no documents → store stays None
        embedding_model = get_embedding_model()
        instance.store = FAISS.load_local(
            path,
            embedding_model,
            allow_dangerous_deserialization=True,  # required by LangChain
        )
        return instance