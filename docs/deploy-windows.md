# Testers on your Windows PC through a Cloudflare Tunnel (Phase 3, Stage 4e)

Your PC runs everything: the backend (FastAPI), the frontend (Next.js, production build), Ollama for small AI jobs, and `cloudflared`. Cloudflared gives the app a public https address without opening ports on your router.

```
browser ── https://study.example.com ── Cloudflare ── tunnel ── cloudflared (your PC)
                                                                 ├─ /api/*  → backend   127.0.0.1:8000
                                                                 └─ the rest → frontend 127.0.0.1:3000
```

There is one hostname, so the login cookie is first-party and there is no CORS. `/api` goes straight to the backend, so long AI answers and payment webhooks skip the Next.js hop.

## What you need

| | |
|---|---|
| Windows 10/11, 8 GB RAM or more (16 GB with Ollama `qwen3:8b`) | |
| **Python 3.13** | python.org; tick *Add python.exe to PATH* |
| **Node.js 22 LTS** | nodejs.org |
| **cloudflared** | `winget install --id Cloudflare.cloudflared` |
| **Ollama** (optional) | ollama.com/download; small jobs (boss lines, follow-up rewrites) run on it free |
| A domain on Cloudflare (free plan) | only for a fixed address; without one use `start.ps1 -Quick` |
| A server AI key | e.g. `GOOGLE_API_KEY` from Google AI Studio, so testers need no key of their own |

## Steps (PowerShell, from the project folder)

PowerShell may block scripts at first. Allow scripts for your user, once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

1. **Setup** (once; safe to run again):
   ```powershell
   .\deploy\windows\setup.ps1 -Hostname study.example.com
   ```
   This checks the tools, creates `backend\.venv`, installs the packages, writes `backend\.env` from `deploy\windows\backend.env.example` with fresh `JWT_SECRET` / `ENCRYPTION_KEY`, and pulls the Ollama model.
2. **Fill in `backend\.env`**: your `GOOGLE_API_KEY` (or another key), and check `LLM_FAST` / `LLM_STRONG` / `LOCAL_LLM`. **Copy the file somewhere safe**: without `ENCRYPTION_KEY`, saved API keys can't be read.
3. **Build** (after every update too):
   ```powershell
   .\deploy\windows\build.ps1
   ```
4. **The tunnel** (once):
   ```powershell
   .\deploy\windows\tunnel.ps1 -Hostname study.example.com
   ```
   A browser opens: pick your domain. The script creates the tunnel `coursemate`, the DNS record and `deploy\windows\cloudflared.yml`.
5. **Start**:
   ```powershell
   .\deploy\windows\start.ps1          # your hostname
   .\deploy\windows\start.ps1 -Quick   # or: a temporary https://*.trycloudflare.com address, no domain needed
   ```
   It starts Ollama (if used), the backend, the frontend and the tunnel in the background. Logs go to `logs\`. It waits until each answers.
6. **Invite testers:**
   ```powershell
   cd backend
   .\.venv\Scripts\python.exe scripts\admin.py invite create --tier sage --days 30 --uses 20 --note "first testers"
   ```
   Send them the address and the code. Sign-up asks for it (`INVITE_ONLY=1`).
7. **Stop:** `.\deploy\windows\stop.ps1`. **Back up:** `.\deploy\windows\backup.ps1` (add `-Schedule` once for a daily 03:15 task).

## Keeping it up

- **Updating:** stop, unzip the new files, run `node frontend\scripts\remove-old-files.mjs` if the stage removed files, run `setup.ps1` again (new packages), then `build.ps1` and `start.ps1`. Database migrations apply at start.
- **Start with Windows:** Task Scheduler → *Create Task* → trigger *At log on* → action `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<project>\deploy\windows\start.ps1"`.
- **Sleep:** the PC must stay awake. Set Power → *Sleep: Never* while testers are on.
- **Watching:**
  - `logs\backend.log.err` has the server's JSON log lines.
  - `python scripts\admin.py costs` shows the AI cost per model.
  - Account → Plan & usage shows any user's own use.

## What the template sets (backend.env.example)

| Setting | Why |
|---|---|
| `ALLOWED_ORIGIN=https://<host>`, `COOKIE_SECURE=true` | the tunnel is https; the cookie is Secure |
| `DEFAULT_TIER=apprentice`, `INVITE_ONLY=1` | testers join with a code that grants their plan |
| `LLM_FAST`, `LLM_STRONG`, `LOCAL_LLM=ollama:qwen3:8b`, `ENABLE_OLLAMA=false` | the server's AI; Ollama for small jobs, but users can't pick your Ollama as their own provider |
| `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5` | about 130 MB and quick on a CPU (changing it later asks users to re-upload) |
| `PAYMENTS_ENABLED=0` | until Razorpay is set up (docs/payments.md) |

## Things to know

- **Cloudflare waits at most 100 s for an answer.** Streamed chat is fine. A quiz or exam from a slow reasoning model can hit the limit (error 524), so prefer fast non-reasoning models for `LLM_FAST` / `LLM_STRONG`.
- **One backend process.** The login throttle, background map builds and caches live in memory. Don't add `--workers`.
- **Your PC's IP stays private.** Visitors only ever reach Cloudflare. The backend sees their real address through the tunnel's `X-Forwarded-For` (trusted only from this PC).
- **The scripts haven't been run on Windows yet.** They were written for PowerShell 5.1 / 7, and PowerShell wasn't available to run them while they were built. If one stops with an error, the message says what was missing; send it over.
