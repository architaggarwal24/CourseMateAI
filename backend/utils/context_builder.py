from typing import Tuple


def build_context_and_sources(docs) -> Tuple[str, list]:
    """
    Builds a context string and a de-duplicated, human-readable source list
    (e.g. ["lecture3.pdf · p.4", "lecture3.pdf · p.7"]) from retrieved documents.

    The old version returned doc.metadata["source"], which PyPDFLoader sets to the
    server-side file path – leaking filesystem layout to the client, repeated once
    per chunk and useless to the student.
    """
    if not docs:
        return "", []

    context = "\n\n".join(doc.page_content for doc in docs)

    sources, seen = [], set()
    for doc in docs:
        meta = doc.metadata or {}
        name = str(meta.get("source") or "").replace("\\", "/").rsplit("/", 1)[-1]
        page = meta.get("page")
        if isinstance(page, int):
            label = f"{name} · p.{page + 1}" if name else f"p.{page + 1}"
        else:
            label = name
        if label and label not in seen:
            seen.add(label)
            sources.append(label)

    return context, sources
