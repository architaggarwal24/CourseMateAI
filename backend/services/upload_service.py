import os
import json
import asyncio
import hashlib
from typing import Dict, Optional
from fastapi import UploadFile, HTTPException
from pathlib import Path

from rag.loaders import load_pdf, chunk_documents
from rag.vectorstore import VectorStore
from utils.file_utils import generate_safe_filename

# FIX BUG 18: Use an absolute path anchored to this file so the uploads dir
# is always created next to upload_service.py, not relative to wherever the
# server was started from.
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def get_file_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def process_pdf_upload(
        file: UploadFile,
        session_id: str,
        vector_stores: Dict,
        file_content: bytes,
        user_id: str = ""
) -> Dict:
    file_hash = get_file_hash(file_content)

    # FIX BUG 6: Never use raw file.filename in a path — path traversal risk.
    # generate_safe_filename() creates a UUID-based name that is safe to use.
    safe_name = generate_safe_filename(file.filename)
    file_path = UPLOAD_DIR / f"{session_id}_{safe_name}"
    with open(file_path, "wb") as f:
        f.write(file_content)

    try:
        documents = load_pdf(str(file_path))

        if not documents:
            raise ValueError("No content extracted from PDF")

        chunks = chunk_documents(documents)
        vectorstore = VectorStore(chunks)

        # Persist the FAISS index to disk so it survives server restarts
        store_path = str(UPLOAD_DIR / f"{session_id}_index")
        vectorstore.save(store_path)

        # Save metadata alongside the index for restore_vector_stores() on startup
        meta_path = UPLOAD_DIR / f"{session_id}_meta.json"
        with open(meta_path, "w") as f:
            json.dump({
                "filename": file.filename,
                "file_hash": file_hash,
                "chunks": len(chunks),
            }, f)

        from datetime import datetime
        old = vector_stores.get(session_id)
        if old and old.get("store_path"):
            import shutil
            shutil.rmtree(old["store_path"], ignore_errors=True)
        for f in UPLOAD_DIR.glob(f"{session_id}_*"):
            f.unlink(missing_ok=True)
            
        vector_stores[session_id] = {
            "store": vectorstore,
            "filename": file.filename,
            "file_hash": file_hash,
            "chunks": len(chunks),
            "store_path": store_path,
            "user_id": user_id,  # FIX: store owner to prevent cross-user session access
            # FIX BUG 21/54: session_service.cleanup_old_sessions() checks
            # data.get("created_at", now). Without this field sessions are never
            # considered old and are never expired by age.
            "created_at": datetime.now(),
        }

        return {
            "ok": True,
            "message": f"PDF '{file.filename}' uploaded successfully",
            "session_id": session_id,
            "chunks": len(chunks),
            "file_hash": file_hash,
        }

    except Exception as e:
        if file_path.exists():
            os.remove(file_path)
        # FIX BUG 19: Do not leak internal filesystem paths in error responses.
        # str(e) often includes the full file path. Return a safe generic message.
        import logging as _log
        _log.getLogger(__name__).error(f"PDF processing error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Error processing PDF. Please try a different file."
        )


async def handle_pdf_upload(
        file: UploadFile,
        session_id: Optional[str],
        vector_stores: Dict,
        user_id: str = ""
) -> Dict:
    if not file.filename.endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported"
        )

    if not session_id:
        import uuid
        session_id = str(uuid.uuid4())

    file_content = await file.read()
    file_size = len(file_content)

    max_size = 50 * 1024 * 1024
    if file_size > max_size:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 50MB"
        )

    if file_size == 0:
        raise HTTPException(
            status_code=400,
            detail="File is empty"
        )

    if not file_content.startswith(b'%PDF'):
        raise HTTPException(status_code=400, detail="File does not appear to be a valid PDF")

    # Offload CPU-intensive work (PDF parsing + chunking + FAISS index build)
    # to a thread-pool worker so the event loop stays unblocked during uploads.
    return await asyncio.to_thread(
        process_pdf_upload, file, session_id, vector_stores, file_content, user_id=user_id
    )