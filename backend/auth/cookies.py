"""The login cookie: HttpOnly (scripts can't read it), SameSite=Lax (not sent on cross-site POSTs) and Secure
whenever the user reached us over https - directly, or through a trusted proxy - or COOKIE_SECURE=true."""
from fastapi import Request, Response

from auth.auth_service import SESSION_LIFETIME
from auth.middleware import COOKIE_NAME
from config import settings
from middleware.client import request_is_https


def _attrs(request: Request) -> dict:
    return {"httponly": True, "samesite": "lax", "path": "/",
            "secure": settings.cookie_secure or request_is_https(request)}


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(COOKIE_NAME, token, max_age=int(SESSION_LIFETIME.total_seconds()), **_attrs(request))


def clear_session_cookie(response: Response, request: Request) -> None:
    # Same attributes as when it was set, or some browsers keep the cookie.
    response.delete_cookie(COOKIE_NAME, **_attrs(request))
