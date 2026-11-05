# CourseMateAI: context for the next session

> Paste this file at the start of a new chat. It covers how the owner works, what the app is, the journey so far,
> where it stands now and the weak spots we know about.
> Last updated: 6 Nov 2026 (after the Ink redesign, Stage 6 and its test fix).
> The long version (every stage in detail, the file map, all gotchas) is in `docs/archive/coursemateai-context-full.md`.

---

## 1. How the owner works (read this first)

**Who:** Archit Aggarwal, building CourseMateAI alone. Windows, PowerShell, project at `C:\Archit\Projects\CourseMateAI`.

**The working rules (the owner's own words: "ask me questions first; zips of changed files only, plus a "what to
test" checklist after each stage; deleted files go into remove-old-files.mjs; TDD; all suites green"):**

1. **Ask first.** Before building, ask scope questions as multiple choice (the AskUserQuestion tool), each option
   with a short explanation and a recommended pick. When the owner says "show them all, I will choose", build a
   live picker (we built a mix-and-match artifact for the redesign).
2. **Plan in stages.** Big work is split into numbered stages. The owner says when to start, pause or continue
   ("pause until I say so" means stop).
3. **TDD.** Write a failing test, then the fix. Add guard tests so a rule can't quietly be undone.
4. **All suites green** before handing over: `tsc`, vitest, the full Playwright e2e run, and the Worker build
   (`npm run cf:build`, under 3 MB gzip).
5. **Deliver a zip of only the changed files** (paths relative to the project root) in `/mnt/user-data/outputs`, plus:
   - PowerShell commands to extract and check (`Expand-Archive -Force ...`, `npm run check`, `npx playwright test`,
     `npm run cf:build`);
   - the **extract order** when zips build on each other;
   - a short **"what to test"** checklist.
6. **Deleted files** go into `scripts/remove-old-files.mjs`, because unzipping can't delete. Tell the owner to run it.
7. **Commit** each stage on `master` with the attribution lines the session gives.

**Communication:**
- **Caveman mode:** terse chat (fragments are fine). Code, commits and docs stay in normal, full sentences.
- **Plain language for errors.** Logs confuse the owner. Say what broke in plain words, then the fix. When they
  paste a long log, find the one real failure and ignore the noise (Wrangler warnings and "API error" lines from
  tests are normal).
- **"Fix this fast"** means a small, targeted fix and a one-file zip, not a new round of questions.
- The owner's email is for identification only; never send it to outside services.

**Taste and limits:**
- Design: flat, calm, minimal "Ink" look; no gradients, glass, blur or glow. Sentence case in the UI.
- The pixel art in the arena is loved ("perfect"); keep it.
- **IP rule:** only original characters. The owner's references showed known anime characters; we draw our own in
  that pixel-fighter style, never theirs.
- The owner invokes skills such as `/caveman`, `/superpowers-workflow`, `/ui-styling`, `/ui-ux-pro-max`, `/design`
  and `/design-system`. Use them when asked.

---

## 2. What CourseMateAI is

An AI study companion with an RPG game layer, aimed at **launching to real students** (paid plans in INR).

- **Study:** upload PDFs, then chat with page citations, quizzes, flashcards, notes, a spaced-repetition review
  queue (FSRS), mock exams, courses (several PDFs together) and a concept map.
- **Hero:** XP, coins, levels, streaks, daily quests, achievements, a shop of champion skins and pets.
- **Arena:** questions from your PDF become fights against 13 mythic creatures, drawn as a side-view pixel fighting
  game, with 6 original champions, creature mechanics, ultimates and a roguelite "Expedition".
- **Plans:** Apprentice (free), Scholar ₹149, Sage ₹299, Archmage ₹599 a month. Invite codes grant plans. The
  `OWNER_EMAIL` account is always admin and on Archmage.

---

## 3. Stack today

- **One Next.js 16.4 app** (App Router, Turbopack, React 19, TypeScript, Tailwind 4) deployed to **Cloudflare
  Workers through OpenNext**. No Python any more.
- **Cloudflare:** D1 (Drizzle), R2 (PDFs), Vectorize plus Workers AI (`bge-small` embeddings and the small model),
  Cloudflare Email. Better Auth for accounts (email codes, two-step sign-in, optional Google).
- **AI:** hand-written HTTPS clients for Gemini, OpenAI, Anthropic and NVIDIA NIM (no SDKs, to keep the Worker small).
  Routes per plan and job, fallbacks, metering, and a daily spend cap only the owner can change.
- **Payments:** Razorpay behind `PAYMENTS_ENABLED`, with a stub provider for tests.
- **Tests:** vitest (about 1,200 tests, 93 files) and Playwright (252 pass, the rest are skipped on purpose) with axe,
  keyboard, 360px, motion, light and dark, all against a mocked API (`e2e/fixtures/api.ts`).

---

## 4. The journey so far

Each step was a set of stages with zips and checklists. Dates are 2026.

1. **Phase 1: first redesign and Arena v2 (Oct).** Tailwind 4, React 19, Next 16; a glass design system; the study
   screens rebuilt; a server-authoritative tactical arena (moves, Focus, spells, Nemesis, Expedition, leaderboards).
2. **Phase 2: the pixel arena (30 Oct to 2 Nov).** The summon took 135 s and failed, so boss creation became instant
   (no AI call) with flavour added in the background. A pure-TypeScript pixel engine draws 6 original champions,
   13 creatures and 10 stages, plus the fight scene.
3. **Brainstorm (2 Nov).** Goal set to "launch to real students". Build order: avatar, arena, study, ship.
4. **Phase 3 (3 to 4 Nov).**
   - The pixel champion became the avatar everywhere; shop items became skins and pets.
   - Every creature got a signature mechanic; champions got passives, ultimates, levels and mastery skins.
   - Study power: FSRS review queue, mock exams, courses, page citations with a PDF viewer, the concept map.
   - Shipping: plans, quotas, invite codes, model routing, a quiz bank, Razorpay behind a flag, security hardening,
     PWA, Sentry.
5. **Phase 4: everything on Cloudflare (4 to 5 Nov).** The whole Python backend was ported to TypeScript route
   handlers on the Worker, area by area (auth, documents, AI and chat, study, game, arena, billing), then deleted.
   The app moved to the repo root. Policy pages were added (terms, privacy, refunds).
6. **UX details pass (5 Nov).** Delayed skeletons, a command palette (Ctrl K), Undo instead of "are you sure?",
   revalidation on focus, page transitions, phone bottom sheets, safe areas, idempotency keys on every POST that
   creates or spends.
7. **The Ink redesign (5 to 6 Nov).** The owner asked for the 20 UX laws applied, no gradients, a better icon pack,
   a new layout and a logo, chosen from options. Their picks:
   - layout: a sectioned sidebar that collapses to an icon rail; Today as the landing page;
   - surface "Ink" (pure black dark mode, white light mode, both with a toggle); accent: a darker ink blue;
   - fonts Bricolage Grotesque (headings) and Onest (text); Heroicons outline (Lucide at 1.5 stroke for gaps);
   - soft corners, compact density, the "Companion C" logo, the name "CourseMateAI" everywhere;
   - Hero: a darker Ink variant, always dark; the pixel arena kept as it is.

   The stages:
   1. **Ink foundation:** new tokens, light and dark modes, the fonts, effects retired, a guard test against
      gradients and blur.
   2. **Logo:** the mark, the wordmark, and every favicon, app icon and link-preview image generated from it.
   3. **Shell:** the sidebar (Study, Courses, Hero), Ctrl+B to collapse, the phone tab bar, grouped Study tabs.
   4. **Icons:** one icon module, Heroicons plus Lucide, with a guard test.
   - **Stage 1 fix and test robustness:** e2e pinned to light mode and normal motion, a `desktop-dark` project,
     a `settle()` helper before every axe scan, and no faded labels.
   5. **Today:** the landing page (review, continue, streak, quests, hero, PDFs, add a PDF).
   6. **Polish:** Hero only darkens the screen (not the sidebar); no coloured glows (guarded); visible progress
      tracks; Profile no longer duplicates the Settings form; tighter phone headers; empty chat opens at the top;
      sentence-case login wording. Then a fix for a flaky QuizView test.

**Zip extract order for the redesign:** stages 1 to 4, then `redesign-fixes.zip`, then 5, then 6, then
`redesign-6-fix.zip`.

---

## 5. Where things stand

- The redesign is complete. The owner's last run: unit tests green after the QuizView fix, 252 e2e passed,
  the Cloudflare build completed.
- The Worker was last measured at **2.71 MB gzip** (limit 3 MB on the free plan).
- Nothing is in progress. Ideas waiting in the backlog: chiptune sound, sharing a KO clip, campaign mode, more inputs
  (YouTube, slides, OCR), ghost duels and other multiplayer, teacher mode.

---

## 6. Weak spots we know about

From this work only; nobody has gone looking for more.

**Tests**
- **Key-press tests can flake under load.** The quiz and exam screens bind their key handlers in an effect, so a test
  that presses a key straight after rendering can land before the handler. Tests now retry until the result shows;
  the root cause (late binding) is still there.
- **Tests that pass here can fail on the owner's PC.** Timing differs between the sandbox and Windows; this caused most
  of the back-and-forth rounds.
- **e2e runs against a mocked API**, and Workers AI and Vectorize can't run locally, so real search, embeddings and
  model calls are never exercised by the test suites.
- **Dark mode is axe-checked at desktop width only**; dark on phones is skipped.

**Build and deploy**
- **Worker size headroom is small:** about 290 KB below the 3 MB gzip limit, and the redesign added about 60 KB.
  Any new dependency needs checking with `npm run cf:build`.
- **`metadataBase` is not set**, so link previews (the Open Graph image) point at `localhost:3000` until the real
  domain is configured.
- **OpenNext warns it is not fully compatible with Windows**; WSL is the safer way to build there.
- `next start` warns about `output: standalone` during e2e. It works, but it is noise.
- **Payments have never run against live Razorpay**; only the stub is tested.

**Product and code**
- **"Continue" on Today reads saved sessions from this browser** (localStorage), so it differs per device.
- **Review days are UTC** while quests and streaks follow the player's local day; a review near midnight can count
  for a different day than the quest it advances.
- **The concept map is built inside one long POST request.** A slow model risks the Worker's time limits.
- **D1 has no transactions:** every "exactly once" step is a compare-and-set. It is tested, but it is easy to get
  wrong in new code.
- **Leftover names from the old look:** `--glass-*` tokens are flat now; `.text-gradient` is plain colour; some
  `text-ink-gold` style classes remain. They work, but the names mislead.
- **`lib/api/generated/schema.d.ts` is kept by hand** since Python went; a guard test checks each path has a route.
- **On phones the Hero tabs scroll sideways**, so Champion and Achievements start off screen.
- The legal pages show the name as text, without the logo mark.

---

## 7. Gotchas a new session needs

- Run e2e against a production build (`npm run build`, then `next start`); `next dev` adds a dev button that breaks
  the keyboard and axe tests. Kill a stale `next start` by PID before rebuilding.
- In the sandbox, Playwright needs
  `PW_CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium_headless_shell-1243/*/)chrome-headless-shell`.
- Call `settle(page)` before every axe scan. Never fade text with `opacity`; use a muted colour token.
- Guard tests to respect: `flat.test.ts` (no gradients, blur or coloured glows; only the arena scene may glow),
  `icons.test.tsx` (import icons only from `@/components/icons`), `study-screens.test.ts` (list new Study screens),
  `ux-details.test.ts`, `kit-usage.test.ts` (kit components only), and the pixel font only through `ThemeScope`.
- Themes: `html[data-mode]` is light or dark (set before first paint); `[data-theme="play"]` is Hero, always dark.
  The app shell stays in the Study theme; only `<main>` turns Play in Hero.
- A new Worker route uses `api()` with `requireUser` / `requireAdmin` and `rateLimit()`. A POST that creates or spends
  is wrapped in `idempotent(...)`, and its client sends an idempotency key.
- A new AI job calls `generate(...)` or `stream(...)` from `src/server/ai/run.ts`; quotas, fallbacks, metering and
  the cap come with it. Tests fake models with `setLlmFactoryForTests`.
- D1 migrations only add, and are generated with `npm run db:generate`.
- Turbopack can't follow a symlinked `node_modules` in a git worktree; check the commit out directly instead.
- After changing the logo, re-run `node scripts/brand-assets.mjs`.
