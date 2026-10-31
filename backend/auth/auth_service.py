import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from typing import Dict, Optional

import bcrypt

from database.sessions import SessionRepository

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\-.]+$")

# bcrypt only looks at the first 72 BYTES. bcrypt>=5 raises ValueError beyond that
# (older versions silently truncated), which used to surface as a 500 on register/login.
MAX_PASSWORD_BYTES = 72

# A login lasts this long unless it is revoked first (logout, password change, account deletion).
SESSION_LIFETIME = timedelta(days=7)

# Pre-computed hash used to burn the same CPU time when the email is unknown, so
# response time doesn't reveal which emails are registered.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt())


# ── Shared validators (used by register AND update-profile) ───────────────────
def validate_email(email: str) -> str:
    email = (email or "").lower().strip()
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise ValueError("Invalid email format")
    return email


def validate_username(username: str) -> str:
    username = (username or "").strip()
    if len(username) < 3:
        raise ValueError("Username must be at least 3 characters")
    if len(username) > 32:
        raise ValueError("Username must be at most 32 characters")
    if not _USERNAME_RE.match(username):
        raise ValueError("Username may only contain letters, numbers, underscores, hyphens and dots")
    return username


def validate_full_name(full_name: str) -> str:
    full_name = (full_name or "").strip()
    if not full_name:
        raise ValueError("Full name is required")
    if len(full_name) > 100:
        raise ValueError("Full name must be at most 100 characters")
    return full_name


def validate_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    return password


class AuthService:
    def __init__(self, db, secret_key: str):
        self.db = db
        self.secret_key = secret_key
        self.sessions = SessionRepository(db)

    def register_user(self, email: str, password: str, username: str, full_name: str,
                      timezone: Optional[str] = None) -> Dict:
        """Register new user with hashed password, username, and full name"""
        if not email or not password or not username or not full_name:
            raise ValueError("All fields are required")

        email = validate_email(email)
        username = validate_username(username)
        full_name = validate_full_name(full_name)
        validate_password(password)

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
        user_id = self.db.create_user(email, password_hash, username, full_name, timezone)

        return {"user_id": user_id, "email": email, "username": username, "full_name": full_name}

    def login(self, email: str, password: str, timezone: Optional[str] = None) -> Optional[str]:
        """Check the credentials and open a new session. Returns the session token (the value of the cookie),
        or None for a wrong email/password. Only a keyed hash of the token is stored."""
        email = (email or "").lower().strip()
        user = self.db.get_user_by_email(email)
        pw_bytes = (password or "").encode("utf-8")

        stored = user["password_hash"].encode("utf-8") if user else _DUMMY_HASH
        try:
            ok = bcrypt.checkpw(pw_bytes, stored)
        except ValueError:
            # e.g. password longer than 72 bytes under bcrypt>=5 → simply "wrong password"
            ok = False
        if not user or not ok:
            return None

        self.db.update_last_login(user["id"])
        self.db.set_timezone(user["id"], timezone)      # silently kept current (days follow the user's zone)
        token = secrets.token_urlsafe(32)
        self.sessions.create(self.token_id(token), user["id"], SESSION_LIFETIME)
        return token

    # ── sessions ────────────────────────────────────────────────────────────
    def token_id(self, token: str) -> str:
        """The database key of a session token: HMAC-SHA256 under the server secret, so a copy of the database
        does not contain usable tokens."""
        return hmac.new(self.secret_key.encode("utf-8"), (token or "").encode("utf-8"), hashlib.sha256).hexdigest()

    def authenticate(self, token: Optional[str]) -> Optional[Dict]:
        """The user a session token belongs to, or None when it is unknown, expired or revoked.
        This hits the database on every request - that is what makes revocation immediate."""
        if not token:
            return None
        user = self.sessions.get_user(self.token_id(token))
        if not user:
            return None
        return {
            "user_id": user["id"],
            "email": user["email"],
            "username": user.get("username") or "user",
            "full_name": user.get("full_name") or "User",
        }

    def logout(self, token: Optional[str]) -> None:
        if token:
            self.sessions.delete(self.token_id(token))

    def revoke_other_sessions(self, user_id: int, keep_token: Optional[str] = None) -> int:
        """Sign a user out everywhere (except the session making the request, if given)."""
        return self.sessions.delete_for_user(user_id, self.token_id(keep_token) if keep_token else None)

    def purge_expired_sessions(self) -> int:
        return self.sessions.purge_expired()

    def get_user_info(self, user_id: int) -> Optional[Dict]:
        user = self.db.get_user_by_id(user_id)
        if not user:
            return None
        return {
            "user_id": user["id"],
            "email": user["email"],
            "username": user.get("username", "user"),
            "full_name": user.get("full_name", "User"),
        }
