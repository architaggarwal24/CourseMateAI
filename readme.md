<div align="center">

# 📚 CourseMateAI

**Your AI-powered study companion — with RPG progression, a battle arena, and a customizable avatar.**

Upload a PDF. Chat with it, generate quizzes, flashcards, and notes. Earn XP, level up, unlock gear, and defeat knowledge bosses.

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19.3-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Tailwind](https://img.shields.io/badge/Tailwind-4.3-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

</div>

---

## ✨ What is CourseMateAI?

CourseMateAI turns your study documents into an interactive learning experience. Upload any PDF, then use AI to extract knowledge through conversation, quizzes, flashcards, and structured notes — all while a Habitica-style RPG system rewards your progress.

**Study smarter. Level up. Build your scholar.**

---

## 🎮 Features at a Glance

### 📖 Study Modes

| Mode | What it does |
|---|---|
| **Chat** | Ask anything about your PDF — get context-aware answers with follow-up suggestions |
| **Quiz** | Generate MCQ, True/False, or Mixed quizzes on any topic from your document |
| **Flashcards** | Spaced-repetition cards with flip animation — mark correct/wrong and drill missed ones |
| **Notes** | AI-generated structured study notes at Normal or Exam-Ready detail level |
| **Arena** | Tactical boss battles, a Nemesis built from your mistakes, and a roguelite Expedition through your PDF |

### ⚔️ Battle Arena (v2 — see [docs/arena-v2.md](docs/arena-v2.md))

- **Pixel fighting-game stage** — pick one of six original champions and face one of 13 mythic creatures (Hydra,
  Minotaur, Fenrir, Kitsune, Sphinx, Kraken…) on its home stage, side-view with dashes, sparks, KO and banners.
  All art is drawn by code; real sprite sheets can be dropped in ([docs/pixel-sprites.md](docs/pixel-sprites.md))
- **Instant summons** — your topic picks the creature at once; the AI writes its lines in the background
- **Tactical turns** — every turn the boss telegraphs its intent (Attack, Heavy, Shield, Drain, Heal); you pick a move
  (**Strike · Jab · Heavy · Guard**, keys Q W E R) that asks an easier or harder question for more or less damage
- **Focus** — built by right answers, spent on Heavy blows and spells (**Insight** 50/50, **Timewarp** +15s)
- **Nemesis** — a boss made from the concepts you keep missing in quizzes, flashcards and the arena
- **Expedition** — a roguelite run: 3 acts from your document, branching maps, rests, shops, treasure, 12 relics, one life
- **Study scrolls** — every missed question becomes a review flashcard (no AI call)
- Four difficulties, rage phase, weakness hits, gear bonuses, weekly global leaderboard + per-topic boards
- Server-authoritative: the server grades, keeps the clock and pays rewards exactly once

### 🎨 Interface

- Two themes from one token set: **Study** ("graphite glass" — calm premium SaaS) and **Play** ("arcane glass" — the game layer)
- Frosted-glass panels over an aurora backdrop, pointer-lit cards, reactive buttons (sheen, spring press, ripple, sparks)
- ⌘K command palette, animated tabs, a pixel-art fight stage, page transitions — all of it calmed under *Reduce motion*
- WCAG AA contrast enforced by tests; axe, keyboard and 360px e2e checks on every screen

### 🏆 RPG Progression (Habitica-style)

- **XP & Levels** — every study action earns XP with tier multipliers that scale as you grow
- **Coins** — earned through study, spent in the shop on gear and consumables
- **Streak system** — daily activity streak with automatic Streak Shields to protect your chain
- **Daily quests** — tiered quests that unlock and scale with your level
- **Achievements** — 19 achievements across Common → Legendary tiers, each with a progress bar
- **Active buffs** — XP boosts, coin boosts, with live countdown timers in the sidebar

### 🛍️ Shop & Avatar

- Armor, headgear, weapons, pets, and prestige titles — each with passive stat bonuses
- Consumables: health potions, XP elixirs, coin boosts, Streak Shields, Veil of Duality (50/50)
- **Hero Forge** — full pixel-art avatar customization (skin, hair, body type, outfit)
- Equipment syncs across the shop, inventory, and Battle Arena

---

## 🗂️ Project Structure

```
CourseMateAI/
├── backend/                     # FastAPI Python backend
│   ├── main.py                  # All API endpoints (~50 routes)
│   ├── auth/                    # JWT authentication & middleware
│   ├── core_brains/             # LLM logic (chat, quiz, notes, flashcards, boss)
│   ├── rag/                     # PDF ingestion, FAISS vector store, embeddings
│   ├── services/
│   │   └── progression/         # XP, levels, quests, achievements, shop, buffs
│   ├── prompts/                 # Prompt templates for each study mode
│   ├── static/                  # arena.html + game.js (the Battle Arena)
│   └── database/                # SQLite (app.db for auth, progression.db for RPG)
│
└── frontend/                    # Next.js 16 + TypeScript frontend
    └── src/
        ├── app/                 # Next.js App Router pages
        ├── components/          # React components (ChatView, QuizView, ArenaView…)
        ├── hooks/               # useHUD — Zustand store for XP/coins/quests/buffs
        ├── lib/                 # api.ts, sessions.ts, pixelArt.ts
        └── contexts/            # AuthContext
```

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11**
- **Node.js 18+**
- An API key for **one** of the supported LLM providers (free options first):
  - [Google Gemini](https://aistudio.google.com/apikey) — free tier, recommended
  - [NVIDIA NIM](https://build.nvidia.com) — free open models
  - Any **OpenAI-compatible** service (OpenRouter, Groq, CodeCraft API, …)
  - [OpenAI](https://platform.openai.com) / [Anthropic Claude](https://console.anthropic.com) — paid
  - [Ollama](https://ollama.com) — local models, for development only (no key)

### 1. Clone & install

```bash
git clone https://github.com/yourusername/CourseMateAI.git
cd CourseMateAI
make install
```

### 2. Configure environment variables

```bash
Copy `backend/.env.example` to `backend/.env` (PowerShell: `Copy-Item backend/.env.example backend/.env`).

### Windows quick start

Use Python 3.11. From PowerShell:

```powershell
cd backend
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Fill JWT_SECRET and ENCRYPTION_KEY in .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

In a second PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.
```

Edit `backend/.env`:

```env
# Required — generate with: python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET=your_secret_here

# Required — generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=your_fernet_key_here
```

`frontend/.env.local` should contain:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Run

```bash
make dev
```

This starts both services in parallel:

- **Backend** → `http://localhost:8000`
- **Frontend** → `http://localhost:3000`

Open `http://localhost:3000`, register an account, enter your LLM provider API key in **Settings → AI Provider**, and you're ready.

> **Full setup instructions, Docker guide, and deployment notes are in [setup.md](setup.md).**

---

## 🤖 Supported LLM Providers

CourseMateAI is **provider-agnostic** — each user stores their own API key, encrypted at rest with `ENCRYPTION_KEY`. The key is decrypted in server memory only for the duration of a request, and is never returned to the browser.

| Provider | Cost | Built-in models |
|---|---|---|
| **Google Gemini** | Free tier | `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` |
| **NVIDIA NIM** | Free tier (~40 req/min) | `meta/llama-3.3-70b-instruct`, `nvidia/llama-3.3-nemotron-super-49b-v1.5`, `nvidia/nemotron-3-super-120b-a12b`, `qwen/qwen3.5-122b-a10b`, `openai/gpt-oss-20b` |
| **OpenAI-compatible** | Depends on the service | You enter the base URL (e.g. `https://codecraftapi.com/v1`), key and model id |
| **OpenAI** | Paid | `gpt-5.4-nano`, `gpt-5.4-mini` |
| **Anthropic Claude** | Paid | `claude-haiku-4-5-20251001`, `claude-sonnet-5-5` |
| **Ollama (local)** | Free, runs on your machine | `llama3.2:3b`, `qwen3:8b`, `gemma3:4b`, … — **development only** |

Every provider also has a **Custom model…** option: type any model id the provider supports
(including paid ones) and it is billed to your own key. The catalogue lives in one file,
`backend/providers.py`; the signup and Settings pickers are generated from it via `GET /providers`.
Model lists were checked against each provider's pricing page on 2026-10-02 — if one starts
returning 404, update it there or use a custom model.

Keys are encrypted with Fernet symmetric encryption before being stored in SQLite.

---

## 🗄️ Tech Stack

### Backend
- **FastAPI** — async REST API with Pydantic validation and slowapi rate limiting
- **LangChain** — LLM orchestration, prompt management, document processing
- **FAISS** — local vector store for PDF similarity search (no cloud dependency)
- **sentence-transformers** — local `BAAI/bge-large-en-v1.5` embeddings (no API key needed for RAG; ~1.3 GB model, downloaded once)
- **SQLite** — two databases: `app.db` (users/auth) and `progression.db` (RPG data)
- **bcrypt + PyJWT** — password hashing and session tokens via HttpOnly cookies

### Frontend
- **Next.js 16** (App Router) — React 18 with TypeScript
- **Zustand** — global HUD state (XP, coins, quests, buffs)
- **Tailwind CSS** — utility-first styling with a custom dark retro theme
- **react-markdown + KaTeX** — rich Markdown and math rendering
- **sonner** — toast notifications

### RAG Pipeline

```
PDF Upload → PyPDF text extraction → LangChain text splitter
→ sentence-transformers embeddings → FAISS index stored to disk
→ similarity_search() retrieves top-k chunks per user query
→ chunks injected into LLM prompt as context
```

---

## 🏅 Achievements

19 achievements across 4 tiers:

| Tier | Examples |
|---|---|
| 🩶 **Common** | First Steps, Getting Started, Boss Hunter, Shop Unlocked |
| 💙 **Rare** | Quiz Veteran, Week Warrior, Fortnight Scholar, Monster Slayer, Sharp Mind |
| 💜 **Epic** | Quiz Master, Dragon Bane, Rising Scholar, Nightmare Survivor |
| 🧡 **Legendary** | Monthly Legend, Boss Destroyer, Grand Scholar, Nightmare Champion |

Each achievement grants XP, coins, and optionally a cosmetic badge reward unlocked in your inventory.

---

## 🐳 Docker

```bash
docker compose up --build
```

Both services start automatically. The backend health-check endpoint is at `GET /health`. See [setup.md](setup.md) for production environment variables and reverse-proxy configuration.

---

## 📄 License

MIT — do whatever you want, just keep the attribution.

---

<div align="center">
Built with 🧠 for students who actually want to study.
</div>
