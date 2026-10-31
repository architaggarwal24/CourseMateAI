from typing import Optional

from fastapi import Request

from errors import unauthenticated
from fastapi.security import HTTPBearer

COOKIE_NAME = "session_token"


class AuthMiddleware:
    def __init__(self, auth_service):
        self.auth_service = auth_service
        self.bearer = HTTPBearer(auto_error=False)

    async def session_token(self, request: Request) -> Optional[str]:
        """The session token the request carries: the login cookie, else an `Authorization: Bearer` header."""
        token = request.cookies.get(COOKIE_NAME)
        if not token:
            auth = await self.bearer(request)
            if auth:
                token = auth.credentials
        return token or None

    async def get_current_user(self, request: Request) -> Optional[dict]:
        """The signed-in user, or None.

        A session is a row in the database (see AuthService.authenticate), checked on EVERY request: logging
        out, changing the password or deleting the account removes the row, so the old cookie stops working
        at once. Username/email are the live values, so edits show up immediately."""
        user = self.auth_service.authenticate(await self.session_token(request))
        if user:
            request.state.rate_limit_user = user["user_id"]       # rate limits are per user (middleware/client.py)
        return user

    async def require_auth(self, request: Request) -> dict:
        """Require authentication, raise 401 if not authenticated"""
        user = await self.get_current_user(request)

        if not user:
            raise unauthenticated()

        return user
