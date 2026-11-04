"""Searching several documents' indexes as one (a course).

Every member index is searched with the same query and the hits are merged by similarity, so the course answers
from whichever document fits best. Each returned chunk is a COPY tagged with the document it came from
(metadata doc_id / doc_name): the citation and the source label can name it. The member indexes stay as they
are (nothing is re-embedded), so a course is always in sync with its documents.
"""
from typing import List, Sequence, Tuple

from langchain_core.documents import Document

VOICE_SHARE = 0.75          # a document whose best passage scores at least this share of the best one is heard


def tag(doc: Document, doc_id: str, doc_name: str) -> Document:
    meta = dict(doc.metadata or {})
    meta.setdefault("doc_id", doc_id)
    meta.setdefault("doc_name", doc_name)
    if doc_name:
        meta["source"] = doc_name
    return Document(page_content=doc.page_content, metadata=meta)


class MultiIndex:
    """Duck-types rag.vectorstore.VectorStore's search / search_scored over (doc_id, doc_name, store) members."""

    def __init__(self, members: Sequence[Tuple[str, str, object]]):
        self.members = list(members)

    def search_scored(self, query: str, k: int = 5, **kw) -> List[Tuple[Document, float]]:
        hits: List[Tuple[Document, float]] = []
        for doc_id, name, store in self.members:
            for doc, score in store.search_scored(query, k=k, **kw):
                hits.append((tag(doc, doc_id, name), score))
        hits.sort(key=lambda h: -h[1])                      # best first, whichever document it is in
        top = hits[:k]
        if not top or len(self.members) < 2:
            return top
        # Every document that is nearly as relevant as the best one gets at least one passage: near-duplicate
        # chunks of one PDF must not crowd out a second PDF that answers the other half of the question.
        floor = top[0][1] * VOICE_SHARE
        have = {h[0].metadata["doc_id"] for h in top}
        for h in hits[k:]:
            doc_id = h[0].metadata["doc_id"]
            if doc_id in have or h[1] < floor:
                continue
            counts = {}
            for t in top:
                counts[t[0].metadata["doc_id"]] = counts.get(t[0].metadata["doc_id"], 0) + 1
            # replace the weakest passage of the document with the most passages
            crowded = max(counts, key=lambda d: counts[d])
            if counts[crowded] < 2:
                break
            i = max(i for i, t in enumerate(top) if t[0].metadata["doc_id"] == crowded)
            top[i] = h
            have.add(doc_id)
        return sorted(top, key=lambda h: -h[1])

    def search(self, query: str, k: int = 5) -> List[Document]:
        return [doc for doc, _ in self.search_scored(query, k=k)]
