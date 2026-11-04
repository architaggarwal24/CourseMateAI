# Arena v2 — design spec

Status: agreed direction (tactical combat + mistake-driven bosses + roguelite Expedition). Multiplayer = "coming soon" card only.

The existing server-authoritative engine (`backend/services/arena_service.py`) stays the foundation: the server owns
the boss, hearts, clock, answers and rewards; the browser only sends choices. Everything below extends it.

## 1. Modes

| Mode | What it is |
|---|---|
| **Quick Battle** | One boss on a topic (today's arena), now with tactical turns. |
| **Nemesis** | A boss built from the concepts *you* keep missing on this document (quiz, flashcards, arena). Needs ≥ 3 missed concepts. |
| **Expedition** | Roguelite run through the document: 3 acts (chapters) × a branching node map, hearts carry over, relics, run gold, act bosses. |
| **Multiplayer** | Locked "coming soon" tile. No backend. |

## 2. Tactical turn loop

Each turn:

1. Server shows the boss's **intent** for this turn (telegraph), e.g. `Heavy Slam · 3 dmg`.
2. Player picks a **move** (and may cast spells / use items).
3. Server issues a question whose tier matches the move; clock starts.
4. Player answers → server resolves damage both ways, rolls the **next intent**, returns everything in one response.
5. Client animates the verdict and goes straight to step 1 (no "Next question" click; explanation stays expandable).

### Focus (resource)
- 0..5 (relics can raise cap/start). +1 per correct answer. Spent on Heavy and spells. Shown as pips.
- Combo is kept as the damage-bonus streak (reset on wrong), separate from Focus.

### Moves
| Move | Question tier | Damage | Time | Cost / effect |
|---|---|---|---|---|
| `strike` | medium | 1.0× | base (30s + gear) | — |
| `jab` | easy | 0.6× | 15s + gear | +1 extra Focus on correct |
| `heavy` | hard | 1.8× | base | costs 2 Focus (refused if not enough) |
| `guard` | medium | 0 | base | correct → this turn's intent fully blocked + 1 extra Focus |

If the pool has no question of the wanted tier, fall back to the nearest tier; damage follows the **move**, not the fallback tier.

### Spells (cost Focus, cast while a question is open)
- `insight` (1 Focus): remove two wrong options (same as 50/50 item).
- `timewarp` (1 Focus): +15s on the current deadline.
Inventory items `heal` and `fifty_fifty` keep working as today.

### Boss intents
Rolled server-side after each turn from a weighted table (phase 2 / rage unlocks the stronger ones), stored on the battle
and exposed in state as `intent = {kind, name, value, description}`.

| Intent | Effect when the turn resolves |
|---|---|
| `attack` (value = base dmg) | Wrong/timeout: full damage. Correct: half (floor). Correct + guard: 0. |
| `heavy` (value = 2× base) | Same mitigation as attack. The reason Guard exists. |
| `shield` (value = HP) | Boss gains a shield absorbing `value` damage of the player's next hits. Weakness hits ignore shields. |
| `drain` | Wrong/timeout: player loses all Focus. Correct: nothing. |
| `heal` (value = % max HP, ~8%) | Boss heals unless the player answers correctly with `strike` or `heavy` (interrupt). |

Base damage keeps `DIFFICULTY_DAMAGE_MAP` (easy 1/1, medium 1/2, hard 2/3, nightmare 3/5). Weakness ×2, weapon %,
pet strike at combo ≥ 3 all stay.

## 3. Concept mastery & Nemesis

New table `concept_mastery(user_id, doc_hash, concept_key, concept, seen, correct, wrong_streak, last_seen_at, last_wrong_at)`.
Written by: arena answers, server-graded quiz answers, and a new flashcard review endpoint
(`POST /study/flashcards/review {session_id, concept, correct}`).

- `GET /arena/weak-concepts?session_id=` → top weak concepts (weighted by misses + recency).
- Nemesis battle = `POST /arena/battles {mode: "nemesis"}`: topic built from weak concepts; question generation is
  told to target exactly those concepts. 409 `not_enough_data` when fewer than 3 missed concepts exist.
- Every finished battle's result carries `missed: [{concept, question, correct_answer, explanation}]` ("loot").
- `GET /study/review-deck?session_id=` → flashcards built from stored missed arena/quiz questions (no LLM call).

## 4. Expedition (roguelite run)

- `POST /arena/runs {session_id, difficulty}` → LLM extracts 3 acts (chapter title + topic) from the document; server
  builds a seeded map per act: 4 layers of 2–3 nodes + a boss node, edges only between adjacent layers.
- Node kinds: `battle`, `elite` (harder boss, relic choice), `nemesis` (only when weak data exists), `rest`, `shop`,
  `treasure`, `boss` (act boss; relic choice; next act).
- Run state: hearts / max hearts (carry over), gold, relics, focus cap, act, current node, status
  (`active | won | lost | abandoned`), score. One active run per user per document.
- `POST /arena/runs/{id}/travel {node_id}` (must be reachable). Fight nodes create an `arena_battles` row with `run_id`;
  when it ends, hearts/gold/relic offers flow back into the run.
- `rest`: heal 30% max hearts **or** study one missed concept (+1 Focus at the start of every remaining battle this act).
- `shop`: spend run gold on relics / potions. `treasure`: one random relic.
- Relics: `backend/content/relics.json` (~12: owl_feather +5s, whetstone heavy costs 1, aegis first wrong per battle
  blocked, phoenix_ash revive once at 3 hearts, scholar_lens weakness ×3, quill jab +2 Focus, hourglass free timewarp per
  battle, lucky_coin +25% gold, iron_will +2 max hearts, focus_crystal start battles with 2 Focus, vampiric_tome heal 1
  at combo 5, ink_bomb boss shields halved).
- Battles inside a run don't pay rewards individually; the run end pays one `expedition_complete` reward scaled by depth.
- Score board per document + global weekly.

## 5. Leaderboards
Quick/Nemesis keep per-topic boards and add `scope=global` (weekly, by difficulty, any topic) so the board is never empty.

## 6. Non-goals (now)
Multiplayer, typed/LLM-graded answers, drag-to-order formats.

## 7. Implementation notes (backend, sections 2–5)

Code: `services/arena_service.py` (turns, intents, Focus, spells), `core_brains/boss_brain.py` (intent table,
`player_hit`, act extraction), `services/mastery_service.py`, `services/expedition_service.py`,
`content/relics.json`, migration `0007_arena_v2.sql`. Tests: `tests/test_arena_v2_*.py`.

Decisions where the spec left room:
- The move is chosen when the question is **issued**: `GET /arena/battles/{id}/question?move=strike|jab|heavy|guard`
  (default `strike`). Heavy's Focus is paid at issue (409 `not_enough_focus`); a refresh returns the same question
  with the move it was issued for.
- Intent odds: phase 1 attack 55 / heavy 10 / shield 20 / drain 15; phase 2 attack 35 / heavy 25 / shield 15 /
  drain 10 / heal 15. Shield = 10% boss max HP. Heal intent: `value` = 8 (%), `amount` = HP.
  Shield / drain / heal turns cost no hearts. Guard "fully blocks" attack/heavy damage; only a right strike/heavy
  interrupts a heal. Intents are rolled after each turn (with the new phase), so the telegraph never changes.
- Focus: +1 per right answer, +1 more for jab (Quill: +2 more) and guard; capped at 5. Combo is unchanged.
- Spells: `POST /arena/battles/{id}/spells {spell}`, each once per question; insight and the 50/50 item share
  the "two options removed" slot.
- Relics: Aegis blocks the first wrong answer per battle that would cost hearts; Phoenix Ash revives mid-battle
  (3 hearts) once per run; Vampiric Tome heals at every combo multiple of 5; Ink Bomb halves the telegraphed shield.
- Quiz answers without a `concept` count for the quiz topic. Flashcard reviews update mastery only (no deck row).
- Expedition: layer 0 is always battles; elite / act boss are one difficulty up with ×1.25 / ×1.5 HP. Any lost run
  battle (including a forfeit or hitting the answer cap) ends the run. Boss personas are still generated per fight
  (the "LLM once" rule is for the act extraction). Gold: battle 20, nemesis 30, elite 40, boss 60.
  Score: battle 100, nemesis 150, elite 200, boss 400, other nodes 25, +1000 + 20/heart for a full clear.
  `expedition_complete` is paid once per run when depth ≥ 1, `difficulty` = min(2, 0.8 + 0.08·depth (+0.3 won)).
- Weekly boards (battles `scope=global`, runs `scope=global`) start Monday 00:00 UTC.
- Review fixes: a spent per-phase question budget no longer loses the battle (any mode) - it is a retryable 503 and
  each retry may try one more batch; spells are refused (409 `question_expired`) once the deadline has passed
  (the grace period is for answers only); abandoning mid-fight counts that fight's answers in the run accuracy;
  the answer that ends a run carries `result.run = {status, score, result, rewards: {expedition_complete}}`;
  pre-v2 battles get an intent rolled and stored on first read; `POST /arena/runs` with another difficulty than the
  active run is 409 `run_in_progress {run_id, difficulty}`; `GET /arena/runs/active` without session_id prefers a
  run whose document is still loadable (`run.document_ready`). Runs are keyed by session_id like battles: a
  re-upload starts a fresh run; the old one stays active until abandoned.

## 8. Creature mechanics, champion kits and champion levels (Phase 3, Stage 2)

Every fight plays differently: the boss's creature brings a signature rule, and the player's champion brings a
passive and an ultimate. All of it is server-authoritative. The browser shows it, and never decides it.

Code:
- Creature rules: `core_brains/mechanics.py` (one `Mechanic` class per creature).
- Champion kits and levels: `core_brains/kits.py`.
- Wiring: `services/arena_service.py`.
- Migration `0009_champion_progress.sql`.

Tests:
- `tests/test_arena_mechanics*.py` and `tests/test_arena_kits*.py`.
- `tests/test_arena_balance.py`, a seeded bot that checks no creature is far off a plain boss on any difficulty.

Each rule is shown in three places:
1. **Telegraphed** in the intent or the HUD: the boss's state carries `mechanic {id, name, summary, counters, locked_moves}` and `kit {meter, ready, active, passive, ultimate, effects}`, and special turns come as their own intent kinds.
2. **Said in the verdict**: every answer's outcome has `mechanic.events[]` and `kit.events[]` with the sentence to show, plus `riposte` and `dodged`.
3. **Animated** by FightScene beats.

### 8.1 Turn pipeline
`_resolve` runs the steps in this order:
1. `Turn.prepare()`, the creature's step: multipliers, "can't be halved", dodges, skipped blows, boss bonus damage.
2. `KitTurn.prepare()`, the champion's step: passive and armed ultimate.
3. Damage both ways, the usual rules.
4. `KitTurn.settle()`: refunds and the meter.
5. `Turn.settle()`: the creature's state moves on (heads, fury, coils, and so on).

The snapshot for both lives in `boss_json`:
- `mech`: the creature's state.
- `kit`: champion, meter, armed, wall, vanish, fortress, spent, library_pending.

Special turns are scheduled by `next_intent_for(boss, difficulty, turn)`. When nothing is scheduled, the usual weighted roll applies. A move a creature has locked is refused at issue with 409 `move_locked`.

### 8.2 The 13 creature mechanics
Numbers are listed as easy / medium / hard / nightmare where they vary.

| Creature | Mechanic | Rule |
|---|---|---|
| Hydra | Regrowth | Every miss grows a head (max 3). Each head heals 3/4/6/8 % max HP on a miss. A right Heavy cauterizes all heads. |
| Kraken | Tentacle Grab | Every 4th turn is a `grab`. Miss it and the move you used is locked for 1/1/2/2 turns. A right answer breaks free. |
| Sphinx | Riddle | Every 3rd question is a `riddle`, written as a riddle by the LLM. Right: ×1.5 damage and +1 Focus. Wrong: ⌈1.5 × base⌉ damage. Insight is refused (409 `riddle_no_insight`). |
| Kitsune | Fox-fire Illusion | Every 3rd question gets one fake option (the right answer of another question). Picking it costs 2 Focus. Insight and 50/50 remove the fake first. |
| Fenrir | Unchained | Fury +1 per turn. Its blows get +1 per 3/2/2/2 Fury, capped at +1/+2/+2/+3. Each third right answer in a row chains it (Fury goes to 0). |
| Ammit | Devourer of Hearts | Miss a concept already missed (earlier in the fight, or one a Nemesis targets) and it feasts: it heals 5/6/8/10 %, and each feast gives +1 blow damage (max 3). A right answer on such a concept is "lighter than the feather": ×2. |
| Minotaur | Labyrinth Charge | Every 4th turn a `charge` for base + turn/2 that a right answer can't halve. A right Guard stuns it: the next turn is `stunned` (no blow, your hit ×1.5). |
| Cyclops | Boulder Throw | Turn 4k−1 is `aim` (no blow). Turn 4k is `throw`, 3 × base damage that can't be halved. A right Guard or Jab dodges it. |
| Oni | War Drum | Every turn it takes no damage, the drum beats: +1 blow damage per beat (cap 2/2/3/3). A right Heavy breaks the drum. |
| Rakshasa | Shapeshift | Every 3rd turn its weakness moves to another concept from your document, and it raises a 5 % shield. |
| Naga | Serpent's Hoard | Every 4th turn is a `hoard`: a hard question. Right: ×1.5, +1 heart, +2 Focus. Wrong: venom, −1 heart on each of the next 2 turns. |
| Simurgh | Feathers of Wisdom | An answer slower than half the clock (or a timeout) heals it 2/3/4/5 %. A right answer faster than that plucks a feather: ×1.25. |
| Jörmungandr | World Coil | Every miss adds a coil (cap 1/1/2/3). The coils already on you squeeze 1 heart each per turn. A right Strike or Heavy removes one coil, a right Guard removes all. |

### 8.3 Champion kits
**Ultimate meter:** +25 per right answer, +10 more at combo 3+, capped at 100.
- Cast with `POST /arena/battles/{id}/ultimate` (rate limit 30/min). Refusals: 409 `ultimate_not_ready` or `ultimate_active`.
- It can be cast while choosing a move or while a question is open.
- UI: the meter is in the HUD, the button is in the items row, and the key is **U**.

| Champion | Passive | Ultimate |
|---|---|---|
| Kaien | **Riposte**: a right Guard against a blow hits back for ½ a Strike. | **Ninth Page Cut**: next right answer ×2.5 and ignores shields. |
| Asha | **Reach**: Jab ×0.8 (not 0.6). | **Dawn Wall**: for 2 turns blows are halved and every right answer gives +1 Focus. |
| Brak | **Iron Combo**: combo bonus doubled (+6 per step) and capped at 8 (not 5). | **Iron Rush**: next right answer × (1 + 0.25 × combo). |
| Mira | **Quiet Study**: a spell's Focus comes back if you answer right. | **Arcane Library**: free Insight and Timewarp, and the next right answer ×2. |
| Vex | **Shadowstep**: dodge chance 25 / 20 / 20 / 15 %. | **Vanish**: the next 2 blows miss, and the next right answer ×1.5. |
| Thorne | **Bulwark**: a right answer cuts a blow to ⅓ (not ½). | **Last Chapter**: +3 hearts now, and the next turn's blow is fully blocked. |

The kit is snapshotted when the battle is created, so switching champion mid-fight changes nothing.

### 8.4 Champion progression
- Each champion has its own XP, stored in `champion_progress(user_id, champion_id, xp, level, battles, wins)`, migration 0009.
- XP per battle = 10 × right answers + 50 for a win. It goes to the champion that fought.
- Level thresholds: 0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700 (Lv 1–10).
- Mastery skins, three per champion, 18 items `mastery_<champion>_<outfit|head|weapon>`:
  - outfit at Lv 3, head piece at Lv 6, weapon finish at Lv 10;
  - cosmetic, never sold (purchase refused, hidden in the shop);
  - granted on the level-up and wearable only by that champion (equip refused for others, dropped from the loadout when you switch).
- Where it shows:
  - the answer that ends a battle carries `result.champion {id, xp_gained, xp, level, leveled_up, next_level_xp, unlocked[]}`;
  - `GET /avatar/champion` returns `progress` per champion: level, XP, mastery and the kit's text.

### 8.5 FightScene beats (frontend)
`beatsFor(outcome, battle)` in `BattleScreen.tsx` plays the beats in this order:
1. Boosts before your blow: `feather`, `ultimate_hit`.
2. Your strike.
3. What your strike set off: chains, broken drum, treasure, plucked feather, uncoil, Focus refund, and so on.
4. Rage.
5. The boss's blow: a swing, a `charge` (a long rush), a `throw` (a boulder in an arc), or a `dodge` (the hero hops back, see-through).
6. `stunned` or `fortress`.
7. `riposte`.
8. The creature's own move: regrowth, devour, riddle failed, illusion, grab, drum, venom, poisoned, wisdom, squeeze, shapeshift.
9. KO.

Casting an ultimate plays the `ultimate` beat: a ring in the champion's accent colour, motes, and the name as a banner.

Each effect's look is pure data in `MECHANIC_FX` (`lib/pixel/fight.ts`): who acts, pose, colour, motion and an optional call-out such as GRABBED, CHAINED or STUNNED. A test reads `t.event("…")` from the backend and fails if any server event has no beat, or if a beat has no server event. Reduced motion keeps the poses and rings, but drops particles, shake and dashes.
