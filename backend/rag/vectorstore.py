import os
from pathlib import Path
from langchain_community.vectorstores import FAISS
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