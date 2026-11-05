# Hardening: security pass, rate limits, monitoring, installable app (Phase 3, Stage 4d)

> **Note (Stage 4.6):** written for the Python backend, which is gone. The rules still hold; the code is now under `src/server/`, and settings and admin tasks are in [deploy-cloudflare.md](../deploy-cloudflare.md) and the in-app Admin panel.

## Security pass: what was checked, what changed

| Area | State before | Now |
|---|---|---|
| Login cookie | HttpOnly, SameSite=Lax, Secure over https; the session row is checked on every request and only a keyed hash of the token is stored | unchanged (good) |
| Passwords | bcrypt; dummy hash against timing leaks; a new password needs the current one and signs other devices out | unchanged (good) |
| **Changing the email** | a session alone could change it (a stolen cookie could take the account's login) | **needs the current password** (`current_password_required`, `wrong_password`, `details.field`) |
| **Deleting the account** | a session alone could delete everything | **needs the password** (`DELETE /auth/delete-account {password}`) and is limited to 5 an hour |
| **Guessing one account's password** | 5 logins a minute per client only | plus **10 wrong passwords per account per 15 min** from anywhere → 429 with `Retry-After` (`auth/login_throttle.py`, in memory) |
| Provider API keys | Fernet-encrypted at rest, never sent back, client cache keyed by a hash of the whole key | unchanged. A provider's error text is **redacted** before it is logged or shown, so an echoed key never lands in logs |
| CORS | fixed local origins + `ALLOWED_ORIGIN` | `ALLOWED_ORIGIN=*` is refused (it would send the login cookie to any site); a comma list is accepted |
| `JWT_SECRET` | required | a warning when it is shorter than 32 characters |
| API headers | none | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `CSP: default-src 'none'; frame-ancestors 'none'`, `COOP`, `Permissions-Policy` (`middleware/security_headers.py`) |
| Page headers | none | the same family from `next.config.ts` (no script rules: Next's inline scripts and Razorpay Checkout must run). HSTS is set by the HTTPS front end (Caddy / Cloudflare, Stage 4e) |
| Error reports | n/a | Sentry, with no PII or secrets (below) |
| Unused code | three.js, @react-three/fiber, @react-three/drei, @types/three in package.json | removed (nothing imported them; no files deleted) |

## Rate limits

Every route that changes something now has its own limit. `tests/test_security.py` fails if a new one is added without one (logout is the one exception). Limits are counted per signed-in user (per client IP for visitors).

| Kind | Limit |
|---|---|
| Sign-in | login 5/min (+ the per-account throttle), register 10/min, username check 60/min |
| Account | profile 10/min, provider key change 20/hour (each makes a real check call), switch to the server's AI 20/hour, delete 5/hour, invite redeem 10/hour |
| AI work | chat 30/min, quiz / flashcards / notes 20/min, exams 6/min, battles and runs 10/min, concept map 10/min (+ the plan's daily AI quota) |
| Turns and answers | battle question / answer 120/min, quiz answer 120/min, review grade 240/min, exam answers 240/min |
| Documents and courses | upload 20/min, delete document 30/min, courses 30–60/min |
| Game | shop 60–120/min, items 60/min, avatar / champion 60/min, quest claim 30/min, rewards 60/min, forfeit / abandon 30/min |
| Billing | checkout / cancel 10/hour, verify 20/hour, webhook 300/min |

Reads (GET) are unlimited apart from the expensive ones (PDF report 20/min, review queue 120/min, battle question 120/min).

## Error monitoring (Sentry)

Off unless a DSN is set. **Backend:** `SENTRY_DSN` (+ `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`), see `observability/monitoring.py`. **Frontend:** `NEXT_PUBLIC_SENTRY_DSN` at build time, see `src/lib/monitoring.ts`. The SDK is loaded only then; the error boundary reports what it catches.

Nothing personal or secret is sent:

- `send_default_pii` is off.
- Request bodies, cookies, auth and signature headers and query strings are dropped.
- The user is reduced to their id.
- Anything shaped like a provider key (`sk-…`, `AIza…`, `nvapi-…`), a Razorpay key or secret, a Fernet token or a bearer token is replaced with `[redacted]`, in messages, exceptions, breadcrumbs and extras.
- Errors only by default; traces are off.

The free Sentry plan (5k errors a month) is plenty for testers. Make one project for the backend (Python / FastAPI) and one for the frontend (Browser JavaScript).

## Installable app (PWA)

- `app/manifest.ts` is served at `/manifest.webmanifest`. It sets the name, `start_url /study`, `display: standalone`, the theme colour, shortcuts (Study, Daily review, Arena) and icons in `public/icons/`: 192, 512, maskable 512 and the Apple touch icon.
- `public/sw.js` is registered in production builds only:
  - pages go to the network first and fall back to the cached `/offline` page;
  - `/_next/static`, `/icons` and `/sprites` are cache-first;
  - `/api` is **never** touched.
- `sw.js` is served `no-store`, so a new version reaches everyone on their next visit. Bump `CACHE` in `sw.js` to drop old caches.
- **Settings → App:** "Install app" when the browser offers it (Chrome, Edge, Android); otherwise the steps (address-bar install, or iPhone Share → Add to Home Screen).
- e2e runs block service workers (their fetches would bypass the API mocks), except `e2e/pwa.spec.ts`, which checks the manifest, the headers and the offline page.
