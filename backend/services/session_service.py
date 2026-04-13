import logging

logger = logging.getLogger(__name__)

from datetime import datetime, timedelta
from typing import Dict
from fastapi import HTTPException

from config import SESSION_EXPIRY_HOURS, MAX_SESSIONS


def _delete_session_files(session_id: str, data: dict) -> None:
    """Delete the PDF file and FAISS index for a session from disk."""
    import shutil
    from pathlib import Path

    store_path = data.get("store_path", "")
    if store_path:
        p = Path(store_path)
        if p.exists():
            shutil.rmtree(str(p), ignore_errors=True)

    # Also delete any session-prefixed files (e.g. <session_id>_filename.pdf, _meta.json)
    upload_dir = Path(__file__).resolve().parent.parent / "uploads"
    if upload_dir.exists():
        for f in upload_dir.glob(f"{session_id}_*"):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass


def cleanup_old_sessions(vector_stores: Dict) -> int:
    """
    Remove sessions older than SESSION_EXPIRY_HOURS and delete their files from disk.

    Args:
        vector_stores: Dictionary of session_id -> session data

    Returns:
        Number of sessions cleaned up
    """
    now = datetime.now()
    expired = []

    for session_id, data in vector_stores.items():
        created_at = data.get("created_at", now)
        if now - created_at > timedelta(hours=SESSION_EXPIRY_HOURS):
            expired.append(session_id)

    for session_id in expired:
        _delete_session_files(session_id, vector_stores[session_id])
        del vector_stores[session_id]

    if expired:
        logger.info(f"Cleaned up {len(expired)} expired sessions (files deleted)")

    return len(expired)


def enforce_session_limit(vector_stores: Dict) -> int:
    """
    Enforce maximum session limit by removing oldest sessions.

    Args:
        vector_stores: Dictionary of session_id -> session data

    Returns:
        Number of sessions removed
    """
    if len(vector_stores) <= MAX_SESSIONS:
        return 0

    # Sort sessions by creation time
    sorted_sessions = sorted(
        vector_stores.items(),
        key=lambda x: x[1].get("created_at", datetime.now())
    )

    # Calculate how many to remove
    to_remove = len(vector_stores) - MAX_SESSIONS

    # Remove oldest sessions — delete disk files to avoid permanent disk leak
    for session_id, data in sorted_sessions[:to_remove]:
        _delete_session_files(session_id, data)
        del vector_stores[session_id]

    logger.info(f"Removed {to_remove} sessions due to MAX_SESSIONS limit")
    return to_remove


def cleanup_sessions(vector_stores: Dict) -> Dict[str, int]:
    """
    Run full cleanup: expire old sessions and enforce limits.

    Args:
        vector_stores: Dictionary of session_id -> session data

    Returns:
        Dictionary with cleanup statistics
    """
    expired_count = cleanup_old_sessions(vector_stores)
    limit_count = enforce_session_limit(vector_stores)

    return {
        "expired_sessions": expired_count,
        "limit_enforced_sessions": limit_count,
        "total_removed": expired_count + limit_count,
        "active_sessions": len(vector_stores)
    }


def delete_session_by_id(session_id: str, vector_stores: Dict) -> Dict[str, str]:
    """
    Manually delete a specific session.

    Args:
        session_id: Session ID to delete
        vector_stores: Dictionary of session_id -> session data

    Returns:
        Success message

    Raises:
        HTTPException: If session not found
    """
    if session_id not in vector_stores:
        raise HTTPException(status_code=404, detail="Session not found")

    _delete_session_files(session_id, vector_stores[session_id])
    del vector_stores[session_id]

    return {
        "status": "success",
        "message": f"Session {session_id} deleted"
    }


def get_cleanup_stats(vector_stores: Dict) -> Dict:
    """
    Get current session statistics and trigger cleanup.

    Args:
        vector_stores: Dictionary of session_id -> session data

    Returns:
        Statistics about cleanup operation
    """
    initial_count = len(vector_stores)
    stats = cleanup_sessions(vector_stores)

    return {
        "status": "success",
        "initial_sessions": initial_count,
        **stats
    }


def get_session_info(session_id: str, vector_stores: Dict) -> Dict:
    """
    Get information about a specific session.

    Args:
        session_id: Session ID to query
        vector_stores: Dictionary of session_id -> session data

    Returns:
        Session information

    Raises:
        HTTPException: If session not found
    """
    if session_id not in vector_stores:
        raise HTTPException(status_code=404, detail="Session not found")

    session_data = vector_stores[session_id]

    return {
        "session_id": session_id,
        "created_at": session_data.get("created_at").isoformat() if session_data.get("created_at") else None,
        "filename": session_data.get("filename"),
        "size_mb": session_data.get("size_mb"),
        "has_vector_store": "store" in session_data
    }