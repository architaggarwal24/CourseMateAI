# CourseMateAI

An AI study companion for students. Upload your course PDFs and get a tutor that answers from your own notes and
shows the page, quizzes, flashcards, notes, mock exams and a spaced-repetition review. A pixel-art game rewards the
studying: your champion levels up, and what you got wrong becomes boss fights.

Live: <https://coursemateai.architaggarwal.workers.dev>

## What it does

**Study**
- Chat with your PDFs: answers cite the page they came from
- Quizzes, flashcards and notes in six formats, written from your own material
- Daily spaced-repetition review (FSRS) and timed mock exams with a score report
- Courses (several PDFs studied together) and a concept map of how the ideas connect

**Hero world**
- Levels, coins, streaks, daily quests and achievements
- A side-view pixel fighting game: questions from your PDF become fights against 13 creatures, with 6 champions
- A shop, inventory, forge and mastery for each champion

**Public site**
- Free study tools that work without an account (flashcard maker, quiz generator, notes summarizer, revision planner)
- Chapter pages with summaries, flashcards and quizzes (each one checked by a person before it goes live)

Plans: Apprentice (free), Scholar ₹149, Sage ₹299 and Archmage ₹599 a month.

## Stack

- **Next.js 16** (App Router, React 19, TypeScript, Tailwind 4), deployed to **Cloudflare Workers** with OpenNext
- **Cloudflare:** D1 (SQLite, through Drizzle), R2 for PDFs, Vectorize and Workers AI for search and small jobs
- **Better Auth** for accounts (email codes, two-step sign-in, optional Google and GitHub)
- **AI:** Gemini, OpenAI, Anthropic, NVIDIA NIM or Ollama Cloud, routed per plan with fallbacks, metering, a daily spend cap and per-plan and per-user budgets that can't be passed
- **Payments:** Razorpay, off until `PAYMENTS_ENABLED` is set
- **Tests:** Vitest and Playwright (with axe accessibility checks), against a mocked API

## Run it locally

You need Node.js 22.

```bash
git clone https://github.com/architaggarwal24/CourseMateAI.git
cd CourseMateAI
npm ci
cp .dev.vars.example .dev.vars        # then fill in BETTER_AUTH_SECRET, OWNER_EMAIL and an AI key
npm run db:migrate:local              # creates the local database's tables
npm run dev                           # http://localhost:3000
```

On Windows PowerShell, use `Copy-Item .dev.vars.example .dev.vars` instead of `cp`.

**After every fresh clone, run `npm run db:migrate:local`.** The local database lives in `.wrangler/` (not in git),
so a new clone starts with an empty one, and every request fails with `no such table` until it is migrated. Run it
again whenever `migrations/` gets a new file.

`.dev.vars` holds your secrets and is never committed. `.dev.vars.example` explains every setting.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | the app on localhost:3000, with local D1 and R2 |
| `npm run check` | type check and all unit tests (run before pushing) |
| `npm run test:e2e` | Playwright tests (builds the app first) |
| `npm run db:migrate:local` | apply migrations to the local database |
| `npm run db:generate` | after changing `src/server/db/schema.ts`, write the next migration |
| `npm run cf:preview` | build with OpenNext and run it like Cloudflare does |
| `npm run cf:deploy` | build and deploy by hand (pushing to `main` does this automatically) |

## Deploying

Every push to `main` deploys to Cloudflare Workers through GitHub Actions (`.github/workflows/ci.yml`): it migrates
D1, builds with OpenNext, deploys, and tells search engines which pages changed. The one-time setup (database,
bucket, secrets) is in [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md).

## Project layout

```
src/app/                  routes: pages, layouts and API route files (thin; the work is in src/server)
src/components/<feature>/ components, one folder per feature (ui/ is the shared kit)
src/hooks/                React hooks and stores
src/lib/<feature>/        browser-side logic and the public site's content
src/server/<feature>/     the Worker: accounts, study tools, game, AI, search, database
e2e/                      Playwright tests and the mocked API
migrations/               D1 migrations
docs/                     guides (below)
```

## Docs

- [Deploying to Cloudflare](docs/deploy-cloudflare.md)
- [Payments](docs/payments.md)
- [Data recovery](docs/data-recovery.md)
- [SEO checklist](docs/seo-checklist.md), [reviewing chapter pages](docs/content-review.md) and [moving to your own domain](docs/domain-move.md)
- [Pixel sprites](docs/pixel-sprites.md)
- [Project context](docs/coursemateai-context.md): how it all fits together, for anyone new to the code

## License

All rights reserved. This code is shared for viewing; it isn't licensed for reuse.
