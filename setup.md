# 🛠️ CourseMateAI — Setup Guide

This guide covers every path: local development, Docker, and deploying to a server.

---

## Table of Contents

- [Local Development (Manual)](#local-development-manual)
- [Local Development (Docker)](#local-development-docker)
- [Environment Variables Reference](#environment-variables-reference)
- [Getting an API Key](#getting-an-api-key)
- [Generating Required Secrets](#generating-required-secrets)
- [First-Time Walk-through](#first-time-walk-through)
- [Deploying to a Server](#deploying-to-a-server)
- [Makefile Commands](#makefile-commands)
- [Troubleshooting](#troubleshooting)

---

## Local Development (Manual)

### Step 1 — Clone the repo

```bash
git clone https://github.com/yourusername/CourseMateAI.git
cd CourseMateAI
```

### Step 2 — Backend setup

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate          # Windows PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy and fill the env file:

```bash
cp .env.example .env
```

Open `backend/.env` and set at minimum:

```env
JWT_SECRET=<generate — see below>
ENCRYPTION_KEY=<generate — see below>
```

### Step 3 — Frontend setup

```bash
cd ../frontend
npm install
```

The repository includes `frontend/.env.local` for local development. If you need to recreate it, copy `frontend/.env.local.example` to `frontend/.env.local`.

### Step 4 — Run both services

**Option A — Makefile (recommended):**

```bash
# From the project root
make dev
```

This runs both services in parallel. Use `make backend` or `make frontend` to start them individually.

**Option B — Two terminals:**

Terminal 1 (backend):
```bash
cd backend
source venv/bin/activate          # Windows PowerShell: .\venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Terminal 2 (frontend):
```bash
cd frontend
npm run dev
```

### Step 5 — Open the app

Navigate to `http://localhost:3000`, register an account, and add your LLM API key in **Settings → AI Provider**.

---

## Local Development (Docker)

Docker Compose handles everything — no manual Python or Node setup required.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)

### Steps

```bash
# 1. Create the backend env file
cp backend/.env.example backend/.env
# Edit backend/.env and fill in JWT_SECRET and ENCRYPTION_KEY

# 2. Create the frontend env file
cp frontend/.env.local.example frontend/.env.local

# 3. Build and start
docker compose up --build
```

- **Backend** → `http://localhost:8000`
- **Frontend** → `http://localhost:3000`

To stop:

```bash
docker compose down
```

To wipe all data (databases, uploads):

```bash
docker compose down -v
```

---

## Environment Variables Reference

### `backend/.env`

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | ✅ Yes | Secret key for signing JWT tokens. Min 32 characters. |
| `ENCRYPTION_KEY` | ✅ Yes | Fernet key for encrypting user API keys at rest. The server refuses to start without it. |
| `ENABLE_OLLAMA` | No | `true` (default) shows the local-only Ollama provider. Set `false` for production. |
| `ALLOW_LOCAL_PROVIDERS` | No | `true` lets the OpenAI-compatible provider point at private/LAN addresses (e.g. LM Studio). Default `false` blocks them (SSRF protection). |
| `ALLOW_INSECURE_DEV_KEY` | No | Migration escape hatch only: set `true` once if existing users' keys were saved while `ENCRYPTION_KEY` was unset. Do not use in production. |
| `COURSEMATE_DATA_DIR` / `COURSEMATE_UPLOAD_DIR` | No | Override where the SQLite files / uploaded indexes live (used by the tests). |
| `MAX_SESSIONS_PER_USER` | No | Uploaded documents kept per user (default 10). Oldest is evicted first. |
| `ALLOWED_ORIGIN` | No | Production frontend URL (e.g. `https://yourdomain.com`). Added to CORS allowlist. |
| `COOKIE_SECURE` | No | Set to `true` in production (HTTPS only). Default: `false`. |
| `SESSION_EXPIRY_HOURS` | No | How long upload sessions stay in memory. Default: `24`. |
| `MAX_SESSIONS` | No | Max concurrent upload sessions. Default: `100`. |

### `frontend/.env.local`

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ Yes | Full URL of the backend API. |
| `NEXT_PUBLIC_BACKEND_URL` | No | Legacy alias for `NEXT_PUBLIC_API_URL` — both are read. |

---

## Getting an API Key

CourseMateAI requires an API key from your chosen LLM provider. You enter this in **Settings → AI Provider** after registering — it is encrypted and stored per-user, never shared.

| Provider | Where to get a key | Free tier? |
|---|---|---|
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | ✅ Generous free tier |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com/settings/api-keys) | ✅ Free (rate-limited), no card |
| **OpenAI-compatible** (OpenRouter, Groq, CodeCraft API, …) | the service's own dashboard | Depends on the service |
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | ❌ Pay-as-you-go |
| **Anthropic Claude** | [console.anthropic.com](https://console.anthropic.com) | ❌ Pay-as-you-go |
| **Ollama** (local) | [ollama.com/download](https://ollama.com/download) | ✅ No key — dev only |

> **Recommendation for getting started:** Google Gemini or NVIDIA NIM — both free and plenty for personal use.
>
> **Using Ollama locally:** install it, run `ollama serve`, then `ollama pull llama3.2:3b`. Pick "Ollama (local)" at signup — no key needed.
> Set `ENABLE_OLLAMA=false` in `backend/.env` before deploying so the option disappears.
>
> **After upgrading:** run `pip install -U -r requirements.txt` — newer Gemini/OpenAI models need the newer LangChain provider packages.
> Accounts saved with the removed Mistral provider will be asked to pick a new one in Settings → AI Provider.

---

## Generating Required Secrets

### JWT_SECRET

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Example output: `e6a169059217bb18d07b45e70b6be64655db4a3dd014a84512927df213502f71`

### ENCRYPTION_KEY

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Example output: `PSmIc6RyHUYps6ZOtOZA2BnVqxsThpoyiVNeij3_WbU=`

> ⚠️ **Keep these secret.** Never commit them to version control. If you rotate either key, existing user API keys stored in the database will no longer decrypt — users will need to re-enter their keys.

---

## First-Time Walk-through

After starting the app for the first time:

1. **Register** — go to `http://localhost:3000/login` and create an account with a username, email, and password.

2. **Add your API key** — open **Settings** (bottom-left of the sidebar) and enter your LLM provider API key. The backend validates the key against the provider before saving.

3. **Upload a PDF** — click the **Upload PDF** button in any study mode. Max file size is 50 MB. The file is processed into a FAISS vector index and stored in `backend/uploads/`.

4. **Start studying** — switch between Chat, Quiz, Flashcards, Notes, or Arena. Each action earns XP and advances your daily quests.

5. **Level up** — at Level 5 the shop unlocks. Visit **Shop** to browse gear with passive bonuses and consumables for the Battle Arena.

6. **Build your avatar** — go to your **Avatar** page and open **Hero Forge** to customize skin, hair, body type, and equipped gear. Your avatar appears in the Battle Arena.

---

## Deploying to a Server

### Requirements

- A server with Docker + Docker Compose, or Python 3.11 and Node 20+
- A domain name with HTTPS (required for `COOKIE_SECURE=true` and OAuth cookie policies)
- A reverse proxy (nginx or Caddy recommended)

### Environment changes for production

`backend/.env`:
```env
COOKIE_SECURE=true
ALLOWED_ORIGIN=https://yourdomain.com
```

`frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

### Example nginx config (reverse proxy)

```nginx
# Frontend
server {
    listen 443 ssl;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Backend API
server {
    listen 443 ssl;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 55M;  # allow PDF uploads
    }
}
```

### Persisting data with Docker

The `docker-compose.yml` mounts two volumes:

```yaml
volumes:
  - ./backend/data:/app/data        # SQLite databases
  - ./backend/uploads:/app/uploads  # PDF files and FAISS indices
```

Back up these two directories to preserve all user data.

### Building the frontend for production

```bash
cd frontend
npm run build
npm start           # or serve with PM2, Docker, etc.
```

---

## Makefile Commands

Run these from the project root:

| Command | What it does |
|---|---|
| `make dev` | Start backend + frontend in parallel |
| `make backend` | Start only the FastAPI backend |
| `make frontend` | Start only the Next.js frontend |
| `make install` | Install all Python and Node dependencies |
| `make test` | Run backend pytest suite |
| `make lint` | Run ruff linter on backend Python code |
| `make help` | List all available commands |

---

## Troubleshooting

### "JWT_SECRET environment variable is required but not set"

You haven't created `backend/.env`, or `JWT_SECRET` is empty. Follow [Generating Required Secrets](#generating-required-secrets) and add the value to `backend/.env`.

### "No API key configured" when using any study mode

You haven't added your LLM key yet. Go to **Settings → AI Provider** in the app and enter your key.

### "No document uploaded" when generating quizzes/notes/flashcards

You need to upload a PDF first. Click the **Upload PDF** button in the header of the current study mode. Each mode maintains its own session — uploading in Chat doesn't automatically make it available in Quiz.

### The Battle Arena opens but questions never load

This usually means the boss summon failed silently. Check:
1. Your API key is valid and has remaining quota
2. A PDF is uploaded for the current session
3. The backend terminal shows no error

### PDF upload succeeds but answers seem wrong / off-topic

The RAG pipeline does its best but accuracy depends on PDF quality. Try:
- A cleaner, text-based PDF (not a scanned image)
- A more specific topic in the input field
- Increasing `top_k` via the query parameter (default is 5)

### Port already in use

```bash
# Kill whatever is on port 8000 or 3000
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### HuggingFace model download takes forever on first run

The `BAAI/bge-large-en-v1.5` embedding model (~1.3 GB) is downloaded once and cached locally. The backend now starts downloading it in the background at boot, so the first upload no longer stalls. If you're behind a firewall, set `HF_ENDPOINT` or pre-download the model:

```bash
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-large-en-v1.5')"
```

---

*For feature requests or bug reports, open an issue on GitHub.*
