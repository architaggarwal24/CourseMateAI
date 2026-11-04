"""PDF upload (returns immediately; indexing runs in the background) and document status."""
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile, Request
from fastapi.responses import FileResponse

from deps import require_auth
from schemas.base import SuccessResponse
from schemas.documents import DocumentListResponse, DocumentOut, UploadResponse
from services import entitlements, handle_pdf_upload
from state import documents, history_service, limiter

router = APIRouter()


@router.post("/upload", response_model=UploadResponse, response_model_exclude_unset=True, status_code=202)
@limiter.limit("20/minute")
async def upload_pdf(
        request: Request,
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


@router.delete("/documents/{document_id}", response_model=SuccessResponse, response_model_exclude_unset=True)
@limiter.limit("30/minute")
def delete_document(document_id: str, request: Request, user=Depends(require_auth)):
    """Remove one of your documents (its index and PDF; it leaves its courses). Frees a place on your plan."""
    documents.delete_document(document_id, user["user_id"])
    return {"success": True}


@router.get("/documents/{document_id}", response_model=DocumentOut, response_model_exclude_unset=True)
def get_document_status(document_id: str, user=Depends(require_auth)):
    """Status of one document: queued | reading | indexing | ready | failed | needs_reindex."""
    return documents.get_document(document_id, user["user_id"])


@router.get("/documents/{document_id}/file", response_class=FileResponse,
            responses={200: {"content": {"application/pdf": {}}, "description": "The original PDF"}})
def get_document_file(document_id: str, user=Depends(require_auth)):
    """The original PDF of one of the user's documents, for the side-by-side page viewer (cached privately by the
    browser; it never changes for a given document content). 404 pdf_unavailable: uploaded before PDFs were kept."""
    entitlements.require(user["user_id"], "pdf_viewer")
    path, row = documents.pdf_file(document_id, user["user_id"])
    return FileResponse(path, media_type="application/pdf", filename=row["filename"], content_disposition_type="inline",
                        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
