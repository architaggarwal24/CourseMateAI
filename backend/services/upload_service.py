"""PDF upload intake: validate the request, read the file (size-limited), hash it and hand it to the
DocumentService, which records it and indexes it in the background. Returns as soon as the document
is registered - it never waits for parsing or embedding."""
import asyncio
import hashlib
import os
from typing import Dict, Optional

from fastapi import UploadFile

from config import MAX_FILE_SIZE
from services import entitlements
from errors import AppError, session_expired
from services.document_service import DocumentService
from services.session_service import is_valid_session_id

_READ_CHUNK = 1024 * 1024  # 1 MB


def get_file_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _display_name(filename: Optional[str]) -> str:
    """Basename only, length-capped. Never use the raw client filename in a path."""
    name = os.path.basename((filename or "document.pdf").replace("\\", "/"))
    return name[:200] or "document.pdf"


async def _read_limited(file: UploadFile) -> bytes:
    """Read the upload in chunks and stop as soon as it exceeds the limit."""
    buf = bytearray()
    while True:
        chunk = await file.read(_READ_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_FILE_SIZE:
            raise AppError("file_too_large", f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB" + ".", status_code=400, action="reupload")
    return bytes(buf)


async def handle_pdf_upload(
        file: UploadFile,
        session_id: Optional[str],
        documents: DocumentService,
        user_id: str = "",
) -> Dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise AppError("invalid_file", "Only PDF files are supported.", status_code=400, action="reupload")

    if session_id:
        if not is_valid_session_id(session_id):
            raise session_expired()
        # Reject before reading up to 50 MB: uploading into someone else's session would overwrite their document.
        documents.check_owner(session_id, user_id)

    # The plan: how many documents and how big a PDF (a replacement of an existing id adds no document).
    uid = int(user_id) if str(user_id).isdigit() else None
    limits = entitlements.limits_for(uid) if uid is not None else None
    if limits is not None and not (session_id and documents.repo.get(session_id)):
        have = documents.repo.count_for_user(uid)
        if have >= limits["documents"]:
            raise entitlements.plan_limit(
                uid, "documents", have, limits["documents"],
                f"Your plan holds {limits['documents']} documents and you have {have}. Delete one, or upgrade for more.")

    file_content = await _read_limited(file)

    if limits is not None and len(file_content) > limits["pdf_mb"] * 1024 * 1024:
        raise entitlements.plan_limit(
            uid, "pdf_mb", -(-len(file_content) // (1024 * 1024)), limits["pdf_mb"],
            f"Your plan takes PDFs up to {limits['pdf_mb']} MB. Try a smaller file, or upgrade for bigger ones.")

    if len(file_content) == 0:
        raise AppError("invalid_file", "That file is empty.", status_code=400, action="reupload")

    if not file_content.startswith(b"%PDF"):
        raise AppError("invalid_file", "That file doesn't look like a valid PDF.", status_code=400, action="reupload")

    display_name = _display_name(file.filename)
    document, reused = await asyncio.to_thread(
        documents.register_upload, int(user_id), display_name, session_id, file_content, get_file_hash(file_content),
    )
    if reused and document["status"] == "ready":
        message = f"'{display_name}' is already indexed and ready"
    elif reused:
        message = f"'{display_name}' is already being processed"
    else:
        message = f"'{display_name}' received - it is being processed in the background"
    return {"ok": True, "message": message, "session_id": document["id"], "reused": reused, "document": document}
