from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer
from typing import Optional

class AuthMiddleware:
    def __init__(self, auth_service):
        self.auth_service = auth_service
        self.bearer = HTTPBearer(auto_error=False)
    
    async def get_current_user(self, request: Request) -> Optional[dict]:
        """Extract and verify JWT from cookie or Authorization header"""
        # Try cookie first
        token = request.cookies.get('session_token')
        
        # Fallback to Authorization header
        if not token:
            auth = await self.bearer(request)
            if auth:
                token = auth.credentials
        
        if not token:
            return None
        
        user_data = self.auth_service.verify_token(token)
        return user_data
    
    async def require_auth(self, request: Request) -> dict:
        """Require authentication, raise 401 if not authenticated"""
        user = await self.get_current_user(request)
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated"
            )
        
        return user