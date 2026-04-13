from typing import List, Tuple


def build_context_and_sources(docs) -> Tuple[str, list]:
    """
    Builds a context string and source list from retrieved documents.
    """
    if not docs:
        return "", []

    context = "\n\n".join(doc.page_content for doc in docs)

    sources = [
        doc.metadata.get("source")
        for doc in docs
        if doc.metadata.get("source")
    ]

    return context, sources
