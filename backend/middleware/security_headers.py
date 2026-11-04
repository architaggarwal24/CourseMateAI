"""Security headers on every API response (Phase 3 Stage 4d; docs/security.md).

The API answers JSON (and a few PDFs), never pages, so it can be strict: no MIME sniffing, never framed, no
referrer to other sites, and a CSP that allows nothing but being read. HSTS is the HTTPS front end's job (Caddy /
Cloudflare), which sees the real scheme. A plain ASGI middleware, so streamed answers stream as before.
"""
HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
]


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                have = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [(k, v) for k, v in HEADERS if k not in have]
            await send(message)
        return await self.app(scope, receive, send_with_headers)
