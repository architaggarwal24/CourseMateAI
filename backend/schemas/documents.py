from typing import List, Literal, Optional

from .base import ApiModel

DocumentStatus = Literal["queued", "reading", "indexing", "ready", "failed", "needs_reindex"]


class DocumentOut(ApiModel):
    """One uploaded PDF. `id` is the session_id every study endpoint takes."""
    id: str
    filename: str
    file_hash: str
    status: DocumentStatus
    error: Optional[str] = None            # why it failed (user-safe), else null
    chunks: Optional[int] = None
    embedding_model: Optional[str] = None
    created_at: str
    last_used_at: str
    pdf_available: Optional[bool] = None   # the original PDF is kept (the page viewer can open it)
    pinned: Optional[bool] = None          # part of a course: never expires for being idle
    kind: Optional[str] = None             # "course" when the id is a course's (it stands in for a document)
    documents: Optional[list] = None       # a course's document ids


class UploadResponse(ApiModel):
    """Returned immediately; indexing continues in the background (poll GET /documents/{id})."""
    ok: bool
    message: str
    session_id: str
    reused: bool                           # true: nothing new was started (already there / index shared)
    document: DocumentOut


class DocumentListResponse(ApiModel):
    documents: List[DocumentOut]
