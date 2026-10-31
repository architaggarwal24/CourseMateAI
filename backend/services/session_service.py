import re
from typing import Optional

from errors import session_expired

# Document / session IDs end up in file names and glob patterns, so they must be a strict, boring
# format. The frontend uses crypto.randomUUID(), which matches this. Without this check a
# client-supplied id like "*" made a cleanup glob match every user's files, and "../x" escaped the
# uploads directory.
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def is_valid_session_id(session_id: Optional[str]) -> bool:
    return bool(session_id) and bool(_SESSION_ID_RE.fullmatch(session_id))


def require_valid_session_id(session_id: Optional[str]) -> str:
    if not is_valid_session_id(session_id):
        raise session_expired()
    return session_id
