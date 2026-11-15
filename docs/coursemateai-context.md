# CourseMateAI: context for the next session

> Paste this file at the start of a new chat. It covers how the owner works, what the app is, what has been built,
> and what's left (the top 5 first). Deep detail lives in the code comments and the other files in `docs/`.
> Last updated: 15 Nov 2026 (after the SEO pass: stages 1, 3 and 4 built, stage 2 prepared).

---

## 1. How the owner works (read this first)

**Who:** Archit Aggarwal, building CourseMateAI alone. Windows, PowerShell, project at `C:\Archit\Projects\CourseMateAI`,
code on GitHub, deployed by GitHub Actions on every push to `main`.

**Rules:**

1. **Ask first.** Before real work, ask scope questions as multiple choice (AskUserQuestion), each option explained,
   the recommended one first. "Show them all, I will choose" means build a live picker.
2. **Stages.** Split big work into numbered stages and run them back to back: finish one, hand it over, start the
   next. Stop only when the owner says so.
3. **TDD**, plus guard tests so a rule can't quietly be undone. **All suites green** before hand-over: `tsc`, vitest,
   Playwright, and `npm run cf:build` (Worker under 3 MB gzip).
4. **Hand-over:** one zip of only the changed files (paths from the project root) in `/mnt/user-data/outputs`, the
   commands to run (if any), and a short "what to test" list. Deleted files go into `scripts/remove-old-files.mjs`,
   because unzipping can't delete.
5. **Never commit or push, and never ask about it.** The owner always does that. When a stop hook asks, answer that
   the changes stay uncommitted because the owner handles all commits and pushes.
6. **Secrets** go only in Cloudflare secrets or `.dev.vars`: never in the repo, never in chat, never `NEXT_PUBLIC_`.
   The owner's email is for identification only; never send it to an outside service.

**Talking:**
- **Caveman mode** in chat (terse; fragments fine) until the owner says "stop caveman". Code, comments and docs stay
  in full, plain sentences.
- Errors in plain words: find the one real failure in a pasted log, say what broke, then the fix.
- "Fix this fast" = a small fix and a one-file zip, no new round of questions.
- Don't work around blocked fetches or proxies.

**Taste:**
- Study: flat, calm "Ink" look (no gradients, glass, blur or glow), sentence case. The highlighter is the one
  signature detail.
- Hero: pixel-art JRPG look, always dark. The pixel art is loved; keep it.
- **IP rule:** original characters only, never known ones, even when the owner's references show them.
- The owner invokes skills such as `/caveman`, `/superpowers-workflow`, `/ui-ux-pro-max`, `/unslop`, `/llm-council`.

---

## 2. What CourseMateAI is

An AI study companion with an RPG game layer, aimed at **launching to real students** (Indian school students, exam
aspirants, and college students anywhere). Live at <https://coursemateai.architaggarwal.workers.dev>.

- **Study** (inside courses: one per subject, holding its PDFs): a tutor chat that teaches and cites pages, quizzes
  (checked by a second AI pass), flashcards, notes in 6 formats, FSRS review, mock exams, a concept/mind map, focus
  mode. Study remembers each tool's session and keeps working in the background.
- **Hero:** a second world with its own frame. A pixel champion (6 originals, styles, skills, mounts, pets, forge,
  mastery), XP, coins, quests as sealed scrolls, achievements, a painted Bestiary book of 13 creatures in 4 tiers,
  and an arcade arena where questions from your PDFs become fights (combo, final move, Boss Rush, Survival,
  invasions, seasons).
- **Public site:** landing, feature pages, pricing, free tools that work without an account, CBSE chapter pages.
- **Plans:** Apprentice (free), Scholar ₹149, Sage ₹299, Archmage ₹599 a month. Invite codes grant plans; the
  `OWNER_EMAIL` account is always admin on Archmage. Payments (Razorpay) are off until `PAYMENTS_ENABLED`.
- **Sign-in:** email codes, two-step sign-in, optional Google and GitHub. Ages 12+, terms version recorded.

---

## 3. Stack

- One **Next.js 16.4** app (App Router, Turbopack, React 19, TypeScript, Tailwind 4) on **Cloudflare Workers** via
  OpenNext. This Next has breaking changes: read `node_modules/next/dist/docs/` before using an API (AGENTS.md).
- **Cloudflare:** D1 through Drizzle (22 migrations), R2 for PDFs, Vectorize + Workers AI, Cloudflare Email.
- **Better Auth** for accounts. **AI:** hand-written clients for Gemini, OpenAI, Anthropic, NVIDIA NIM and Ollama Cloud,
  routed per plan and job (fast / strong / premium / small, set in Admin), with fallbacks, metering and a daily
  spend cap.
- **Tests:** vitest (1,865 tests in 167 files, `src/**` only) and Playwright (29 specs) with axe, against a mocked
  API (`e2e/fixtures/api.ts`).
- **Layout:** `src/app` routes only (thin); `src/server/<feature>` the Worker; `src/components/<feature>`;
  `src/lib/<feature>` browser logic and public-site content; `src/hooks`; `e2e`; `migrations`; `docs`. Components
  PascalCase, hooks `useX.ts`, the rest kebab-case; tests sit beside their file.

---

## 4. What has been built (2026)

| When | Pass | In one line |
| --- | --- | --- |
| Oct | Phase 1–2 | Redesign, server-run tactical arena, then the pure-TypeScript pixel engine (champions, creatures, stages). |
| 3–5 Nov | Phase 3–4 | Avatar, creature mechanics, FSRS, exams, courses, citations, plans, PWA; the Python backend ported to the Worker and deleted. |
| 5–6 Nov | UX + Ink redesign | Command palette, Undo, idempotency keys; Ink look, logo, sidebar, Today as home. |
| 7–8 Nov | Performance P1–P5 | One /hud call, D1 round trips 141 → 97, lighter fonts and bundle, cached static files. |
| 7–8 Nov | Hero stages 1–7 | Bestiary engine and book, champion unlocks, quest scrolls, arena nav, admin grants, taunts, chest, chiptune sound. |
| 8–9 Nov | Round 7 | Study inside courses, the tutor that teaches, hardened quizzes, note formats, Ollama Cloud, the Scholar's desk Bestiary, study memory. |
| 8–10 Nov | Fixes | Security fixes, upload fixes, the "you've been upgraded" window, Google and GitHub sign-in. |
| 9 Nov | SEO P0–P1 | `metadataBase`, sitemap, robots, feature pages. |
| 11 Nov | Champions + forge | Redrawn champions, creatures, pets, look editor; styles, skills, mounts, forge, mastery. |
| 12 Nov | Restructure | Every file in its feature folder (`scripts/restructure.mjs`). |
| 12 Nov | Arcade arena, 7 stages | Questions made before the fight, enraged forms, combo, final move, continue, select + VS, Boss Rush, Survival, fidgets. |
| 12 Nov | Two worlds, 7 stages | Hero gets its own frame and sidebar, the portal, pause menu, Insight, invasions, focus mode, Adventurer card, seasons. |
| 12–13 Nov | Hero speed + phones | One shared sprite clock, fights upright on phones, slim Hero header. |
| 13–14 Nov | BreakingBreach, 6 stages | AI prompt-injection guard and canary, the Trash (30 days), terms gate and data export, faster start, Study and Hero unslop. |
| 13 Nov | Import-cycle fix | documents → trash → courses → documents made every API route 500; `import-cycles.test.ts` now forbids cycles. |
| 13 Nov | Hero UI pass | Only the best item per stat counts (`lib/game/bonuses.ts`), Profile page (`/adventurer`), item preview on the left panel, filter bars, pixel loader. |
| 14–15 Nov | SEO pass | See below. |

**The SEO pass (research doc: "CourseMateAI SEO Research and Plan", a Claude Doc):**
1. **Technical (done):** `siteJsonLd` (Organization, WebSite, WebApplication with INR offers), `lastModified` on every
   page, IndexNow (`scripts/indexnow.mjs`, key file in `public/`, a CI step after deploy).
2. **Domain move (prepared, waits on a domain):** `hostRedirects` in `src/lib/site-url.ts` + `next.config.ts`. Change
   `NEXT_PUBLIC_SITE_URL` in `ci.yml` and every workers.dev URL redirects (308) to the new domain. Steps:
   `docs/domain-move.md`.
3. **Free tools (done):** `/tools` (flashcard maker, quiz generator, notes summarizer, revision planner). No account:
   POST /api/v1/tools/run, 150–4,000 characters, 5 runs per visitor a day (`FREE_TOOL_RUNS_PER_IP`), 300 a day in
   all (`FREE_TOOL_RUNS_PER_DAY`), metered in the spend cap, guarded like every AI call.
4. **Chapter pages (built, not live):** `/cbse/class-10/science/...`, chapters 1–3 drafted (`src/lib/content/`).
   **The review rule:** a chapter is `noindex` and out of the sitemap until a person checks it and adds
   `reviewed: { by, on }` (`docs/content-review.md`).

Also on 15 Nov: `README.md` for GitHub, and a log hint when a D1 table is missing (`missingTableHint` in `server/http.ts`).

---

## 5. What's left

### The top 5 (in order)

1. **Test the real thing on production.** The tests use a mocked API, so real models, Vectorize search, embeddings
   and the free tools have never run in a test. Upload a PDF, chat, make a quiz and notes, and run each free tool on
   the live site.
2. **Decide the age rule.** The owner picked 12+ with no parental consent. Under India's DPDP Act everyone under 18 is
   a child, so this is a legal risk before real students sign up. Get advice, or add parental consent.
3. **Get a free domain and move to it** (SEO stage 2): follow `docs/domain-move.md`, then Search Console and Bing.
4. **Review chapters 1–3** against the NCERT textbook and add `reviewed`. That makes the first chapter pages indexable.
5. **Test Razorpay live** before turning on `PAYMENTS_ENABLED`; only the stub has ever run.

### SEO, after those
- Draft and review more chapters, a few a week (then other subjects and classes); improve pages with no impressions
  after about 8 weeks.
- Watch Search Console (Core Web Vitals, coverage) and Bing; submit the sitemap after the move.
- Backlinks and listings from the research doc (directories, student communities, the GitHub repo's About link).
- Update the README's live link and clone line (`github.com/<you>/...`) and choose a license (it says "All rights
  reserved" for now).

### Launch checklist
- Real-AI check, age rule, Razorpay live (top 5).
- Worker size: measure `npm run cf:build` after the SEO pass (last measured 2.72 MB gzip of 3 MB).
- Set the optional free-tool limits in Cloudflare if the defaults (5 per visitor, 300 a day) don't suit.

### Known weak spots
- **Tests:** key-press tests can flake under load; timing on the owner's Windows PC differs from the sandbox; dark mode
  is axe-checked at desktop width only.
- **Build:** small Worker headroom (any new dependency needs `cf:build`); OpenNext isn't fully happy on Windows (WSL
  is safer); `next start` warns about `output: standalone` during e2e (noise).
- **Speed:** on a slow phone, app screens still wait on the sign-in check; the course overview shifts ~0.13 when the
  course arrives.
- **Product:** review days are UTC while quests and streaks use local days; the concept map is built in one long
  request (Worker time limits); D1 has no transactions, so every "exactly once" step is a compare-and-set.
- **Code:** misleading leftover names (`--glass-*`, `.text-gradient`, `text-ink-gold`); `lib/api/generated/schema.d.ts`
  is kept by hand (a guard test checks every path has a route).
- **Local setup:** a fresh clone has an empty local database; run `npm run db:migrate:local` before `npm run dev`
  (the README says so).

### Backlog ideas (not started)
Sharing a KO clip, campaign mode, more inputs (YouTube, slides, OCR), ghost duels and other multiplayer, teacher mode.

---

## 6. Gotchas a new session needs

- **Builds need** `NEXT_PUBLIC_SITE_URL` (CI sets it). Run e2e against a production build (`npm run build`, then
  `next start`); `next dev` adds a dev button that breaks keyboard and axe tests.
- In the sandbox, Playwright needs
  `PW_CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium_headless_shell-1243/*/)chrome-headless-shell`. The full vitest
  run takes about 11 minutes there; run it in the background.
- **Guard tests:** `flat.test.ts` (no gradients, blur, coloured glows), `icons.test.tsx`, `study-screens.test.ts`,
  `kit-usage.test.ts`, `import-cycles.test.ts`, `queries.test.ts` (D1 round trips per hot route), `perf.test.ts`, the
  ban on `console.*` in server code (use `server/log.ts`), and the legal dates tied together (`lib/legal.ts`).
- Call `settle(page)` before every axe scan; never fade text with `opacity`.
- **Themes:** `html[data-mode]` light/dark; `[data-theme="play"]` is Hero. Use `--color-text*`, not `--color-fg*`.
- **A new route:** `api()` with `requireUser` / `requireAdmin` and `rateLimit()`; a POST that creates or spends is
  `idempotent(...)` and its client sends a key.
- **A new AI job:** `generate(...)` / `stream(...)` from `server/ai/run.ts` (quotas, fallbacks, metering, the cap and
  the injection guard come with it); document text goes through `fenceMaterial`. Tests fake models with
  `setLlmFactoryForTests`.
- **D1:** migrations only add (`npm run db:generate`); batch independent reads with `ctx.db.batch`; 100 bound
  parameters per statement.
- **SEO:** a page enters the sitemap only through `PUBLIC_PAGES` in `src/lib/site.ts`, with `pageMetadata`; pages that
  shouldn't be indexed use `NOINDEX`.
- **Pixel sprites share one clock** (`lib/pixel/ticker.ts`); never give a sprite its own animation loop. Looping CSS
  animations use only transform and opacity.
- **Local settings:** `.dev.vars` reaches `process.env` through `getEnv()`; `.env.local` wins when both set a key.
- After changing the logo, re-run `node scripts/brand-assets.mjs`.
