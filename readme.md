<div align="center">

# 📚 CourseMateAI

**Your AI-powered study companion — with RPG progression, a battle arena, and a customizable avatar.**

Upload a PDF. Chat with it, generate quizzes, flashcards, and notes. Earn XP, level up, unlock gear, and defeat knowledge bosses.

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ What is CourseMateAI?

CourseMateAI turns your study documents into an interactive learning experience. Upload any PDF, then use AI to extract knowledge through conversation, quizzes, flashcards, and structured notes — all grounded in your document through a fully local RAG pipeline.

**Study smarter. Level up. Build your scholar.**

---

## 🎮 Features at a Glance

### 📖 Study Modes

| Mode | What it does |
|---|---|
| **Chat** | Ask anything about your PDF — get context-aware answers with source references |
| **Quiz** | Generate MCQ, True/False, or Mixed quizzes on any topic from your document |
| **Flashcards** | Flip-card study with difficulty tracking and missed-card drilling |
| **Notes** | AI-generated structured study notes at Normal or Exam-Ready detail level |
| **Arena** | Battle knowledge bosses — answer questions correctly to deal damage |

### ⚔️ Battle Arena

- Summon a boss themed to any topic from your PDF
- Four difficulties: **Easy · Medium · Hard · Nightmare** (one heart — one mistake ends it)
- Phase-based combat with rage transitions and a mid-battle shop for potions and power-ups
- Personal best tracking, daily leaderboard, and ghost run comparisons
- Equipment bonuses (hint charges, health potions, 50/50 lifelines) carry into the arena

### 🏆 RPG Progression

- **XP & Levels** — every study action earns XP with tier multipliers that scale as you grow
- **Coins** — earned through study, spent in the shop on gear and consumables
- **Streak system** — daily activity streak with Streak Shield items to protect your chain
- **Daily quests** — three tiered quests per day that scale with your current level
- **Achievements** — 19 achievements across Common → Legendary tiers, each with a progress bar
- **Active buffs** — XP boosts and coin boosts with live countdown timers in the sidebar

### 🛍️ Shop & Avatar

- Equipment: armor, headgear, weapons, pets, and prestige titles — each with passive stat bonuses
- Consumables: health potions, XP elixirs, coin boosts, Streak Shields, Veil of Duality (50/50)
- **Hero Forge** — pixel-art avatar builder with skin tone, hair, body type, and outfit customization
- Equipment syncs between the shop, inventory, and Battle Arena

---

## 🗂️ Project Structure

```
CourseMateAI/
├── backend/                          # FastAPI Python backend
│   ├── main.py                       # All API endpoints (~50 routes)
│   ├── auth/                         # JWT authentication & middleware
│   ├── core_brains/                  # LLM logic (chat, quiz, notes, flashcards, boss)
│   ├── rag/                          # PDF ingestion, FAISS vector store, embeddings
│   ├── services/
│   │   ├── upload_service.py         # PDF validation, chunking, session management
│   │   ├── context_service.py        # Vector store retrieval and context validation
│   │   ├── session_service.py        # Session expiry and cleanup
│   │   ├── history_service.py        # Activity logging and pruning
│   │   └── progression/              # XP, levels, quests, achievements, shop, buffs
│   ├── prompts/                      # Prompt templates for each study mode
│   ├── static/                       # arena.html + game.js (the Battle Arena)
│   ├── utils/                        # File validation, context builder, input validators
│   └── database/                     # SQLite wrapper (app.db for auth)
│
└── frontend/                         # Next.js 16 + TypeScript frontend
    └── src/
        ├── app/                      # Next.js App Router pages
        ├── components/               # React components (ChatView, QuizView, ArenaView…)
        ├── hooks/                    # useHUD — Zustand store for XP/coins/quests/buffs
        ├── lib/                      # api.ts, sessions.ts, pixelArt.ts
        └── contexts/                 # AuthContext
```

---

## 🚀 Quick Start

For full setup instructions including Docker, environment variable reference, deployment, and troubleshooting, see [setup.md](setup.md).

### Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- An API key for **one** of the supported LLM providers:
  - [Mistral AI](https://console.mistral.ai) — free tier available
  - [OpenAI](https://platform.openai.com)
  - [Google Gemini](https://aistudio.google.com) — generous free tier
  - [Anthropic Claude](https://console.anthropic.com)

### 1. Clone & install

```bash
git clone https://github.com/yourusername/CourseMateAI.git
cd CourseMateAI
make install
```

### 2. Configure environment variables

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# Required — generate with: python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET=your_secret_here

# Required — generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=your_fernet_key_here
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Run

```bash
make dev
```

- **Backend** → `http://localhost:8000`
- **Frontend** → `http://localhost:3000`

Register an account, enter your LLM provider API key in **Settings → AI Provider**, upload a PDF, and start studying.

> **Full setup instructions, Docker guide, and deployment notes are in [setup.md](setup.md).**

---

## 🤖 Supported LLM Providers

CourseMateAI is **provider-agnostic** — each user stores their own encrypted API key. The backend never handles keys in plaintext.

| Provider | Default Model | Free Tier |
|---|---|---|
| **Mistral AI** | `mistral-large-2512` | ✅ Yes |
| **OpenAI** | `gpt-4o-mini` | ❌ Pay-as-you-go |
| **Google Gemini** | `gemini-1.5-flash` | ✅ Generous |
| **Anthropic Claude** | `claude-sonnet-4-6` | ❌ Pay-as-you-go |

Users can override the default model for their provider in Settings. Keys are encrypted with Fernet symmetric encryption before being stored.

---

## 🗄️ Tech Stack

### Backend
- **FastAPI** — async REST API with Pydantic validation and slowapi rate limiting
- **LangChain** — LLM orchestration, prompt management, document processing
- **FAISS** — local vector store for PDF similarity search, persisted to disk per session
- **BAAI/bge-large-en-v1.5** — local HuggingFace embedding model; runs entirely on CPU, no API key required
- **SQLite** — two databases: `app.db` (users/auth) and `progression.db` (RPG data)
- **bcrypt + PyJWT** — password hashing and session tokens via HttpOnly cookies
- **Fernet** — symmetric encryption for user API keys at rest

### Frontend
- **Next.js 16** (App Router) — React 18 with TypeScript
- **Zustand** — global HUD state (XP, coins, quests, buffs)
- **Tailwind CSS** — utility-first styling with a custom dark retro theme
- **react-markdown + KaTeX** — rich Markdown and math rendering
- **sonner** — toast notifications

### RAG Pipeline

```
PDF Upload → PyPDF text extraction → LangChain RecursiveCharacterTextSplitter
→ BAAI/bge-large-en-v1.5 embeddings → FAISS index saved to disk per session
→ similarity_search() retrieves top-k chunks per query
→ chunks injected into LLM prompt as grounding context
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

Each achievement grants XP, coins, and optionally a cosmetic item unlocked in your inventory.

---

## 🐳 Docker

```bash
docker compose up --build
```

Both services start automatically. Backend health check: `GET /health`. See [setup.md](setup.md) for production environment variables and reverse-proxy configuration.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
Built with 🧠 for students who actually want to study.
</div>
