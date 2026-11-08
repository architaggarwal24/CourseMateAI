# Performance pass: report

7 to 8 Nov 2026, stages P1 to P5. Every number below was measured, on one sandbox machine, with the tools this pass
added: `perf/measure.spec.ts` (Playwright, production build, mocked API, a 360 px phone screen) and
`src/server/queries.test.ts` (D1 round trips per route on wrangler's local D1). "3G" means Chrome's "fast 3G" preset
plus a 4x CPU slowdown. "Before" is commit `b4f45cb` measured with the same harness as "after".

## A. Summary

**What was slow.** The app is one Next.js 16 app on a Cloudflare Worker with D1. The time goes on:

1. **A chain of requests before any screen shows.** Opening any app page asked GET /hud three times, one after
   another, after /auth/me; signed-out visitors (login and legal pages) asked twice for a HUD that is always the same.
   Hero and Account asked GET /shop twice at once; a course page asked for its record twice.
2. **Pages hidden until the JavaScript ran.** Every app page and the login card arrived from the server at opacity 0
   (motion's `initial`), so nothing showed until the scripts loaded and the fade ran.
3. **D1 round trips.** Every signed-in request read the account row twice; review stats ran six queries; course
   progress ran one query per PDF; the concept map read each document's map separately; a mock exam saved its
   answers one round trip per question.
4. **Bytes on every page.** Three fonts preloaded on every page (176 KB), Geist Mono with Cyrillic, Greek and
   Vietnamese; the command palette (cmdk and a dialog) in every page's first load; 37 highlight.js grammars on chat.
5. **Layout shifts.** `Skeleton` set an inline `height: 1rem` that beat size classes such as `h-[360px]`, so the
   exam, review, concept map, plan, PDF and course skeletons were 16 px slivers.

**Biggest wins:** all 34 duplicate API calls gone; API calls per screen 9 -> 6.5 (median); D1 round trips on the 20
hot routes 141 -> 97 (-31%); fonts per page 176 -> 107 KB (-39%); LCP on 3G -0.5 s on the median page.

**What did not move much:** time until a signed-in screen is usable on 3G stays about 5 s. It is bound by the
JavaScript download (about 300 KB gzip) and the /auth/me round trip that every screen waits for (see E and G).

## B. Before and after

| Metric | Before | After | Change |
|---|---|---|---|
| JS before the screen is ready, median page (gzip) | 332 KB | 311 KB | -6% |
| JS, study chat (gzip) | 514 KB | 500 KB | -14 KB |
| Fonts downloaded per page, median | 176 KB | 107 KB | -39% |
| API calls per screen, median (all 26 screens) | 9 | 6.5 | -25% (236 -> 176 total) |
| Duplicate API calls (same GET twice on one load) | 34 | 0 | all gone |
| D1 round trips, 20 hot routes together | 141 | 97 | -31% |
| D1 round trips, GET /review/queue | 16 | 7 | -56% |
| D1 round trips, GET /courses/:id/progress (3 PDFs) | 12 | 6 | -50% |
| D1 round trips, GET /concept-map (course of 3) | 13 | 7 | -46% |
| D1 round trips, any signed-in route | +1 per call | (account row reused) | -1 each |
| LCP on 3G, median app page | 5.46 s | 4.82 s | -0.64 s |
| LCP on 3G, median public page (login, legal) | 1.70 s | 1.60 s | -0.10 s |
| Ready on 3G, public pages | 4.20 s | 3.80 s | -0.40 s |
| Ready on 3G, app pages | 5.3 s | 5.3 to 5.5 s | no change (run-to-run noise is about 0.5 s) |
| CLS on 3G, worst page (course overview) | 0.244 | 0.132 | -46% |
| CLS on 3G, other pages | 0 to 0.03 | 0 to 0.045 | small new shifts (see E) |
| INP | not measured | not measured | needs real users: Web Vitals now go to Sentry |
| Worker size (wrangler dry run, gzip) | 2713.8 KiB | 2716.6 KiB | +2.8 KiB (limit 3 MB) |

Not measurable here: real API latency (D1 and Workers AI don't run locally; the e2e API is mocked) and real-device
INP. Round trips are the stand-in for latency: on Cloudflare each one is a network hop from the Worker to D1.

## C. The 51 items

### A. Database and queries

1. **N+1 queries. Built.** Course progress (one query per PDF -> one grouped query), concept map view and build (one
   map read per document -> one `inArray` read), exam submit (one insert per answer -> one D1 batch), arena question
   pool (one insert per question -> one batch). `src/server/courses.ts`, `study/conceptMap.ts`, `study/exams.ts`,
   `game/arena.ts`. Verify: `src/server/queries.test.ts`.
2. **Indexes. Already done.** Every hot filter has an index or primary key (review_items (user_id, due), review_logs
   (user_id, local_date), concept_mastery PK, documents (user_id), course_documents, exams (user_id, status),
   usage_daily PK, arena boards). No new index was justified, so no migration.
3. **Redis caching. Skipped.** No Redis on Workers; the app's data is per user and changes with every answer. A
   per-request cache of the plan tier was added instead (item 4).
4. **Query optimisation. Built.** The account row comes from the session Better Auth just read (`rowFromSessionUser`
   in `src/server/context.ts`, falls back to a read if a column is missing); the plan tier is read once per request
   (`tierFor` cache, `forgetTier` after a plan change); review stats in one pass with `SUM(CASE ...)`; document-or-course
   lookups in one batch (`resolveDocumentOrCourse`). Verify: `queries.test.ts` budgets.
5. **Connection pooling. Skipped.** D1 is reached through a Worker binding; there are no connections to pool.
6. **Server and database proximity. Already done / recommendation.** D1 was created with `--location apac`; Workers
   run near the user. Smart Placement (`"placement": { "mode": "smart" }` in wrangler.jsonc) could run the Worker
   next to D1 when a request makes several queries; not turned on, because it needs a check on the live account.

### B. Frontend rendering and loading

7. **Re-renders. Built.** Earlier chat answers were parsed again (remark, KaTeX, highlighting) on every streamed
   token; `ChatMarkdown` is now memoised by text and citation count. Zustand selectors were already narrow.
   Verify: `src/components/chat/ChatMarkdown.memo.test.tsx`.
8. **Virtualised lists. Skipped.** The longest lists (documents, history, admin accounts) are tens of rows; the
   history API sends 100 rows by default (500 at most). Not worth it.
9. **Skeletons. Built (fix).** Already layout-matched and delayed 300 ms; `Skeleton` now lets a size class win over its
   inline default, and the course progress skeleton matches the tile grid. `src/components/ui/Skeleton.tsx`,
   `course/CourseOverview.tsx`. Verify: `Skeleton.test.tsx`.
10. **Server rendering. Built (partly).** The first page's server HTML now paints at once instead of waiting at
    opacity 0 (`src/app/(app)/template.tsx`, login entrance in CSS). Screens still render their content on the client
    after the sign-in check (see E).
11. **Streaming AI. Already done.** Chat streams over SSE with abort and a non-streaming fallback (`lib/chatStream.ts`).

### C. Network and API

12. **Duplicate requests. Built.** The `api` client already shared identical concurrent GETs; the duplicates were
    sequential. GET /hud once at start-up (`useHUDStore.load()`), none for visitors; GET /shop shared
    (`useHeroStore.loadShop`); the course record not re-asked within 2 s. Verify: `useHUD.test.ts`, `useHero.test.ts`,
    perf harness `dup` column.
13. **Debounced search. Already done.** The command palette filters locally; the sign-up username check waits for a
    pause in typing (`SignupFlow.tsx`); there is no other type-ahead API.
14. **Pagination. Already done.** History and leaderboards are limited server-side; the review queue pages by 20.
15. **Parallel requests. Built.** /hud starts alongside /auth/me; courses load with documents; the HUD's quests,
    buffs and inventory are read side by side, and the shop state reuses them. `AppShell.tsx`, `AuthContext.tsx`,
    `StudyWorkspace.tsx`, `server/game/avatar.ts`, `game/shop.ts`.
16. **Timeouts. Built (gap closed).** AI calls (120 s, fallbacks) and Razorpay (20 s) had them; Resend email had none
    and now gives up after 10 s (`server/auth/mailer.ts`).
17. **Compression. Already done.** Cloudflare compresses responses at the edge; `next start` gzips locally.

### D. Backend

18. **Background jobs. Already done.** The long job (concept map) already claims a lease, records its stage, and the
    screen polls; a dropped connection doesn't lose it. Arena flavour text runs in `waitUntil`. Moving it to Queues
    would add a paid service for no gain on Workers (no wall-clock limit while the client waits).
19. **Query efficiency. Built.** See 1 and 4.
20. **Pooling. Skipped.** As 5.
21. **Observability. Built (client), skipped (server).** Web Vitals through Sentry (see 30). The Worker already has
    Cloudflare observability on (`wrangler.jsonc`); OpenTelemetry was not added (bundle size, no collector).

### E. Assets and bundle

22. **Images. Skipped.** The app has almost no images: the art is drawn on canvas by the pixel engine; icons are SVG;
    the PNG app icons are small.
23. **CDN. Already done.** Cloudflare serves static assets from its edge.
24. **Browser caching. Built.** `public/_headers`: hashed `/_next/static/*` files a year, immutable; `/sw.js` never
    cached (the next.config.ts header never reached it on Cloudflare); icons a day. Verify: `src/styles/perf.test.ts`.
25. **Code splitting. Built.** Study tools, the arena and the PDF viewer were already split; the command palette now
    loads on idle or first use (`shell/CommandPaletteLoader.tsx`).
26. **Dependencies. Built.** Removed unused `gsap`, `@gsap/react`, `@phosphor-icons/react`, `class-variance-authority`,
    `geist`, `uuid`; `rehype-highlight` replaced by a 21-language version of the same plugin
    (`src/lib/study/highlight.ts`, about 19 KB gzip less on chat). `motion` was kept: a LazyMotion prototype showed no
    real saving, because drag, layout animations and `animate()` pull the engine in on every screen.
27. **Third-party scripts. Already done.** Sentry loads only with a DSN, after hydration; Razorpay only at checkout.
28. **Fonts. Built.** Self-hosted with `swap` already; Geist Mono subset (71 -> 40 KB) and no longer preloaded. Onest
    and Bricolage stay preloaded (body and headings). Verify: `perf.test.ts`.

### F. Scale and real-world

29. **Load balancing. Skipped.** Workers scale by themselves; there are no instances to balance.
30. **Real-user monitoring. Built.** Sentry `browserTracingIntegration` with INP; 10% of visits by default
    (`NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`), no query strings or email sent, no trace headers on API calls. Off
    without a DSN. `src/lib/monitoring.ts`.
31. **Slow-device testing. Built.** `PERF_THROTTLE=1` runs every screen at fast 3G and 4x CPU; the numbers in B came
    from it, and the CLS fixes came from its layout-shift traces.

### UX

1. **Skeletons. Already done** (fixed in item 9 above).
2. **Optimistic updates. Already done.** Shop purchases, equip, quest claims and exam answers update at once and roll back on failure; payments never do.
3. **Command menu. Already done** (Ctrl K); now lazy-loaded.
4. **Shortcut hints. Already done** (`useShortcutLabel`, ⌘ vs Ctrl; typing guards in `lib/keys.ts`).
5. **Undo toasts. Already done** (UX details pass).
6. **Stale-while-revalidate. Already done** (`useRevalidate` on focus and reconnect).
7. **Link prerendering. Already done** (Next's `Link` prefetch in production).
8. **BlurHash. Skipped.** No photographic images.
9. **View transitions. Already done** (cross-document, under 300 ms, reduced motion respected).
10. **Swipe-to-dismiss sheets. Already done** (`ui/Modal.tsx`).
11. **Interruptible animations. Already done** (springs in the sheet and cards).
12. **Predictive back. Skipped.** Web app only.
13. **Touch targets. Already done** (44 px, checked by `e2e/mobile.spec.ts`).
14. **Safe areas. Already done** (`viewportFit: cover`, `--safe-*`).
15. **One-time codes. Already done** (`autoComplete="one-time-code"`, numeric keyboard in `CodeField`).
16. **Tabular numbers. Already done** (guarded by `ux-details.test.ts`).
17. **Balanced text. Already done** (guarded).
18. **Squircle corners. Already done** (guarded).
19. **Idempotency. Already done** (server-enforced keys on every create or spend).
20. **Safe triangle. Already done / not needed.** The only submenus are Radix menus, which have a pointer grace area.

Extra (from the weak-spot list): **quiz and exam keys bound before paint. Built** (`useLayoutEffect` in
`quiz/QuizQuestionView.tsx`, `exam/ExamRunner.tsx`).

## D. Files changed

New
- `perf/measure.spec.ts`, `playwright.perf.config.ts`: the speed harness.
- `src/server/test/queries.ts`, `src/server/queries.test.ts`: D1 round-trip counter and budgets for 20 routes.
- `src/components/shell/CommandPaletteLoader.tsx`: loads the palette on idle or first ⌘K.
- `src/lib/study/highlight.ts` (+ test): the trimmed highlighter.
- `public/_headers`: Cloudflare static asset caching.
- Tests: `src/app/(app)/template.test.tsx`, `src/hooks/useHUD.test.ts`, `src/components/ui/Skeleton.test.tsx`,
  `src/components/chat/ChatMarkdown.memo.test.tsx`, `src/styles/perf.test.ts`.
- `docs/performance-report.md` (this file).

Changed (client)
- `src/hooks/useHUD.ts`: `load()` shares a start-up request; visitors get the guest HUD without a request.
- `src/contexts/AuthContext.tsx`, `src/components/shell/AppShell.tsx`, `src/components/hero/HeroArea.tsx`: use it.
- `src/hooks/useHero.ts`: a shop load in flight is shared.
- `src/components/shell/StudyWorkspace.tsx`: courses load with documents; no second ask for the course record.
- `src/app/(app)/template.tsx`: no fade on the first page of a visit.
- `src/app/login/page.tsx`, `src/components/fx/TextReveal.tsx`, `src/components/fx/fx.css`: CSS entrances.
- `src/components/shell/CommandPalette.tsx`, `NavSidebar.tsx`, `AppShell.test.tsx`: palette behind the loader.
- `src/components/chat/ChatMarkdown.tsx`: memoised; trimmed highlighter.
- `src/components/ui/Skeleton.tsx`, `course/CourseOverview.tsx`, `course/course.css`, `today/today.css`: no jumps.
- `src/components/quiz/QuizQuestionView.tsx`, `exam/ExamRunner.tsx`: layout-effect key binding.
- `src/fonts/geist.ts`, `src/fonts/GeistMono-Variable.woff2`: subset, not preloaded.
- `src/lib/monitoring.ts` (+ test), `.env.local.example`: Web Vitals via Sentry.

Changed (server)
- `src/server/context.ts`: account row from the session.
- `src/server/plans.ts`, `invites.ts`, `billing.ts`: per-request plan cache and `forgetTier`.
- `src/server/study/review.ts`, `courses.ts`, `documents.ts`, `study/conceptMap.ts`: batched reads.
- `src/server/study/exams.ts`, `game/arena.ts`: batched writes.
- `src/server/game/avatar.ts`, `game/shop.ts`: HUD reads in parallel, reused by the shop.
- `src/server/auth/mailer.ts` (+ test): Resend timeout.

Other
- `package.json`, `package-lock.json`: six unused packages and `rehype-highlight` out; `lowlight`, `highlight.js`,
  `hast-util-to-text`, `unist-util-visit`, `@types/hast` declared (they were already installed as sub-dependencies).
- `scripts/remove-old-files.mjs`: deletes the empty `src/hooks/useApi.ts`.
- `.gitignore`: `perf/results/`.
- `docs/coursemateai-context.md`: the pass, new gotchas, updated weak spots.

## E. Still open (needs infrastructure, access or a decision)

- **Screens wait for /auth/me.** The biggest remaining cost on a slow phone. Options: render the shell and the screen's
  skeleton while the check runs (client change, moderate risk), or read the session in a server component and send
  the user with the HTML (bigger change). Needs a decision.
- **Better Auth cookie cache** would save one more D1 round trip per call; declined for now (revoked sessions would
  live up to 5 minutes).
- **Smart Placement** for the Worker: try on the live account, compare real latency in Cloudflare's dashboard.
- **Real latency and INP:** set `NEXT_PUBLIC_SENTRY_DSN` at build time and read Sentry's Web Vitals after a week.
- **Layout shifts left:** course overview header (~0.13 on 3G: the header changes when the course record arrives),
  admin page 0.045 (the accounts list pushes the AI spend card), Today and Champion ~0.04.
- **Live check of `public/_headers`:** after the next deploy, `curl -I https://<domain>/_next/static/chunks/<any>.js`
  should show `max-age=31536000, immutable`.

## F. Test results

- TypeScript: passes (`tsc --noEmit`).
- Lint: the project has no lint script; nothing run.
- Unit (vitest): 100 files, 1,249 tests pass (before: 93 files, 1,197).
- e2e (Playwright, production build): 252 passed, 59 skipped on purpose; same as before the pass.
- Cloudflare build: passes; 2716.6 KiB gzip (limit 3 MB).
- Failures before the pass: none in this sandbox.
- New issues found: the `Skeleton` sizing bug (fixed); four small layout shifts exposed by the earlier first paint
  (listed in E).

## G. Next five, by expected benefit

1. **Show the shell and skeletons before /auth/me answers** (or check the session on the server): about 0.6 to 1 s off
   every app screen on 3G.
2. **Turn on Sentry Web Vitals in production** and fix whatever the real INP and LCP show first.
3. **Try Smart Placement** for the Worker: routes with 4 to 7 D1 round trips gain most.
4. **Fix the course header shift**: keep the header in a loading state until the course list or the document is known.
5. **Trim the shared JavaScript**: the biggest movable piece is `motion` (about 50 KB gzip on every page); replacing the
   few drag and layout uses with CSS would let it load only where it animates.
