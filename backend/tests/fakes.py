"""Offline test doubles for the retrieval pipeline."""
import re
import zlib
from typing import List

import numpy as np
from langchain_core.embeddings import Embeddings

_STOP = frozenset(
    "a an the is are was were be of in on to and or what why how does do did it its that this for with as by at from "
    "can you me my tell explain about which who when where".split())
_WORD = re.compile(r"[a-z0-9]+")


class BagOfWordsEmbeddings(Embeddings):
    """Unit-length hashed bag of content words.

    Two texts that share content words are similar (cosine = shared / sqrt(n * m) for equal weights) and
    texts with no content word in common are ~0 - so a test decides how relevant a question is by choosing
    its words. Deterministic and offline (crc32, not hash()), and unit-norm like the real bge setup
    (normalize_embeddings=True), which the similarity gate relies on."""

    def __init__(self, size: int = 1024):
        self.size = size

    def _vector(self, text: str) -> List[float]:
        v = np.zeros(self.size, dtype=np.float64)
        for word in _WORD.findall((text or "").lower()):
            if word in _STOP:
                continue
            if len(word) > 3 and word.endswith("s"):
                word = word[:-1]
            v[zlib.crc32(word.encode()) % self.size] += 1.0
        norm = np.linalg.norm(v)
        if norm == 0:
            v[0] = 1.0                          # no content words: an arbitrary but valid unit vector
            norm = 1.0
        return (v / norm).tolist()

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> List[float]:
        return self._vector(text)
