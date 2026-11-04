# CourseMateAI: Project Context

> The single hand-off document for anyone (human or AI) picking up CourseMateAI.
> It covers what the app is, how it is built, everything done so far, the decisions taken, and what comes next.
> Last updated: 4 Nov 2026 (Phase 3, Stage 3A done).

---

## 1. What CourseMateAI is

An AI study companion with an RPG game layer.

- **Study side.** Students upload PDFs and get:
  - chat with citations
  - quizzes
  - flashcards, with a review deck
  - notes
  - session history
- **Game side.** Studying earns XP, coins, levels, streaks, quests and achievements, plus a shop and inventory.
- **Battle Arena.** Questions generated from your document become fights against mythic creatures, drawn as a side-view pixel-art fighting game.

**Goal (decided 2 Nov 2026): launch to real students.**
- Now: testing phase, on the owner's PC with local models and their own API keys.
- At launch: a paid subscription with 4 tiers (see §8).

---

## 2. Working agreements (how the owner likes to work)

- **Stages with zips.** Big work is split into 4–5 stages. After each stage, send:
  - a zip of **only the files changed** in that stage, with paths relative to `CourseMateAI/`;
  - a **"what to test"** checklist.

  Then carry straight on with the next stage.
- **Deleted files.** Unzipping cannot delete files, so removals go into `frontend/scripts/remove-old-files.mjs`. Tell the owner to run it.
- **Ask first.** The owner says "ask me questions": clarify scope with multiple-choice questions before building.
- **Skills the owner invokes:** `/caveman` (terse chat replies, while code, commits and docs stay normal), `/superpowers-workflow` (brainstorm → plan → TDD → review → finish), `/ui-styling`, `/ui-ux-pro-max`, `/design`, `/design-system`.
- **Owner's machine.** Windows, PowerShell, project at `C:\Archit\Projects\CourseMateAI`. The backend runs in `backend\.venv`.
  - Their LLM in testing has been NVIDIA NIM `nvidia/nemotron-3.5-super-vl-120b-a12b`, a reasoning model that spends tokens "thinking".
  - Plan: mix local models (Ollama / OpenAI-compatible) and their own API keys.
- **Plain-language explanations.** Logs and errors confuse the owner. Explain what went wrong in plain words, then the fix.
- **Art direction (owner's words):** "what we have now is perfect!!!" Keep the current pixel art. Next, make the pixel champions *the* avatar everywhere.
- **IP rule.** The owner's reference images showed known anime characters (Naruto, Zoro, Erza, Deku, Levi, Jotaro, Ben 10 and others). We only make **original** characters in that pixel-fighter *style*, never those characters.

---

## 3. Tech stack (current)

**Frontend (`frontend/`)**
- Core: Next.js **16.4.3** (Turbopack), React **19.3**, TypeScript **5.9**.
- Styling: Tailwind **4.3**, CSS-first through `@theme inline` in `src/app/globals.css`, with `@tailwindcss/postcss` and `tw-animate-css`.
- Animation and UI: motion 14.8, GSAP plus @gsap/react, radix-ui, cmdk, class-variance-authority.
- Other libraries: lucide 1.64, zustand 5, react-markdown 10, katex 0.19.1 (pinned through npm `overrides`), and the Geist fonts self-hosted.
- three, @react-three/fiber and @react-three/drei are **still in package.json but unused**: the 3D arena core was replaced by the pixel stage. They can be removed.
- Tests:
  - **vitest**, 490 tests
  - **Playwright** e2e, 138 tests (16 are phone-only checks skipped on desktop): axe accessibility, keyboard, 360px mobile, reduced motion, arena and champion flows, all against a mocked API (`e2e/fixtures/api.ts`)

**Backend (`backend/`)**
- FastAPI, SQLite (migrations `0001`–`0008` in `backend/migrations/`), LangChain.
- Documents: FAISS vector store, local `sentence-transformers` embeddings (default `BAAI/bge-large-en-v1.5`, about 1.3 GB of RAM; `bge-small` can be set through `EMBEDDING_MODEL`).
- LLM providers (`providers.py`): `gemini`, `nvidia-nim`, `openai-compatible`, `openai`, `claude`, `ollama`. Local providers need `ALLOW_LOCAL_PROVIDERS=true`.
  - Users can store their own API key (encrypted) through `/auth/api-key`.
  - Structured LLM output is validated with Pydantic (`core_brains/llm_schemas.py`).
- Tests: **pytest**, 876 passing. One test, `test_providers.py::test_fixed_provider_ignores_user_supplied_url`, fails without internet because it does a DNS lookup. That is expected.
- Logs:
  - A terminal shows readable one-liners (`LOG_FORMAT=pretty`, the default when stdout is a TTY).
  - Production writes JSON lines with secrets redacted.

**Run locally**
- Backend: `cd backend; .venv\Scripts\activate; uvicorn main:app --reload --port 8000` (install with `pip install -r requirements-dev.txt`).
- Frontend: `cd frontend; npm install; npm run dev` (port 3000; `/api/*` is proxied to the backend).
- If the frontend environment is broken: `node scripts/doctor.mjs`, then the clean install it prints:
  ```
  Remove-Item -Recurse -Force node_modules, .next; npm install
  ```
- Docker: `docker-compose.yml` exists (backend, frontend and volumes for data, uploads and the embedding cache).
- Dev-only pages, served by `next dev` only: `/dev/pixel` (every sprite in every animation, every skin and pet).
- Static skin previews: `npx jiti scripts/pixel-preview.ts` (HTML contact sheets in `frontend/pixel-previews/`).

---

## 4. History: what has been done

### Phase 1: full UI redesign and Arena v2 (5 stages, Oct 2026)

**Stage 1: design system and stack upgrade**
- Upgraded to Tailwind 4, React 19 and Next 16.
- Two themes from one token set (`src/styles/tokens.css`):
  - **Study**: "graphite glass", calm premium SaaS, indigo accent.
  - **Play**: "arcane glass", violet and gold, a pixel label font.
- Token rules: opaque `--color-*` values (WCAG contrast is checked by tests), plus `--glass-*`, `--aurora-*` and `--glow-*`.
- Tailwind class names: `bg-canvas`, `bg-panel`, `text-fg`, `text-fg-2`, `text-fg-muted`, `border-line*`.
- Effects library `src/components/fx`: Aurora, Starfield, Spotlight, Magnetic, TiltCard, AnimatedNumber, TextReveal, ripple and spark bursts.
- Glass UI kit (`src/components/ui`): Button (sheen, ripple, sparks), Card (spotlight), Toast.
- Shell: aurora backdrop, glass nav rail, bottom dock on mobile, ⌘K command palette (cmdk plus Radix), page transitions.
- In-app *Large text* and *Reduce animations* settings (on `html`), plus OS reduced motion.

**Stage 2: study screens.** Chat, quiz, flashcards (3D flip, swipe, review deck), notes, history, login and account, all redesigned.

**Stage 3: Arena v2 backend (server-authoritative)**
- **Tactical turns.** The boss telegraphs an intent: attack, heavy, shield, drain or heal. The player picks a move (keys Q W E R) that asks a question of a matching tier:

  | Move | Question | Effect |
  |---|---|---|
  | Strike | Medium | Full damage |
  | Jab | Easy | 60% damage, 15 s clock, +1 extra Focus |
  | Heavy | Hard | 180% damage, costs 2 Focus |
  | Guard | Medium | No damage; a right answer blocks the boss's attack |

- **Focus** (0–5) is earned by right answers and spent on Heavy and on spells: Insight (50/50) and Timewarp (+15 s).
- **Mastery tracking** per concept feeds the **Nemesis** boss, which is built from the concepts you keep missing.
- **Expedition** (roguelite):
  - 3 acts taken from the document, on seeded branching maps
  - battle, elite, nemesis, boss, shop, rest and treasure nodes
  - 12 relics (`backend/content/relics.json`), one life
  - an `expedition_complete` reward
- **Study scrolls.** Missed questions become review flashcards (`/study/review-deck`, `/study/flashcards/review`).
- Weekly global leaderboard plus per-topic boards.
- The server grades answers, keeps the clock and pays rewards exactly once.
- Migration `0007_arena_v2.sql`. Spec: `docs/arena-v2.md`.

**Stage 4: arena and hero UI.** Hub, summon, battle, result, run map and hero area screens.

**Stage 5: polish plus fixes from two independent reviews (12 frontend and 8 backend issues fixed)**
- Turn state machine fixes and generation guards.
- Keyboard shortcuts no longer fire behind overlays (`src/lib/keys.ts` `shortcutBlocked`).
- Reduced-motion fixes, and the in-app Appearance CSS restored.

**Hotfixes after Phase 1 (problems from the owner's Windows machine)**
- `npm audit`: fixed with npm overrides (katex, postcss-selector-parser).
- Windows test failures: old PostCSS config, `en-IN` date formatting (now pinned to `en-US`), backslash paths.
- Build errors: a dead `BossCanvas.tsx`; Turbopack picking a parent lockfile (fixed with `turbopack.root` in `next.config.ts`).
- "Unknown at rule @plugin/@theme" and "Can't resolve tw-animate-css": `node_modules` was out of sync and the PostCSS config was old. Fixed by `scripts/doctor.mjs` (checks and repairs the PostCSS config and package versions) and a clean install.
- Backend pytest needs `pip install -r requirements-dev.txt` (reportlab, PyJWT, pytest-asyncio).

### Phase 2: pixel fighting-game arena (stages A–D, 30 Oct – 2 Nov 2026)

**Why:** the owner's summon "took forever and nothing came up". From their log:
- `POST /arena/battles` took **135 s**, then returned 500.
- Boss generation made 4 sequential LLM calls (persona, then 3 attempts at the taunts). Nemotron ran out of output tokens (`LengthFinishReasonError`) and the call was retried with the same budget.
- They also wanted the arena to "stand out": pixel avatars in a fighting-game style, with bosses as ancient or mythic monsters.

Choices the owner made:
- A fighting-game layout (you vs. the boss, side view). This is not real-time PvP.
- A roster of original heroes.
- Hand-coded sprites with a hook to swap in real art later.
- Mixed world mythology for the bosses.

**Stage A: the summon fix (backend)**
- New `backend/core_brains/bestiary.py` with **13 creatures**:
  - Greek: hydra, minotaur, cyclops
  - Norse: fenrir, jormungandr, kraken
  - Indian: naga, rakshasa
  - Japanese: oni, kitsune
  - Egyptian: sphinx, and **ammit**, which is reserved for Nemesis fights
  - Persian: simurgh
- `pick_species(topic)`: topic words are matched against keyword stems; ties and no-match topics use a stable hash, so the same topic always gives the same creature. Short stems (fewer than 4 letters) match whole words only.
  - A topic of the form `"Nemesis: …"` gives Ammit.
- `generate_boss_persona_async` is now **instant and makes no LLM call**: it returns the creature plus its built-in lines, with `flavor_pending: True`.
- `BattleService.enrich()` then runs **one** small structured call (`BossFlavor`: title, attack names, a few taunts) **in the background**.
  - It times out after 45 s, is tried once, and never runs twice for the same battle.
  - `merge_flavor` never touches combat numbers. The fight never waits for it.
- `llm_connection`:
  - `_MIN_OUTPUT_TOKENS["openai_compat"]` raised from 4096 to **8192** (reasoning models).
  - A cut-off answer (`LengthFinishReasonError`) raises `StructuredOutputError` at once instead of being retried.
- The battle `state()` now includes `boss.species`, `boss.title` and `boss.origin`.
- Logs:
  - New readable `PrettyFormatter` (crash-safe; it falls back to JSON).
  - httpx, huggingface, faiss and sentence-transformers chatter silenced.
  - The embedding model loads with `local_files_only` first, falling back to download, and with no progress bars.
- Frontend:
  - Expected API errors (`session_expired`, `document_not_found` and similar) are no longer `console.warn`ed.
  - The first-question wait shows progress messages and a seconds counter (`ForgingWait`).

**Stage B: the pixel engine (`frontend/src/lib/pixel/`)**

| File | Purpose |
|---|---|
| `color.ts` | Hue-shifted 5-step ramps (outline, shadow, mid, light, highlight); `farSide` and `tint` |
| `buffer.ts` | `PixelBuffer` rasteriser: shaded tapered capsules, ellipses and polygons from a fake 3D normal; inner lines where parts overlap; silhouette outline pass; `rotated`, `silhouette`, `bounds`. Pure TypeScript, so it runs in Node and in the browser |
| `rig.ts` | Humanoid skeleton (forward kinematics from joint angles); outfits (coat, gi, armor, robe, tank, jacket, bare); hair (spiky, ponytail, bob, wild, slick, hood, topknot); weapons (katana, greatsword, spear, staff, daggers, gauntlets, axe, club, claws, boulder) |
| `heroes.ts` | **6 original champions** (below) and their animations; `geared()` adds gear tints |
| `bosses.ts` | The 13 creatures on 4 body plans (giant humanoid, quadruped, serpent, one-offs) with idle, attack, hit, cast and KO frames |
| `stages.ts` | **10 stages** at 480x270 with dithered skies, perspective floors and particles |
| `sprites.ts` | Frame cache, keyed by the look so gear tints don't collide |
| `canvas.ts` | Turns a buffer into a canvas |
| `sheets.ts` | Swappable PNG art through `public/sprites/manifest.json`; see `docs/pixel-sprites.md` |
| `fight.ts` | `FightScene` engine |

The 6 champions:

| Champion | Title | Style | Weapon |
|---|---|---|---|
| Kaien | Ronin of the Ninth Page | blade | katana |
| Asha | Lancer of the Dawn Wall | lance | spear |
| Brak | Iron-Fist of the Lower Stacks | fist | gauntlets |
| Mira | Arcanist of the Quiet Stacks | mage | staff, fires orbs |
| Vex | Shadow of the Margins | twin | daggers |
| Thorne | Knight of the Last Chapter | heavy | greatsword |

Champion animations: idle, attack, hit, guard, cast, KO, win and dash.

Each creature's home stage (`bosses.ts` `stage`):

| Stage | Creatures |
|---|---|
| labyrinth | minotaur |
| forge | cyclops |
| shrine | oni, kitsune |
| temple | rakshasa, naga |
| frost | fenrir |
| desert | sphinx |
| underworld | ammit |
| swamp | hydra |
| sea | jormungandr, kraken |
| peaks | simurgh |

Stage particles include snow, embers, petals, fireflies, sand, wisps, rain with lightning, and feathers.

New UI:
- `components/arena/pixel/`: `PixelSprite` (animated sprite canvas, with crop and portrait modes), `Roster` (choose your champion; a radio group with arrow keys), `Bestiary` (all creatures with their lore), `useFighter` (your champion plus gear tints), `pixel.css`.
- `hooks/useArenaHero.ts`: the champion choice, **kept in localStorage only** (moves to the server in the next phase).

**Stage C: the fight screen**
- `BattleScreen` uses `PixelArena`, a canvas scene driven by `FightScene`:
  - an intro dash and a "FIGHT!" banner
  - strike: dash, slash, hit flash, knockback, shake and sparks (Brak and Vex land two hits; Mira fires an orb)
  - boss lunge; a guard shows a block ring
  - shield bubble, heal motes, drain wisps
  - rage: a shockwave, "ENRAGED" and a flickering red aura
  - the boss's telegraphed intent shown as a coloured aura
  - KO: "K.O.", the sprite crumbles into pixels and the hero plays the win pose; a loss shows "DEFEATED"
- `beatsFor(outcome, battle)` maps the server's verdict to animation beats.
- Damage floaters appear when the blow actually lands (`onImpact`).
- Fighter-style HUD with pixel portraits of both sides; the result screen shows the champion's pose.
- Reduced motion turns off the shake, flashes, dashes and particles.
- Removed: `Scene.tsx`, `bosses.tsx` (SVG), `HeroSprite.tsx`, `ArenaCore3D.tsx`, `lib/arena/boss.ts` and its data, and `/dev/bosses`. All are listed in `remove-old-files.mjs`.

**Stage D: polish and review fixes**
- The summon screen shows your champion. Casting a spell plays a cast beat. Nemesis fights open with a "NEMESIS" banner, and resumed fights with "RESUME". Three stage art fixes.
- Fixes from an independent code review:
  - Each turn's beats are stamped with that turn's key, and `FightScene.reset()` cuts the last turn short.
  - The beat key is per answer (`o{id}`) and is never replayed.
  - Hero sheets that load late are ignored if the champion changed (async race).
  - Boss sheet frames are clamped.
  - Enrich runs only once per battle; the pretty logs are crash-safe; keyword matching was fixed; empty sprites are guarded.
  - On mobile, the verdict's Continue button scrolls clear of the bottom dock (an axe target-size failure).
- Docs: `docs/pixel-sprites.md` and readme updates.

**Status at the end of Phase 2:** 467 unit tests, 117 e2e tests and 857 backend tests pass, and the production build is clean.

Commits, in order: stage A, stage B, stage C, cleanup script, stage D (wip), stage D.

### Phase 3, Stage 1: the pixel champion is the avatar (3–4 Nov 2026)

Decisions (owner): keep every shop item id, price, bonus and owner and give them skin names; a weapon item re-finishes the champion's OWN weapon; one skin loadout shared by all six champions; every item icon is pixel art (potions and titles too).

- **1a: skin art** (`lib/pixel/skins.ts`, `pets.ts`, `icons.ts`, plus head pieces and weapon glows in `rig.ts`):
  - armor → outfit palettes (`main / second / trim / dark`, `metal` for plate, `glow` for the two legendary outfits), mapped per champion; plate gives everyone metal pauldrons
  - headgear → `circlet` (cloth headbands with tails), `hood` (plain, pointed, masked), `helm` (crest, visor, Oni horns), `crown`
  - weapon → metal + accent finish, with a rare / epic / legendary glow (blue / violet / gold)
  - pet → 10 pixel pets on 3 body plans (beast, bird, dragon), 4-frame idle; fliers hover
  - `dressed(hero, loadout)` keys the frame cache by loadout; the default champions are byte-identical to Phase 2
- **1b: server** (migration `0008_champion_avatar`): `user_avatar.champion_id` and `champion_set_at`.
  - New `GET` and `PUT /avatar/champion` (`{champion_id, loadout?}`), with ownership enforced and a 422 `unknown_champion` for a bad id. `/shop` and `/avatar` carry `champion_id`.
  - `/avatar/hero-forge-save` is removed, and the legacy `outfit_id` is no longer written.
  - Existing users are mapped: the forge body type picks the nearest champion (not marked chosen), `outfit_id` moves to the armor slot, and the forge-only keys are dropped.
- **1c: UI**
  - `hooks/useChampion.ts`: the server is the source of truth and localStorage is a cache. A Phase 2 browser pick moves to the account once, if the account has not chosen yet. A pick made before login status is known is queued.
  - `components/champion/*`:
    - `ChampionAvatar`: round portrait plus pet; used in UserMenu, HeroHeader and ProfileHero
    - `ItemArt`: pixel item icons
    - `GearChips`: moved here
    - `useChampionLook`
  - **Champion tab** (`hero/ChampionTab.tsx`): roster, skin loadout and a live idle / attack / win preview. It replaces the Avatar and Hero Forge tabs; old `?tab=avatar|forge` and `/avatar*` links land on it.
  - `PixelSprite` draws a pet beside the champion (or a pet alone) and reports `data-playing`. Pets also appear in the fight scene and the HUD portrait.
  - Fixed: tapping a roster card on a phone did nothing (the sprite remounted under the finger).
- **1d: cleanup**: the vector avatar (`components/avatar`, `lib/avatar`, the old Avatar*/PixelAvatar/PixelSprite components, `useArenaHero`, `/dev/avatar`) is deleted and listed in `remove-old-files.mjs`. Docs are updated.

### Phase 3, Stage 2: every fight plays differently (4 Nov 2026)

Owner decisions: build the proposed 13 mechanics; a separate ultimate meter that fills from right answers (+25 each, +10 at combo 3+, cap 100); 3 mastery skins per champion at Lv 3, 6 and 10; the LLM writes the Sphinx riddles; the ultimate key is **U**. The full rules and numbers are in `docs/arena-v2.md` §8.

- **2a: creature mechanics** (`core_brains/mechanics.py`): one `Mechanic` per creature, with `prepare()` / `settle()` around the usual damage. Scheduled special intents: grab, riddle, illusion, charge, aim/throw, hoard, stunned. A locked move gets 409 `move_locked`, and Insight on a riddle gets 409 `riddle_no_insight`. `tests/test_arena_balance.py` is a seeded bot that keeps each creature close to a plain boss.
- **2b: champion kits and levels** (`core_brains/kits.py`, migration `0009_champion_progress`):
  - A passive and an ultimate per champion: `POST /arena/battles/{id}/ultimate`.
  - XP per champion (10 per right answer, +50 for a win), levels 1–10.
  - 18 mastery skins (`mastery_<champ>_<outfit|head|weapon>`): never sold, worn only by their champion. Their pixel recipes are in `skins.ts`.
- **2c: UI**:
  - New components: `MechanicHud`, `UltimateMeter` (key U) and `verdict.ts` (`mechanicLines`).
  - Locked moves in `MovePicker`, and Riddle / Illusion / Treasure badges.
  - The champion's XP line and its unlocks on the result screen.
  - Roster Lv badges, and the kit and mastery panel in the Champion tab. The shop hides mastery items.
- **2d: beats**:
  - FightScene beats `mechanic` (data-driven `MECHANIC_FX`), `ultimate`, `riposte` and `dodge`, plus charge and thrown-boulder versions of the boss blow.
  - `beatsFor` orders them.
  - A test fails if a backend `t.event(...)` type has no beat.

### Phase 3, Stage 3A: study power (4 Nov 2026)

Owner decisions:
- Use the `fsrs` package (6.3.2), not a hand-written scheduler.
- Four grades on keys 1-4; a flashcard joins the queue when it is first graded.
- The PDF report is built on the server with reportlab, which is now a runtime dependency.
- Entitlement stub: `DEFAULT_TIER`, default archmage.

Full rules: `docs/study-power.md`.

- **3A-a: review queue backend**
  - Migration `0010_study_power` (review_items, review_logs, the exam tables, missed_questions rebuilt to allow `exam`; existing study scrolls became cards).
  - Code: `services/review_service.py`, `routers/review.py`, `services/entitlements.py`. `MasteryService.record()` adds every missed question to the queue.
  - Flashcard grades send the card itself. Grades keep the streak and advance the quests `review_cards` and `clear_reviews`; clearing the queue pays `review_complete` once a day.
- **3A-b: exam backend**
  - Code: `core_brains/exam_brain.py`, `services/exam_service.py`, `services/exam_report.py`, `routers/exams.py`.
  - Graded once on the server, with a per-concept breakdown and a PDF report. Misses go to the review queue. Pays `exam_complete` and advances the quest `complete_exams`.
- **3A-c: review UI**
  - Study → Review (keyboard 1-4, swipe on a phone).
  - Due badge on the Study nav item and the Review tab.
  - "Add deck to review" in Flashcards.
  - `UpgradeCard` for locked features.
- **3A-d: exam UI**
  - Study → Exam: setup, runner (clock, question grid, flags, keys), results, PDF link.
  - The current sub-nav tab scrolls into view on phones.
  - e2e specs `review.spec.ts` and `exam.spec.ts`; both screens are in the axe, mobile and motion page list.

### Phase 3, Stage 3B: courses, citations, concept map (4 Nov 2026)

Owner decisions: a constellation-style map; pdf.js for the viewer; PDFs are kept and documents in a course don't expire; courses, the concept map and the PDF viewer are Sage features (page labels stay free); `DEFAULT_TIER` stays archmage. Full rules: `docs/study-power.md` sections 5-8.

- **3B-a/b: backend.** Migration `0011_courses_and_maps`; `rag/multi_index.py`; course ids as scopes; kept PDFs and `GET /documents/{id}/file`; numbered citations in chat; `services/course_service.py`, `routers/courses.py`; `core_brains/concept_brain.py`, `services/concept_map_service.py`, `routers/concept_maps.py`.
- **3B-c: citations and the PDF viewer.** `components/pdf/PdfViewer.tsx`, `CitationList`, `[n]` markers in `ChatMarkdown`; `e2e/citations.spec.ts`.
- **3B-d: courses UI.** Header switcher (`components/course/LibraryMenu.tsx`), `CourseEditor`, the Overview tab (`CourseOverview`); the review queue of a course includes its documents' cards; `e2e/courses.spec.ts`.
- **3B-e: concept map UI.** Study → Map (`components/map/*`, `lib/study/conceptMap.ts`); `?topic=` opens quiz / flashcards / the arena's Quick Battle on one concept; the arena takes `?doc=`; the workspace tabs scroll inside their own box on a phone; `e2e/concept-map.spec.ts`.

### Phase 3, Stage 4a: plans, quotas, usage, invite codes (4 Nov 2026)

Owner decisions:
- Balanced INR prices: ₹0 / ₹149 / ₹299 / ₹599 a month; a year costs 10 months.
- Testers join through invite codes that grant a plan.
- Calls on a user's own key are outside the AI quotas.

Full rules: `docs/plans.md`.

- Migration `0012_plans_and_usage` (user_plans, usage_daily, invite_codes, invite_redemptions).
- `entitlements.PLANS` and limits; `tier_for` reads user_plans.
- `core_brains/usage_meter.py` meters every model call; `services/usage_service.py` holds the quotas; `services/invite_service.py` handles codes.
- `routers/account.py`: `/plans`, `/account/usage`, `/account/redeem`. Also `DELETE /documents/{id}` and `DELETE /auth/api-key`.
- `scripts/admin.py` (invites, plans, usage).
- Sign-up: an invite-code field, and "CourseMate's AI" when the server has a key.
- Account → Plan & usage page. "See plans" on every plan error.

### Phase 3, Stage 4b: model routing, quiz bank, costs (4 Nov 2026)

Owner decision: local models for small jobs, API models for strong ones, falling back when local is down or slow. Full rules: `docs/model-routing.md`.

- `core_brains/model_router.py`: jobs (small / strong), slots (fast / strong / premium / local), routes per plan, `MODEL_ROUTES_JSON`.
- `llm_connection`: `request_targets` and routed calls with fallbacks; trusted server clients (local Ollama or LAN).
- Migration `0013_routing_costs_quiz_bank`.
- `services/costs.py` (`MODEL_PRICES_JSON`; local = 0); `model_usage_daily`.
- `services/quiz_bank.py`: per-document questions shared by content hash; a quiz is served with no AI call when enough are unseen.
- `scripts/admin.py costs` and `routes`.

### Phase 3, Stage 4c: Razorpay subscriptions behind a flag (4 Nov 2026)

Full rules and the Razorpay setup steps: `docs/payments.md`.

- Off unless `PAYMENTS_ENABLED=1`. The provider is Razorpay, or a stub that is only on when `PAYMENTS_PROVIDER=stub` is set on purpose.
- Migration `0014_subscriptions` (subscriptions, payment_events).
- `services/billing.py`: checkout, Checkout signature check, webhooks (HMAC, once per event id), cancel at period end, plan sync with 3 days' grace, switching plans cancels the old one.
- `routers/billing.py`.
- Plan & usage: Upgrade opens Razorpay Checkout (script loaded on demand) or the stub's test dialog; the subscription line has renewal and cancel.

### Phase 3, Stage 4d: hardening (4 Nov 2026)

Full details: `docs/security.md`.

- **Security pass:** changing the email and deleting the account need the password; a per-account login throttle; provider error text is redacted; `ALLOWED_ORIGIN=*` is refused; security headers on the API and the pages.
- **Rate limits:** every mutating route has a limit (enforced by `tests/test_security.py`).
- **Sentry:** backend and frontend, off without a DSN, with PII and secret scrubbing.
- **PWA:** manifest, icons, `sw.js`, the `/offline` page, Settings → App install.
- **Cleanup:** the three.js packages are removed.

### Phase 3, Stage 4e: deploy (4 Nov 2026)

Full details: `docs/deploy-windows.md`, `docs/deploy-vps.md`, `docs/postgres.md`.

- **Testers on the PC:** `deploy/windows/*.ps1` (setup, build, tunnel, start `-Quick`, stop, backup) and `backend.env.example`. One Cloudflare Tunnel hostname: `/api` goes to the backend, the rest to the Next.js standalone server.
- **VPS:** `deploy/vps/docker-compose.yml` with Caddy (HTTPS), the backend, the frontend, and the optional `postgres` and `backup` profiles.
- **PostgreSQL (optional):** `DATABASE_URL` switches the app. `database/pg.py` translates SQLite SQL; `migrations/postgres/` holds the baseline; `scripts/sqlite_to_postgres.py` copies the data. The whole suite passes on both databases.

---

## 5. Key file map

```
backend/
  core_brains/bestiary.py        creatures, keyword pick, base boss lines
  core_brains/boss_brain.py      persona (instant), flavour, quiz generation, combat maths, intents
  core_brains/llm_connection.py  LLM client, structured output, retries, truncation
  core_brains/llm_schemas.py     Pydantic schemas (BossFlavor, BattleQuiz, ...)
  services/arena_service.py      battles: state, questions pool/prefetch, answer/resolve, items, spells, enrich
  services/expedition_service.py roguelite runs
  services/mastery_service.py    per-concept mastery -> Nemesis
  routers/arena.py               /arena/* endpoints
  content/*.json                 shop, relics, rewards, quests, achievements, levels
frontend/src/
  lib/pixel/*                    pixel engine (see above)
  core_brains/mechanics.py       the 13 creature signature mechanics (Phase 3 Stage 2)
  core_brains/kits.py            champion passives, ultimates, champion XP / levels / mastery skins
  services/review_service.py     FSRS review queue (cards from flashcards, arena / quiz / exam misses)
  services/exam_service.py       exam mode (exam_brain writes it, exam_report renders the PDF)
  services/entitlements.py       plan tiers -> features (stub until Stage 4)
  services/usage_service.py      AI quotas + usage; core_brains/usage_meter.py counts every model call; invite_service.py codes
  services/billing.py            Razorpay / stub subscriptions -> user_plans; routers/billing.py
  routers/account.py             /plans, /account/usage, /account/redeem; scripts/admin.py for invites and plans
  components/account/PlanUsage.tsx  Account -> Plan & usage
  services/course_service.py     courses (rag/multi_index.py searches them); routers/courses.py
  services/concept_map_service.py  concept maps (core_brains/concept_brain.py makes them); routers/concept_maps.py
  components/course/*            LibraryMenu (header switcher), CourseEditor, CourseOverview
  components/pdf/PdfViewer.tsx   the cited page, drawn by pdf.js (lib/study/pdf.ts), passage highlighted
  components/map/*               ConceptMapView, Constellation (lib/study/conceptMap.ts: layout + arrow keys)
  components/arena/*             ArenaArea, ArenaHub, SummonPanel, BattleScreen, ResultPanel, RunScreen, MovePicker,
                                 MechanicHud, UltimateMeter, verdict.ts, ...
  components/arena/pixel/*       PixelArena, PixelSprite, Roster, Bestiary, useFighter
  hooks/useArenaBattle.ts        turn state machine (choosing/fetching/asking/answering/feedback/failed)
  lib/pixel/skins.ts, pets.ts, icons.ts   champion skins, pixel pets, pixel item icons
  hooks/useChampion.ts           the champion (server: GET/PUT /avatar/champion; localStorage = cache)
  components/champion/*          ChampionAvatar, ItemArt, GearChips, useChampionLook
  components/hero/*              Hero area tabs: Quests, Arena, Shop, Inventory, Champion, Achievements
  backend/services/progression/champions.py   the six champion ids, legacy body-type mapping
  styles/tokens.css, app/globals.css   design tokens and themes
backend/database/pg.py           PostgreSQL adapter (SQLite SQL translated); migrate.py runs migrations/postgres/ for a URL
backend/scripts/postgres_schema.py, sqlite_to_postgres.py   the PG baseline generator, the data copy
deploy/windows/*                 PC + Cloudflare Tunnel scripts; deploy/vps/* Docker Compose + Caddy
docs/arena-v2.md, docs/pixel-sprites.md
```

Shop categories (`backend/content/shop.json`): armor (Outfits), headgear (Head Pieces), weapon (Weapon Finishes), pet, potion, title. Armor, headgear, weapon and pet items are champion skins, and they also carry arena gear bonuses. A new wearable needs a recipe in `skins.ts` (or `pets.ts`); `skins.test.ts` fails until it has one.

---

## 6. Known gotchas

- **Unzips can't delete files.** Always run `node scripts/remove-old-files.mjs` after a stage that removes files.
- **Broken frontend environment** (Tailwind at-rules unknown, a missing package): run `node scripts/doctor.mjs`, then a clean install.
- **e2e must run against a production build** (`npm run build` then `next start`). Under `next dev`, Next's "N" dev-indicator button adds tab stops and fails the keyboard and axe tests.
- **A stale `next start` still holding the port** after a rebuild serves the old manifest and causes `ChunkLoadError`. Kill it before restarting.
- **jsdom has no canvas.** `PixelArena`, `PixelSprite` and `scrollIntoView` are guarded, and the words around the canvas carry the information.
- **Reasoning models (Nemotron, R1, Qwen3) burn output tokens thinking.** Keep the token floor at 8192 or more for openai-compat providers. Prefer a fast non-reasoning model for small calls.
- **The first question of a fight** is still written by the LLM from the PDF (a batch of 6), so a slow model makes the first question slow. The UI shows progress while it waits.
- **The champion lives on the account** (`/avatar/champion`). A PNG sheet listed for a champion in `public/sprites/manifest.json` replaces its procedural frames, so skins don't show on it.
- **Plans:** `DEFAULT_TIER` (backend env) decides what every account can use until Stage 4. Set it to `apprentice`, `scholar` or `sage` to see the locked states.
- **New Study screens** must be listed in `src/styles/study-screens.test.ts` (no pixel font, no gradient literals, no Play styling).
- **A new mechanic or kit event** (`t.event("x", ...)` in the backend) needs an entry in `MECHANIC_FX` (`lib/pixel/fight.ts`), or `fight.test.ts` fails.
- **Arena tests and kits:** the `hero` fixture in `tests/arena_v2_support.py` switches champion passives off (Kaien's Riposte would change older numbers). A test module sets `REAL_KITS = True` to keep them on.
- **A course id is a document id everywhere.** A new tool that takes a `session_id` gets courses for free through `get_index` / `get_document`; don't upload to a course id (400).
- **The Study tabs:** `STUDY_TABS` in `lib/routes.ts`. "overview" shows only for a course; tab lists in `routes.test.ts` and `StudyWorkspace.test.tsx` follow the order.
- **Concept map tests:** the extractor is faked in `tests/test_concept_maps.py`; real maps need an LLM key and take a minute or two (a reasoning model is slower).
- **Plans in tests:** `DEFAULT_TIER` unset means archmage (the largest limits), so older tests never hit a quota. `tests/test_plans.py` sets it per test. `make_user` registers with a key of its own (BYOK = outside the AI quotas): clear it with `state.db.save_api_key(uid, None, None, None, None)` to test quotas.
- **A new small AI call** (flavour, a helper with a fallback) goes inside `with llm_job("small"):` so the server's AI sends it to a cheap or local model. Everything else is "strong".
- **A new AI endpoint** must depend on `inject_user_llm_key` (quota + metering). Use `inject_user_llm_key_in_flight` only for the next turn of something already started.
- **A new route that changes something** needs `@limiter.limit(...)` (and a `request: Request` parameter), or `tests/test_security.py` fails.
- **Deleting an account in tests:** `c.request("DELETE", "/auth/delete-account", json={"password": "correct-horse-1"})`.
- **A new SQLite migration needs a PostgreSQL twin** in `migrations/postgres/` with the same number and name (`tests/test_postgres.py`). Write portable SQL in the code: `RETURNING id` (no `lastrowid`), no `rowid`, no `COLLATE NOCASE`, no SQLite date functions. Dates and timestamps are stored as ISO text on both.
- **Testing on PostgreSQL:** `COURSEMATE_TEST_PG=postgresql://postgres@localhost:5432/postgres python -m pytest` runs the whole suite on a fresh database.
- **Killing `next start` from a shell:** `pkill -f "next start"` can match the shell itself. Stop it by PID (`ps -eo pid,args`, look for `next-server`).

---

## 7. Brainstorm decisions (2 Nov 2026)

| Topic | Decision |
|---|---|
| Purpose | **Launch to real students** |
| Next focus | **Arena depth, study power, shipping**. Social/multiplayer: **later, keep "coming soon"** |
| Multiplayer | Later. When it comes, ghost duels first was the recommended route; this is not decided |
| Pixel art | **Keep the current art as it is.** Make the **pixel champion the avatar everywhere** |
| Old cosmetics | **Become champion skins**: palette skins, weapon looks and glows, auras, pixel pets. The old vector avatar and Hero Forge are retired |
| AI cost | **Testing:** local models plus the owner's own keys. **Deployed:** a paid subscription with 4 tiers |
| Hosting (testing) | **Free: owner's PC + Cloudflare Tunnel** (backend and local models at home; frontend through the same tunnel or Vercel Hobby) |
| Hosting (customers) | Buy a VPS (or similar) once there are real customers. Recommended: one 4 GB VPS in Singapore or Bangalore with docker compose (Caddy, Next, FastAPI, Postgres), and switch embeddings to bge-small |
| Tiers | **Apprentice** (Free), **Scholar** (Pro), **Sage** (Pro Plus), **Archmage** (Max) |
| Must-haves for launch | Creature mechanics plus champion kits; concept map plus exam mode; courses plus PDF citations; spaced repetition queue |
| Build order | **1 Avatar → 2 Arena → 3 Study → 4 Ship**, each a stage with zips |

**Draft tier contents (prices and limits to be finalised):**

| Tier | Draft contents |
|---|---|
| Apprentice (Free) | 2 PDFs; a small daily AI quota; Quick Battle; 3 champions; flashcards and quizzes |
| Scholar (Pro) | More PDFs and quota; Nemesis; Expedition; all 6 champions; spaced repetition queue |
| Sage (Pro Plus) | Courses; concept map; exam mode; PDF citations; a better AI model; champion skins |
| Archmage (Max) | Highest quota; the best model; early access to features; exclusive skins and auras; priority generation |

**Hosting research notes (Nov 2026; check again before buying):**
- **Oracle Cloud Always Free:** the Ampere A1 allowance was halved for new accounts, from 4 OCPU / 24 GB to **2 OCPU / 12 GB**. Claiming capacity can need repeated tries, and idle instances can be reclaimed.
- **Hugging Face Spaces:** Docker Spaces now need a paid plan, so they are not free for this.
- **Hetzner:** raised prices twice in 2026, and some cheap plans show as unavailable. Its US and Singapore locations include only 1 TB of traffic.
- **PaaS comparison:** at 2 GB of RAM, about $12/mo on Fly.io shared CPU versus about $31/mo on Railway or Render.
- **India-region alternatives:** DigitalOcean Bangalore, AWS Lightsail Mumbai.
- **Payments in India:** Razorpay subscriptions are the obvious candidate. Not decided.

---

## 8. Next phase plan (Phase 3)

Each stage ships a zip of the changed files plus a test checklist. Ready-to-paste prompts for each stage are in **`coursemateai-stage-prompts.md`**.

### Stage 1: the pixel champion becomes the avatar: **DONE (4 Nov 2026, see §4)**
- **Everywhere the old avatar shows:** the header, the user menu, the profile hero, Inventory and Shop previews. Each shows the pixel champion as a portrait or full-body `PixelSprite`.
- **Avatar tab → "Champion" tab:** pick a champion and a skin, with a live preview of its animations. The **Hero Forge is retired.**
- **Shop cosmetics → champion skins.** The pixel art needs extending for this:
  - **armor → outfit palette skins:** per-champion recolours, using the existing `ramp` and `tint`
  - **headgear → pixel head pieces:** circlet, helm, hood, crown, horns, drawn in `rig.ts`
  - **weapon → weapon variants and glows:** a rarity glow already exists
  - **pet → small pixel pets** that idle next to the champion, in the arena and the HUD
  - titles and potions stay as they are
  - arena gear bonuses keep working
- **Server-side persistence:**
  - champion id and skin loadout on the account, with a migration `0008_*`
  - endpoints updated or added; localStorage only as a cache
  - a sensible mapping for existing users' equipped items
- **Delete** the old vector avatar code (`components/avatar`, `lib/avatar` and `/dev/avatar`, as far as nothing else uses them), with `remove-old-files.mjs` updated.

### Stage 2: arena depth: **DONE (4 Nov 2026, see §4)**
- **Creature signature mechanics** (server-authoritative; shown in the UI and in the telegraphed intent):

  | Creature | Signature mechanic |
  |---|---|
  | Hydra | Regrows HP on your misses |
  | Kraken | Grabs you and locks one of your moves for a turn |
  | Sphinx | Riddle-style questions |
  | Kitsune | An illusion option: a fake answer that costs Focus |
  | Fenrir | Grows stronger each turn unless chained by right answers |
  | Minotaur | Charges harder the longer the labyrinth goes on |
  | Cyclops | Single-target heavy throws |
  | Oni | Drum buff stacks |
  | Rakshasa | Shapeshifts its weakness |
  | Naga | Guards a weakness "treasure" |
  | Simurgh | Heals by "wisdom" |
  | Jörmungandr | Coil damage over time |
  | Ammit | Feeds on repeated mistakes |

  Exact rules are designed in the stage.
- **Champion kits:** a passive plus an **ultimate** charged by Focus or combo, for example:
  - Kaien counters on Guard
  - Asha: reach bonus on Jab
  - Brak: combo multiplier
  - Mira: spells cost less
  - Vex: dodge chance
  - Thorne: stronger blocks
- **Champion progression:** champions level up with XP and unlock skins.
- Every mechanic gets backend tests, beats/animations and HUD text. Keep the balance fair, and keep it all accessible in words.

### Stage 3: study power (likely split into 3A and 3B)
- **3A: DONE (4 Nov 2026, see §4)**
  - A **spaced repetition queue (FSRS)** unifying flashcards, missed arena questions and quiz errors, with a daily review screen and streak hooks.
  - **Exam mode:** a timed mock test with a PDF score report.
- **3B: DONE (4 Nov 2026, see §4)**
  - **Courses:** group several PDFs, with search across them.
  - **PDF citations:** chat answers link to the page, opened in a side-by-side PDF viewer.
  - **Concept map:** an LLM extracts concepts and relations once per document; mastery is shown as a heat colour; clicking a node quizzes it or summons its boss.

### Stage 4: ship: **DONE (4 Nov 2026, 4a–4e, see §4)**
- **Testing deploy:** PC + Cloudflare Tunnel, with a guide, scripts and env templates. Production `docker-compose` with Caddy, ready for a VPS later.
- **Tiers and entitlements:**
  - Apprentice, Scholar, Sage and Archmage, with feature flags and quotas enforced on the server
  - usage metering per user (documents, AI calls, tokens)
  - **model routing per tier and per job:** a cheap or local model for flavour and small calls, a strong one for questions
  - quiz caching per document
- **Payments:** a Razorpay subscription integration behind a feature flag (stubbed until prices are set).
- **Hardening:** optional Postgres, an installable PWA, error monitoring, a rate-limit review, removing the unused three.js dependencies.

---

## 9. Ideas backlog (from the brainstorm)

| # | Idea | Status |
|---|---|---|
| 1 | Creature signature mechanics | **Done (Phase 3, Stage 2)** |
| 2 | Champion kits and champion levelling and skins | **Done (Phase 3, Stages 1–2)** |
| 3 | Async "ghost" duels (race a friend's recorded run) | Later (multiplayer) |
| 4 | Weekly world boss with community HP | Later |
| 5 | Campaign mode (document chapters as story stages with dialogue) | Backlog |
| 6 | Chiptune SFX and music through WebAudio, with a mute toggle | Backlog (cheap; good fit after Stage 2) |
| 7 | Share the KO as a GIF or clip | Backlog |
| 8 | FSRS spaced repetition queue | **Done (Phase 3, Stage 3A)** |
| 9 | Concept map / knowledge graph | **Planned (Stage 3B)** |
| 10 | Exam mode / mock tests | **Done (Phase 3, Stage 3A)** |
| 11 | Courses (multi-PDF), planner and calendar | **Planned (Stage 3B)**; planner in the backlog |
| 12 | Page-linked citations and a PDF viewer | **Planned (Stage 3B)** |
| 13 | More inputs: YouTube, web, slides, OCR | Backlog |
| 14 | Friends, study guilds, guild raids | Later |
| 15 | Teacher mode and class dashboard | Backlog |
| 16 | Season pass cosmetics | Backlog (could fit the tiers) |
| 17 | Server-side preferences (champion etc.) | **Done (Phase 3, Stage 1)** |
| 18 | LLM routing, cost tracking, quiz cache | **Planned (Stage 4)** |
| 19 | Deploy, Postgres, OAuth, PWA, monitoring | **Planned (Stage 4)**; OAuth to be decided |
| 20 | Remove the unused three.js dependencies | **Planned (Stage 4)** |
| — | Real-time PvP over WebSocket | Later, after ghost duels |

---

## 10. Open questions

- Tier **prices (INR)** and exact **quotas** per tier (documents, AI calls per day, tokens).
- Payment provider: Razorpay is the likely choice. Billing period: monthly or yearly. Trials?
- OAuth (Google login) at launch, or username and password only?
- Which local models for testing (Ollama? which sizes?) and which cloud models per tier.
- Keep SQLite for testing and move to Postgres at launch? (Recommended: yes.)
- Concept-map visual style: a force graph, or a hand-placed "constellation" in the Play theme?
- When multiplayer returns: ghost duels, co-op raids or live PvP first.

---

## 11. Source notes for the hosting facts (Nov 2026)

- Oracle Always Free cut: terminalbytes.com/oracle-cloud-free-tier-changes-2026; claiming capacity: space-node.net/blog/oracle-cloud-free-vps-guide-2026
- Hugging Face Spaces Docker needs a paid plan: huggingface.co/docs/hub/en/spaces-overview
- Hetzner 2026 price changes and availability: agentdeals.dev/vendor/hetzner, findstack.com/resources/hetzner-price-increase-2026, bitdoze.com/md/hetzner-cloud-review.md
- PaaS comparison: findstack.com/resources/railway-vs-render-vs-fly-io
