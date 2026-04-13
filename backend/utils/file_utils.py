import os
import uuid
from fastapi import UploadFile

UPLOAD_DIR = "uploads"
# FIX BUG 29: Align with upload_service.py which allows 50MB. Old 5MB limit
# caused validate_file_size() to reject files that upload_service would accept.
MAX_FILE_SIZE = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf"}


def ensure_upload_dir() -> None:
    """Ensure upload directory exists."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_file_extension(filename: str) -> str:
    """Extract file extension safely."""
    return os.path.splitext(filename)[1].lower()


def is_allowed_file(filename: str) -> bool:
    """Check if file extension is allowed."""
    return get_file_extension(filename) in ALLOWED_EXTENSIONS


def validate_file_size(file_size: int) -> None:
    """Check file size in bytes. Accepts an int to avoid blocking I/O on UploadFile.
    The upload handler should pass len(await file.read()) or equivalent.
    FIX BUG-F08: Old implementation called .seek()/.tell() on SpooledTemporaryFile
    which blocks the async event loop for large files (>1 MB spool threshold).
    """
    if file_size > MAX_FILE_SIZE:
        size_mb = file_size / (1024 * 1024)
        max_mb = MAX_FILE_SIZE / (1024 * 1024)
        raise ValueError(f"File too large: {size_mb:.2f}MB. Maximum allowed: {max_mb:.0f}MB")

def generate_safe_filename(original_filename: str) -> str:
    """
    Generates a safe, unique filename to avoid collisions.
    """
    ext = get_file_extension(original_filename)
    return f"{uuid.uuid4().hex}{ext}"



def validate_pdf_header(file: UploadFile) -> None:
    """Check if file is really a PDF"""
    header = file.file.read(4)
    file.file.seek(0)

    if header != b'%PDF':
        raise ValueError("Invalid PDF file")


def save_uploaded_file(file: UploadFile) -> str:
    """
    NOTE: upload_service.py does NOT call this function — it writes files inline
    to support session-prefixed filenames. This function is retained for utility use only.
    validate_pdf_header() is called internally here.
    """
    ensure_upload_dir()

    if not is_allowed_file(file.filename):
        raise ValueError("Only PDF files are allowed")

    contents = file.file.read()
    validate_file_size(len(contents))
    validate_pdf_header(file)

    safe_filename = generate_safe_filename(file.filename)
    file_path = os.path.join(UPLOAD_DIR, safe_filename)

    with open(file_path, "wb") as f:
        f.write(contents)

    return file_path
