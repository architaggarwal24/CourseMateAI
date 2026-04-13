import os

# ─── CORS ─────────────────────────────────────────────────────────────────────
# Add production frontend URL via ALLOWED_ORIGIN env var so you never need to
# edit this file or hardcode URLs in source.
_extra = os.getenv("ALLOWED_ORIGIN", "")
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
]
if _extra:
    ALLOWED_ORIGINS.append(_extra)

# ─── Session Management ────────────────────────────────────────────────────────
SESSION_EXPIRY_HOURS = int(os.getenv("SESSION_EXPIRY_HOURS", "24"))
MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "100"))

# ─── File Upload Limits ───────────────────────────────────────────────────────
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# ─── Backend ──────────────────────────────────────────────────────────────────
BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# ─── Static Files ─────────────────────────────────────────────────────────────
STATIC_DIR = "static"
