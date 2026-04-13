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
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
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

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

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
source venv/bin/activate
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
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > frontend/.env.local

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
| `ENCRYPTION_KEY` | ✅ Yes | Fernet key for encrypting user API keys at rest. |
| `ALLOWED_ORIGIN` | No | Production frontend URL (e.g. `https://yourdomain.com`). Added to CORS allowlist. |
| `COOKIE_SECURE` | No | Set to `true` in production (HTTPS only). Default: `false`. |
| `SESSION_EXPIRY_HOURS` | No | How long upload sessions stay in memory. Default: `24`. |
| `MAX_SESSIONS` | No | Max concurrent upload sessions. Default: `100`. |

### `frontend/.env.local`

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ Yes | Full URL of the backend API. |

---

## Getting an API Key

CourseMateAI requires an API key from your chosen LLM provider. You enter this in **Settings → AI Provider** after registering — it is validated against the provider, then encrypted and stored per-user. It is never logged or transmitted in plaintext.

| Provider | Where to get a key | Free tier? |
|---|---|---|
| **Mistral AI** | [console.mistral.ai](https://console.mistral.ai) | ✅ Yes |
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | ❌ Pay-as-you-go |
| **Google Gemini** | [aistudio.google.com](https://aistudio.google.com) | ✅ Generous free tier |
| **Anthropic Claude** | [console.anthropic.com](https://console.anthropic.com) | ❌ Pay-as-you-go |

> **Recommendation for getting started:** Google Gemini or Mistral AI both have free tiers that are more than sufficient for personal use.

---

## Generating Required Secrets

Both secrets must be present before the server will start — it exits with a clear error if either is missing.

### JWT_SECRET

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### ENCRYPTION_KEY

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> ⚠️ **Keep these secret and never commit them to version control.** Once `ENCRYPTION_KEY` is set, it must never change — if it does, all stored user API keys become unreadable and users will need to re-enter them.

---

## First-Time Walk-through

After starting the app for the first time:

1. **Register** — go to `http://localhost:3000/login` and create an account with a username, email, and password.

2. **Add your API key** — open **Settings** (bottom-left of the sidebar) and enter your LLM provider API key. The backend validates the key against the provider before saving it.

3. **Upload a PDF** — click the **Upload PDF** button in any study mode. Max file size is 50 MB. The file is chunked and embedded into a FAISS vector index stored in `backend/uploads/`.

4. **Start studying** — switch between Chat, Quiz, Flashcards, Notes, or Arena. Each action earns XP and advances your daily quests.

5. **Level up** — the shop unlocks at Level 5. Visit **Shop** to browse gear with passive bonuses and consumables for the Battle Arena.

6. **Build your avatar** — go to your **Avatar** page and open **Hero Forge** to customize skin tone, hair, body type, and equipped gear. Your avatar appears in the Battle Arena.

---

## Deploying to a Server

### Requirements

- A server with Docker + Docker Compose, or Python 3.10+ and Node 18+
- A domain name with HTTPS (required for `COOKIE_SECURE=true`)
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
        client_max_body_size 55M;  # allow PDF uploads up to 50MB
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

You need to upload a PDF first. Click **Upload PDF** in the current study mode. Each mode maintains its own session — uploading in Chat does not automatically make the document available in Quiz or Notes.

### The Battle Arena opens but questions never load

The boss summon likely failed silently. Check:
1. Your API key is valid and has remaining quota
2. A PDF is uploaded in the current session
3. The backend terminal shows no error on the `/arena/boss` request

### PDF upload succeeds but answers seem off-topic

RAG accuracy depends on PDF quality. Try:
- A clean, text-based PDF rather than a scanned image
- A more specific topic in the input field
- Checking that the topic actually appears in your document

### Port already in use

```bash
# Kill whatever is on port 8000 or 3000
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### Embedding model download takes a while on first run

The `BAAI/bge-large-en-v1.5` model (~1.3 GB) is downloaded once on first use and cached locally by HuggingFace. To pre-download it before starting the server:

```bash
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-large-en-v1.5')"
```

If you're behind a firewall, set `HF_ENDPOINT` to a mirror before running this.

---

*For feature requests or bug reports, open an issue on GitHub.*
