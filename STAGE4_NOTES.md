# Stage 4 — Arena v2 + Hero game UI ("arcane glass")

Unzip over `CourseMateAI/` **after Stage 3** (this UI talks to the Stage 3 backend). No new packages (three / R3F / drei came in Stage 1).

## What's new
**Arena hub** (Hero → Arena): four mode cards that tilt under the pointer — Quick Battle, Nemesis (shows your weak spots,
locked until 3 concepts are missed), Expedition (shows a run in progress), Multiplayer (coming soon) — plus this week's
leaderboard across every topic.

**Tactical battle**
- Each turn starts with **Your move**: the boss's telegraphed intent (Attack / Heavy / Shield / Drain / Heal, with what counters it)
  and four move cards — **Strike, Jab, Heavy, Guard** (keys **Q W E R**). Heavy is greyed out without enough Focus.
- HUD: hearts, **Focus pips**, combo, boss HP with a shimmering **shield** segment, the current intent.
- Question with **spells**: Insight (removes two wrong options) and Timewarp (+15s), each 1 Focus.
- Verdict explains everything that happened (shield absorbed, blocked, interrupted heal, Focus gained/drained, relic effects)
  and **moves on by itself** (≈2s after a right answer, 6s after a wrong one; hover to hold; Enter/Continue skips). It shows the boss's next intent.
- Scene: a **3D crystal core** (Three.js) behind the fight that spins faster and turns red in rage and pulses on hits;
  the stage shakes on a hit; the boss glows in its intent's colour; new floating numbers (Blocked, Shielded, +Focus, boss heal).
  The 3D part loads only when WebGL exists and reduced motion is off.
- Result: **Study scrolls** — the questions you missed, with a button that opens them as flashcards.

**Nemesis**: summon screen lists your weak concepts; one click to face the boss made of them.

**Expedition**: start screen with difficulty → act map (layers of nodes joined by curved paths; the walked path is lit gold,
reachable nodes glow and pulse), status bar (act, hearts, gold, score, relics with tooltips), rest / shop / relic-choice panels,
abandon with confirmation, and an end-of-run summary. Fight nodes open the battle screen with the run's status above it.

**Flashcards**: "Review N missed questions" deck from the server (no AI call), and every Got it / Missed now feeds concept mastery.

**Hero tabs**: glass panel; HUD with a light sweeping the XP bar, coins/level that pop when they change, a flickering streak flame;
item cards lit by the pointer in their rarity colour (legendary cards get a running border light); quests pulse gold when ready to claim.

**Tests**: key handlers rewritten so a key pressed the instant a question appears is never lost (this was a source of
flaky tests on slower machines); test async timeout raised to 3s. 443 tests, ran 4× clean.

## What to test (backend from Stage 3 running, a PDF uploaded)
1. `npm test` → **443/443**; `npm run build` passes.
2. Hero → Arena → **Quick Battle**: summon → read the intent → press **Q** (Strike) → answer with 1–4 → watch the verdict auto-advance.
   Try **Guard** when the intent is a Heavy hit; build Focus and use **Heavy** (E); cast **Insight**/**Timewarp**.
3. Get some questions wrong (quiz or arena) → Arena hub → **Nemesis** shows them → fight it.
4. Finish/lose a battle → result shows **Study scrolls** → "Review them as flashcards" opens the review deck.
5. **Expedition** → Begin → map: pick a glowing node → fight → back to the map; try a Rest, a Shop, a relic pick; Abandon.
6. Refresh mid-battle and mid-expedition: you land back where you were.
7. Settings → Reduce animations: 3D core, shake and pulses stop.
8. Phone width: moves stack in one column, map nodes shrink.
