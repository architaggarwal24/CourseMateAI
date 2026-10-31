# Stage 5 — Polish, accessibility, performance, review fixes

Unzip over `CourseMateAI/` after Stage 4. 29 files (frontend + 2 backend files + README). No new packages.

## ⚠ A Stage 1 regression is fixed here
Stage 1 rewrote `globals.css` and **dropped the Appearance-settings CSS**: "Large text" did nothing, the in-app "Reduce
animations" switch only stopped a few effects, and the chat typing dots lost their bounce. All restored, and a new unit
test now fails the build if that CSS ever goes missing again. The in-app switch now also drives every motion/react animation
(it used to follow only the OS setting).

## Independent frontend review: 12 findings, all fixed
1. Expedition: if opening a run's fight failed, the map re-mounted and retried forever (one error toast per loop) → the map stays mounted; each fight is auto-opened once; a "Return to the fight" button otherwise.
2. A question that timed out re-bought the same move (Heavy charged Focus twice) and skipped the move choice → the miss is now settled by reading the battle, then you choose your next move.
3. Q/W/E/R and 1–4 fired behind the Retreat dialog, the account menu, the ⌘K palette → one shared guard (`lib/keys.ts`) for arena, quiz and flashcard shortcuts.
4. Flashcards: a swipe + click could mark a card twice and crash on the last card → one mark per card, timer cleaned up.
5. A slow item/spell response could overwrite the next turn's state → stale responses are dropped.
6. Refreshing mid-question showed a move picker that did nothing → the battle now says `question_issued` (small backend addition + test) and the screen goes straight back to the question.
7. Hovering the verdict paused auto-advance forever → it resumes when the pointer/focus leaves.
8. Focus fell to the page body on every arena panel swap → "Your move" and the result heading take focus; flashcards keep focus on the deck.
9. In-app Reduce animations ignored by motion/react (see above).
10. The battle screen re-rendered 4×/s for the clock → the timer ticks by itself; the scene is memoised.
11. Spotlight and border-beam effects fought over the same pseudo-elements on legendary items → separate ring element; rarity stripe moved to an inset shadow.
12. Smaller: page transition left a `filter` that would trap fixed elements; ⌘K opened on top of another modal; animated numbers flashed their final value; login spinner could stick if the server was unreachable.

Plus: the 3D core is skipped on software-only WebGL (no GPU) where it would hog the CPU; a contrast fix on the selected shop category; README updated.

## Verified
- Frontend unit tests: **445/445**, repeated runs clean. Typecheck + production build pass.
- **E2E (Playwright: axe accessibility on every screen, keyboard order, 360px phones, reduced motion, full arena battles): 117 passed, 0 failed** (17 are intentionally skipped by the suite).
- Backend: **834 passed** (the 1 known failure needs internet DNS).

## What to test
1. `npm test` → 445/445. `npm run build` passes. Backend `pytest -q` → 834 passed.
2. Account → Settings → Appearance: **Large** text now enlarges the app; **Reduce animations** stops page fades, card springs, arena shake, aurora, stars.
3. Arena: open the Retreat dialog and press Q or 1 → nothing happens behind it. Let a question time out → you get the move choice again, Focus untouched.
4. Refresh in the middle of a question → you land back on that same question with its clock.
5. Flashcards: after flipping, swipe and click "Got it" at the same moment on the second-to-last card → no crash, one mark.
6. Optional e2e: `npx playwright install chromium` once, then `npm run test:e2e`.
