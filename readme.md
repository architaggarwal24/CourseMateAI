<div align="center">

# 📚 CourseMateAI

**Your AI-powered study companion — with RPG progression, a battle arena, and a customizable avatar.**

Upload a PDF. Chat with it, generate quizzes, flashcards, and notes. Earn XP, level up, unlock gear, and defeat knowledge bosses.

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
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

### 🛍️ Shop & Champion

- **Your pixel champion is your avatar** — pick one of six champions in the **Champion** tab; it shows in the header,
  the sidebar menu, your profile, the shop, the inventory and the Battle Arena. The choice is saved on your account.
- **Champion skins** — outfits (palette skins), head pieces (circlets, hoods, helms, crowns, horns), weapon finishes
  with rarity glows, and pixel pets that idle beside your champion. One loadout fits all six champions.
- Skins and prestige titles carry passive study bonuses and arena gear (damage, hearts, time, pet strikes)
- Consumables: health potions, XP elixirs, coin boosts, Streak Shields, Veil of Duality (50/50)

---

## 🗂️ Project Structure

```
CourseMateAI/
├── .github/workflows/ci.yml     # type check, tests, build; pushes to main deploy to Cloudflare
├── docs/                        # deploy-cloudflare.md, payments.md, plans.md, security.md, …
└── frontend/                    # the whole app: Next.js 16 on a Cloudflare Worker (OpenNext)
    ├── migrations/              # D1 (SQLite) migrations, applied on every deploy
    ├── wrangler.jsonc           # the Worker and its bindings: D1, R2, Workers AI, Vectorize
    └── src/
        ├── app/                 # pages, and the API under app/api/v1/…
        ├── server/              # the server: accounts, documents + search, AI, study tools, the game, billing
        ├── components/          # React UI
        └── lib/                 # client-side API calls, the pixel engine, routes
```

---

## 🚀 Quick Start

You need **Node.js 22**. Everything else (database, files, search, AI) is Cloudflare, run locally by wrangler.

```powershell
cd frontend
npm ci
Copy-Item .dev.vars.example .dev.vars   # fill BETTER_AUTH_SECRET (32+ chars) and OWNER_EMAIL
npm run db:migrate:local
npm run dev
```

Open `http://localhost:3000` and sign up with your `OWNER_EMAIL`: that account is the admin, on the top plan.

To put it online, follow **[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)**: create the D1 database and R2 bucket once, add two GitHub secrets, and every push to `main` deploys.

---

## 🤖 AI

The server holds the AI keys; students never enter one. Three slots, each `provider:model`:

| Slot | Used for | Example |
|---|---|---|
| `LLM_FAST` | chat, small jobs | `gemini:gemini-3.5-flash-lite` |
| `LLM_STRONG` | quizzes, exams, arena questions | `gemini:gemini-3.8-flash` |
| `LLM_PREMIUM` | top plans | `claude:claude-sonnet-5-5` |

Providers: Gemini, OpenAI, Claude, NVIDIA. With no keys at all, Workers AI answers. A daily dollar cap (Admin → AI spend) stops runaway costs. Details: [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) "AI" and [docs/model-routing.md](docs/model-routing.md).

---

## 🗄️ Tech Stack

- **Next.js 16** (App Router), React 19, TypeScript, Tailwind 4, Zustand
- **Cloudflare Workers** via OpenNext: one Worker serves the pages and the API
- **D1** (SQLite) with Drizzle; **R2** for PDFs; **Vectorize** + **Workers AI** embeddings for search
- **Better Auth** for accounts (email codes, Google sign-in, two-step)
- **Razorpay** subscriptions (off unless enabled: [docs/payments.md](docs/payments.md))
- **Vitest** and **Playwright** (with axe) for tests

### Search pipeline

```
PDF upload → R2 → text per page → chunks → Workers AI embeddings → Vectorize (per user)
→ the top chunks for each question go into the prompt, with page-linked citations
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

## 📄 License

MIT — do whatever you want, just keep the attribution.

---

<div align="center">
Built with 🧠 for students who actually want to study.
</div>

Policy pages: [Terms](frontend/src/app/legal/terms/page.tsx), [Privacy](frontend/src/app/legal/privacy/page.tsx), [Refunds](frontend/src/app/legal/refunds/page.tsx) (served at `/legal/…`).
