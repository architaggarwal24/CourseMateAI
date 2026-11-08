# CourseMateAI: context for the next session

> Paste this file at the start of a new chat. It covers how the owner works, what the app is, the journey so far,
> where it stands now and the weak spots we know about.
> Last updated: 8 Nov 2026 (after the performance pass, stages P1 to P5).
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

**Hand-over rules (the owner's words, 8 Nov):**
- Never commit, push or ask about either. The owner commits and pushes, always.
- Deliver one zip with only the updated files, no extra files. With it: the commands to run (if any) and a
  "what to test" list.
- No unnecessary information: only what matters, short, in simple language.
- **Stages run back to back:** finish a stage, hand it over (zip, commands, what to test), then start the next one
  at once. Don't wait for input; keep going until the owner says stop.

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

8. **Performance pass (7 to 8 Nov).** Measured first (a Playwright harness, `perf/`, and a D1 round-trip counter),
   then:
   - P1 network: one GET /hud at start-up instead of three (none for a signed-out visitor), shared shop load, no
     duplicate API calls left; the first page paints from the server HTML (the 250 ms rise only on in-app moves); the
     login entrance is CSS, not motion.
   - P2 server: D1 round trips on the hot routes 141 -> 97 (session row reused, plan read once per request, review
     stats / queue, course progress and the concept map batched); exam answers and arena questions saved in one batch;
     HUD reads in parallel; a 10 s timeout on Resend.
   - P3 bundle: the command palette loads on idle or first use; Geist Mono subset (71 -> 40 KB) and not preloaded
     (fonts per page 176 -> 107 KB); highlighting carries 21 languages instead of 37; unused packages removed.
   - P4: skeletons keep their size (a class like h-[360px] used to lose to the 1rem default); courses load with the
     documents; `public/_headers` caches hashed build files for a year on Cloudflare; earlier chat answers are not
     re-parsed per streamed token; Web Vitals through Sentry (`NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`).
   - P5: quiz and exam keys bound before paint.

**Zip extract order for the redesign:** stages 1 to 4, then `redesign-fixes.zip`, then 5, then 6, then
`redesign-6-fix.zip`.

---

## 5. Where things stand

- The redesign is complete. The owner's last run: unit tests green after the QuizView fix, 252 e2e passed,
  the Cloudflare build completed.
- The Worker was last measured at **2.71 MB gzip** (limit 3 MB on the free plan).
- The performance pass is done: `perf-pass.zip` (or `perf-1` to `perf-6` in order); run
  `node scripts/remove-old-files.mjs` once (it deletes the empty `src/hooks/useApi.ts`) and `npm install` (packages
  changed). Worker after it: 2.72 MB gzip.
- **Admin AI (8 Nov):** Admin -> AI models sets the fast / strong / premium / small models for everyone (saved in
  D1 over the LLM_* settings); Settings -> AI -> Your model lets an admin try a model on their own requests first
  (Ollama only under `npm run dev`). Settings: the index stays put and only the sections scroll.
- **Bestiary (agreed 8 Nov; built: Stage 1 engine, Stage 2 book):**
  - A real book: painted, aged-paper look (an exception to the flat rule, for the book only); pages turn with the
    arrow keys or a mouse/finger drag.
  - 4 tiers. I: Minotaur, Cyclops, Oni, Kitsune. II: Naga, Rakshasa, Sphinx, Fenrir. III: Hydra, Kraken, Ammit.
    IV: Simurgh, Jörmungandr. Beating any 2 in a tier opens the next. Higher tiers: more HP, shorter timers, harsher
    abilities. Locked creatures are dark silhouettes.
  - A topic whose creature is locked gets the closest unlocked creature; the locked page teases it.
  - Each page: art, lore (the myth plus real facts), weakness, tactics, battle record, concepts it tested you on.
  - Weakness = a move combo. A clue shows first; finding the combo yourself gives an achievement and a bonus; after
    the first win the combo is written in for good, and using it in a fight gives a bonus (stagger, extra damage).
  - Rewards: first defeat (page + XP/coins by tier), weakness found alone (achievement + bonus), mastery per
    creature (bronze 1 win, silver 5, gold flawless or nightmare: a creature-themed skin), tier finished (a champion).
  - From God of War's Codex (2018, Ragnarök; read on the GoW wiki): entries are written in a character's voice
    (Atreus: curious, his mother's stories; Mimir in Ragnarök: dry, scholarly asides) with a sketch, then two short
    tactics lines naming the counter ("disrupt the haymaker for an opening"). Ragnarök adds notes in two voices
    (Kratos and Atreus) and variant entries of one creature family. For us:
    - a Scribe voice for the lore, plus a margin note in your current champion's voice;
    - variants: each creature gains a harder form at higher tiers (e.g. Elder Hydra), as a sub-page;
    - tactics: two lines, one of them the weakness clue;
    - lost pages: extra lore pages found through quests and rewards.
- **Champions (agreed 8 Nov; built in Stage 3):** Kaien free; finishing Bestiary tiers I-IV unlocks Asha, Brak, Mira, Vex;
  Thorne at level 25; each unlock is a ceremony with a reward; anyone who already picked a champion keeps it.
  A champion using their own mastery weapon gets exclusive attack/ultimate animations, one small perk and a KO
  finisher.
- **Quests (agreed 8 Nov; built in Stage 4):** quests are sealed scrolls; "Answer the call" opens the exact place; done = the seal
  breaks and the reward is claimed. Keep the daily quests and add Hunts (Bestiary; rewards include lost pages),
  weekly trials and a short story quest per champion.
- **Build order:** 1 Bestiary engine (tiers, unlocks, stand-ins, records, weakness combos, rewards) -> 2 the book
  -> 3 champions (locks, ceremonies, weapons, finishers) -> 4 quests (scrolls, hunts, trials, champion quests).
- **How Stage 3 works:** `server/game/roster.ts` (rules, `champion_unlocks` table, migration 0010 keeps every
  champion already picked or fought with). "Finished" = every creature of the tier beaten; Ammit (Nemesis) does not
  count. Unlocks are written after the winning fight (`result.champions_unlocked`) and also lazily on
  GET /avatar/champion (Thorne's level). The ceremony (`ChampionCeremony`) shows on Hero tabs except the arena (there
  the result panel has "Meet ..."); POST /avatar/champion/celebrate pays once. Signature weapon = the champion's own
  level-10 mastery weapon worn: perk in `kits.ts SIGNATURES`, animations + finisher beat in `lib/pixel/fight.ts`.
  CSS gotcha: use `--color-text` / `--color-text-secondary`, not `--color-fg*` (those resolve at :root and ignore the
  dark Play scope inside modals).
- **How Stage 4 works:** `server/game/scrolls.ts` + `quest_scrolls` table (migration 0011, which also adds
  `bestiary_records.lost_page`). Daily quests stay in `daily_quests` (claim unchanged). Weekly trials: 3 per ISO week,
  picked from the user id + week (no randomness, so no duplicates). Hunts: up to 2 at once, first defeats then Elder
  (nightmare) forms; claiming one finds the creature's lost page (`LOST_PAGES` in lib/bestiary/content.ts, shown in
  the book). Story: 3 chapters per champion, for the champion you fight as. Every scroll moves by an `event` string
  (`scrollEvent`): actions from `questsOnAction`, fight events from `arena.end` (`fightEvents`), banes from resolve.
  UI: `components/hero/QuestsTab.tsx` + `QuestScroll.tsx` (seal splits on claim); links in `lib/quests/board.ts`.
- **Round 5 (8 Nov):** arena tab shows only modes + champions; sidebar has one "Hero" link (the Hero tab bar holds
  the rest); owner-only XP/coin grants (Admin → Manage → XP and coins; `server/admin.ts grantGame`, kind
  "admin_grant", minus takes away to zero). Bestiary book: IM Fell types (`src/fonts/tome.ts`), worn/torn paper
  (`tornEdge` clip-path per page), curled 3D turns (leaf = 10 hinged strips moved by rAF outside React; strips use a
  lighter paper background because the grain is costly to repaint), contents jump = a stack of up to 5 leaves.
  Hero pixel UI: `components/hero/pixel-ui.css` + play tokens (indigo panels, 0 radius, hard shadows, steps()
  motion, Press Start 2P labels, Pixelify Sans body; fonts given by AppShell's play ThemeScope). The last verdict
  waits 6 s (`AUTO_ADVANCE_MS.over`) so the KO/finisher plays.
- Nothing is in progress (all 4 hero stages delivered). Ideas waiting in the backlog: chiptune sound, sharing a KO clip, campaign mode, more inputs
  (YouTube, slides, OCR), ghost duels and other multiplayer, teacher mode.

---

## 6. Weak spots we know about

From this work only; nobody has gone looking for more.

**Tests**
- **Key-press tests can flake under load.** Tests retry until the result shows. The quiz and exam now bind their keys
  in a layout effect (before paint), which removes the main cause; other screens still bind in effects.
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

- **Speed on a slow phone is bound by the sign-in check.** Every app screen waits for the JS, then /auth/me (and the
  HUD in parallel), before it shows content (about 5 s on "fast 3G" with 4x CPU). The next big win is rendering the
  shell and the screen's skeleton without waiting for /auth/me, or checking the session on the server.
- **Small layout shifts remain** (measured on 3G): the course overview ~0.13 (the header changes when the course
  arrives), the admin page 0.045, Today and Champion ~0.04. All but the course are under the 0.1 "good" line.

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
- **Local settings:** `.dev.vars` values reach `process.env` through `getEnv()` (`fillProcessEnv`); `.env.local` wins
  when both set a key. Before this, OWNER_EMAIL from `.dev.vars` never applied under `npm run dev`.
- **Query budgets:** `src/server/queries.test.ts` counts D1 round trips on 20 hot routes. A change that adds one fails
  there; lower the number if you remove one. Batch independent reads with `ctx.db.batch([...])` (one round trip; one
  statement per row for writes: D1 allows 100 bound parameters per statement). `tierFor` is cached per request: call
  `forgetTier` after changing a plan in the same request.
- **Measure speed:** `npm run build`, then `npx playwright test -c playwright.perf.config.ts` (add `PERF_THROTTLE=1`
  for 3G and a slow CPU; `PERF_LABEL=name` names the file in `perf/results/`). Kill a stale `next-server` first.
- `Skeleton`: size it with a Tailwind class or the height prop; `perf.test.ts` guards fonts, the login entrance and
  `public/_headers` (static files on Cloudflare never get next.config.ts headers).
