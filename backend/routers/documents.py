"""PDF upload (returns immediately; indexing runs in the background) and document status."""
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile

from deps import require_auth
from schemas.documents import DocumentListResponse, DocumentOut, UploadResponse
from services import handle_pdf_upload
from state import documents, history_service

router = APIRouter()


@router.post("/upload", response_model=UploadResponse, response_model_exclude_unset=True, status_code=202)
async def upload_pdf(
        file: UploadFile = File(...),
        session_id: str = Form(None),
        background_tasks: BackgroundTasks = None,
        user=Depends(require_auth)
):
    # Housekeeping on every upload: expire idle documents / enforce the global cap (operates on the table).
    if background_tasks is not None:
        background_tasks.add_task(documents.cleanup)
    result = await handle_pdf_upload(file, session_id, documents, user_id=str(user['user_id']))
    history_service.log_activity(
        user_id=user['user_id'], session_id=result.get("session_id") or session_id or "unknown",
        mode='upload', action_type='pdf_upload', content={'filename': (file.filename or "")[:200]}
    )
    return result


@router.get("/documents", response_model=DocumentListResponse, response_model_exclude_unset=True)
def list_my_documents(user=Depends(require_auth)):
    """The logged-in user's documents, most recently used first."""
    return {"documents": documents.list_documents(user["user_id"])}


@router.get("/documents/{document_id}", response_model=DocumentOut, response_model_exclude_unset=True)
def get_document_status(document_id: str, user=Depends(require_auth)):
    """Status of one document: queued | reading | indexing | ready | failed | needs_reindex."""
    return documents.get_document(document_id, user["user_id"])
