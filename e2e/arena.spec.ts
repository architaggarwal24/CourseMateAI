import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// A whole battle in a real browser, against a small stand-in for the battle API (same contract as src/server/game/arena.ts;
// the server's own tests cover the rules). Win, lose and retreat, keyboard answering, the sprites actually painted,
// and axe on every state of the screen.

const BANK = [
  { question: "Which organelle makes ATP?", options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], correct: "Mitochondria" },
  { question: "Where is DNA stored?", options: ["Vacuole", "Nucleus", "Lysosome", "Membrane"], correct: "Nucleus" },
  { question: "Which sugar is in DNA?", options: ["Ribose", "Glucose", "Deoxyribose", "Fructose"], correct: "Deoxyribose" },
];
const PROFILE = { name: "Cell Warden", species: "minotaur", origin: "Greek", tagline: "Guardian of cells", intro_taunt: "You will not pass.", weakness: "Nucleus",
  phase2_taunts: ["THE WALLS CLOSE IN!"] };

async function battleServer(page: Page, opts: { signature?: boolean; joins?: string; enrage?: boolean; knock?: boolean; finale?: boolean } = {}) {
  await mockApi(page, opts.joins ? { ceremony: opts.joins } : {});
  let battle: any = null, seq = -1, answered = false;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const end = (status: "won" | "lost") => {
    battle.status = status;
    battle.result = { grade: status === "won" ? "A" : "F", accuracy: Math.round((battle.correct / Math.max(1, battle.answered)) * 100), time_seconds: 42, new_personal_best: status === "won" };
    battle.rewards = { arena_round_complete: null, boss_defeat: status === "won" ? { ok: true, xp_gained: 50, coins_gained: 25 } : null };
    if (status === "won" && opts.joins) battle.result.champions_unlocked = [opts.joins];
    if (status === "won" && battle.taunted) battle.result.taunt_bonus = { xp: 13, coins: 6 };
    if (battle.gauntlet_id) {
      if (status === "won") stage += 1;
      battle.result.gauntlet = status === "won"
        ? { gauntlet_id: "g1", kind: "survival", stage, over: false, status: "active", next: { power: 30 + 5 * stage }, next_chest_at: 5,
          chest: { size: "chest", at: 5, coins: 120, xp: 60, items: [{ id: "potion_health_small", name: "Small Health Potion", kind: "potion" }] } }
        : { gauntlet_id: "g1", kind: "survival", stage, over: true, status: "lost", chest: null, result: { status: "lost", stage, score: 1500, power: 42, chests: 1, accuracy: 60 } };
    }
    battle.result.score = { points: 840, speed: 140, finisher: opts.finale && status === "won" ? 1000 : 0, hearts: status === "won" ? 500 : 0, best_combo: battle.max_combo, best_level: 1, specials: 0, continues: 0, total: 2340, rank: "S" };
  };
  const makeBattle = (): any => ({ battle_id: "b1", status: "active", session_id: "s", topic: "cells", difficulty: "medium", phase: 1, rage: false, prepared: true,
        boss: { name: "Cell Warden", hp: 20, max_hp: 20, species: "minotaur", title: "Warden of cells" }, player: { hp: 10, max_hp: 10 }, combo: 0, max_combo: 0, answered: 0, correct: 0, heals_used: 0, fifty_used: 0,
        mode: "quick", run_id: null, focus: 0, focus_cap: 5, shield: 0, heavy_cost: 2, free_timewarp: false, relics: [],
        intent: { kind: "attack", name: "Concept Crush", value: 5, description: "Hits for 5 on a wrong answer." },
        // Phase 3 Stage 2: the creature's mechanic and the champion's kit (meter already full, so U can be tried)
        mechanic: { id: "minotaur", name: "Labyrinth Charge", summary: "Every third turn it charges: a right answer can't halve it, a right Guard stuns it.",
          counters: [{ label: "Charge in", value: 2, hint: "turns until it charges" }], locked_moves: [] },
        kit: { champion: "kaien", meter: 100, max: 100, ready: true, active: false, effects: {},
          passive: { name: "Riposte", text: "A right Guard against a blow hits back for half a Strike." },
          ultimate: { name: "Ninth Page Cut", text: "Your next right answer hits x2.5 and cuts through shields." },
          signature: opts.signature ? { name: "Edge of the Ninth Page", text: "Riposte hits back for 75% of a Strike (not half).", finisher: "Final Cut" } : null } });
  // Stage 6: a Survival around the same fights (its first boss's win opens a chest)
  let stage = 0;
  const gauntlet = () => ({ gauntlet_id: "g1", kind: "survival", status: "active", topic: "cells", session_id: "s", power: 42, stage, hearts: battle?.player.hp ?? 10,
    max_hearts: 10, battle_id: "b1", score: 1500, chests: [], answered: 0, correct: 0, next_power: 30 + 5 * stage, next_chest_at: 5 });
  await page.route("**/api/v1/arena/power**", (route) => json(route, { ok: true, power: { power: 42, from_score: 20, from_hunts: 12, best_scores: [900], hunted: ["minotaur"] },
    rush: { unlocked: false, hunted: 1, need: 3, bosses: [{ species: "minotaur", name: "Minotaur" }], wins: 0, best: null }, survival: { best: null }, active: null }));
  await page.route("**/api/v1/arena/gauntlets**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/arena/gauntlets" || path.endsWith("/next")) {
      const hp = battle?.player.hp;
      battle = { ...makeBattle(), gauntlet_id: "g1", mode: "survival", prepared: false };
      if (path.endsWith("/next") && hp) battle.player.hp = hp;
      seq = -1; answered = false;
      return json(route, { ok: true, gauntlet: gauntlet(), battle_id: "b1", boss: PROFILE, battle });
    }
    return json(route, { ok: true, gauntlet: gauntlet() });
  });
  // Registered after mockApi, so it answers first.
  await page.route("**/api/v1/arena/battles**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (path === "/arena/battles/active") return json(route, { ok: true, battle: battle?.status === "active" ? { ...battle, boss_profile: PROFILE } : null });
    if (path === "/arena/battles") {
      battle = makeBattle();
      seq = -1; answered = false;
      return json(route, { ok: true, battle_id: "b1", resumed: false, boss: PROFILE, battle });
    }
    if (path === "/arena/battles/b1" && req.method() === "GET") return json(route, { ok: true, battle_id: "b1", boss: PROFILE, battle });
    if (path.endsWith("/prepare")) { battle.prepared = true; return json(route, { ok: true, battle_id: "b1", boss: PROFILE, battle }); }
    if (path.endsWith("/rearm")) return json(route, { ok: true, battle_id: "b1", boss: PROFILE, battle });
    if (path.endsWith("/question")) {
      if (seq < 0 || answered) { seq += 1; answered = false; }
      const q = BANK[seq];
      return json(route, { ok: true, battle, previous: null, stock: { heal: 1, fifty_fifty: 1 },
        question: { id: seq, number: seq + 1, question: q.question, options: q.options, phase: 1, weakness: false, fifty_used: false,
          time_limit: battle.finale ? 12 : 30, seconds_left: battle.finale ? 12 : 30, finale: !!battle.finale } });
    }
    if (path.endsWith("/answer")) {
      const body = req.postDataJSON();
      const q = BANK[body.question_id];
      const correct = body.answer === q.correct;
      answered = true; battle.answered += 1;
      const finaleTurn = !!battle.finale;
      let finaleArmed = false;
      if (correct) { battle.correct += 1; battle.combo += 1; battle.max_combo = Math.max(battle.max_combo, battle.combo); battle.boss.hp = Math.max(0, battle.boss.hp - (finaleTurn ? battle.boss.hp : 10)); }
      else { battle.combo = 0; battle.player.hp = Math.max(0, battle.player.hp - 5); }
      battle.finale = false;
      if (opts.finale && correct && !finaleTurn && battle.boss.hp > 0) {
        finaleArmed = true; battle.finale = true;
        battle.intent = { kind: "finale", name: "On its knees", value: 0, special: true, description: "One quick question for your FINAL MOVE." };
      }
      const knocked = !!opts.knock && !correct;
      if (knocked) { battle.player.hp = 0; battle.down = { deadline: new Date(Date.now() + 10_000).toISOString(), continues: 0, max: 3, coins: 100, can_continue: true }; }
      if (battle.boss.hp === 0) end("won"); else if (battle.player.hp === 0 && !knocked) end("lost");
      // Stage 3: the first right answer enrages it, and its next blow carries one of its own effects
      const enraged = !!opts.enrage && correct && !battle.rage;
      if (enraged) {
        battle.rage = true; battle.phase = 2;
        battle.intent = { kind: "fury", name: "Labyrinth Rampage", value: 10, hits: 2, special: true, description: "Its enraged blow.",
          effect: { id: "minotaur_daze", name: "Labyrinth Daze", kind: "lock", text: "one of your moves is locked for 2 turns" } };
      }
      return json(route, { ok: true, replayed: false, battle, rewards: battle.rewards ?? null, question_id: body.question_id, correct, timed_out: false, answer: body.answer, ...(enraged ? { phase_changed: true } : {}),
        ...(knocked ? { knocked_down: true } : {}), ...(finaleArmed ? { finale_armed: true } : {}),
        ...(finaleTurn && correct ? { finisher: { name: "Last Page Severance", champion: "kaien", style: null } } : {}),
        correct_answer: q.correct, explanation: `It is ${q.correct}.`, damage_dealt: correct ? 10 : 0, hit_type: "normal", weakness: false,
        damage_taken: correct ? 0 : 5, attack_name: correct ? undefined : "Concept Crush", taunt: correct ? "Hm." : "Ha!", combo: battle.combo,
        move: "strike", intent: battle.intent, next_intent: battle.status === "active" ? battle.intent : null });
    }
    if (path.endsWith("/ultimate")) {
      battle.kit = { ...battle.kit, meter: 0, ready: false, active: true, effects: { armed: "cut" } };
      return json(route, { ok: true, ultimate: { name: battle.kit.ultimate.name, text: battle.kit.ultimate.text, hearts: 0, insight: false, timewarp: false }, battle, question: null });
    }
    if (path.endsWith("/taunt")) {
      if (battle.taunted) return json(route, { error: { code: "taunt_used", message: "Once a fight is enough.", action: null, details: null } }, 409);
      battle.taunted = true; battle.rage = true; battle.phase = 2;
      battle.kit = { ...battle.kit, meter: Math.min(100, (battle.kit?.meter ?? 0) + 50), ready: (battle.kit?.meter ?? 0) + 50 >= 100 };
      return json(route, { ok: true, taunt: { meter_gain: 50, enraged: true, bonus_pct: 25 }, battle });
    }
    if (path.endsWith("/continue")) {
      battle.down = null; battle.player.hp = 10;
      return json(route, { ok: true, continued: { by: req.postDataJSON().with, continues: 1 }, battle, stock: { heal: 1, fifty_fifty: 1 } });
    }
    if (path.endsWith("/forfeit")) { end("lost"); return json(route, { ok: true, battle, rewards: battle.rewards }); }
    return json(route, { error: { code: "not_found", message: "Not found.", action: null, details: null } }, 404);
  });
}

async function axeClean(page: Page, label: string) {
  // On a phone the item bar can sit half under the tab bar until you scroll; axe counts a half-scrolled button as
  // obscured, so bring it into view first, as a player would.
  const items = page.locator(".arena-items");
  if (await items.count()) await items.first().scrollIntoViewIfNeeded();
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? ""})`).join(", ")}`).join("\n"), `axe on ${label}`).toBe("");
}

/** Arena v2: every turn starts with a move (Q = Strike). The verdict may already have moved on by itself and an
 *  Enter picked last turn's move again (Strike): then the question is already up. */
async function strike(page: Page) {
  const move = page.getByRole("heading", { name: "Your move" });
  await expect(move.or(page.locator(".arena--battle[data-stage=\"asking\"] .arena-question"))).toBeVisible();
  if (await move.isVisible()) await page.keyboard.press("q");
}

/** Stage 5: character select (Enter keeps your champion), then the VS screen (Enter once the questions are ready). */
async function throughVs(page: Page, check = false) {
  await expect(page.getByRole("heading", { name: "Select your champion" })).toBeVisible();
  if (check) await axeClean(page, "character select");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Ready. Press Enter to fight.")).toBeVisible();
  if (check) await axeClean(page, "vs screen");
  await page.keyboard.press("Enter");
}

async function summon(page: Page, check = false) {
  await page.goto("/arena");
  await page.getByRole("button", { name: /Quick Battle/ }).click();
  await page.getByLabel("Boss topic").fill("cells");
  await page.getByRole("button", { name: /Summon boss/ }).click();
  await throughVs(page, check);
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeVisible();
  await axeClean(page, "battle: move choice");
  await strike(page);
  await expect(page.getByText("Which organelle makes ATP?")).toBeVisible();
}

// Phones play the fight sideways: every fight below runs on a phone held sideways (the next test holds it upright).
test.beforeEach(async ({ page }, info) => {
  if (info.project.name.startsWith("mobile")) await page.setViewportSize({ width: 740, height: 360 });
});

test("phones: held upright the fight asks to be turned sideways; sideways it takes the whole screen", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("mobile"), "phones only");
  await battleServer(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/arena");
  await page.getByRole("button", { name: /Quick Battle/ }).click();
  await page.getByLabel("Boss topic").fill("cells");
  await page.getByRole("button", { name: /Summon boss/ }).click();
  await throughVs(page);                                                    // the menus work upright; the fight turns
  await expect(page.getByText("Turn your phone sideways")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeHidden();
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(page.getByText("Turn your phone sideways")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeVisible();
  // the app's bars step aside; HUD on top, the fighters in the middle, the moves at the bottom, all on one screen
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  const hud = (await page.locator("[aria-label=\"Battle status\"]").boundingBox())!;
  const stage = (await page.getByRole("img", { name: /Cell Warden, the boss/ }).boundingBox())!;
  const moves = (await page.getByRole("button", { name: /^Strike/ }).boundingBox())!;
  expect(hud.y).toBeLessThan(stage.y);
  expect(stage.y + stage.height).toBeLessThanOrEqual(moves.y + 1);
  expect(moves.y + moves.height).toBeLessThanOrEqual(360);
  await strike(page);
  const q = (await page.getByText("Which organelle makes ATP?").boundingBox())!;
  expect(q.y).toBeGreaterThan(stage.y + stage.height - 1);
  await expect(page.getByRole("button", { name: /Mitochondria/ })).toBeInViewport();
});

test("the boss enrages: its roar is the banner, it grows, its HP bar runs red, and its next blow is its own", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __banners: string[] }).__banners = []);
    new MutationObserver(() => document.querySelectorAll(".px-arena__banner").forEach((b) => {
      const t = b.textContent ?? "";
      if (!seen.includes(t)) seen.push(t);
    })).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await battleServer(page, { enrage: true });
  await summon(page);
  await page.keyboard.press("2");
  await expect(page.getByText(/It is enraged/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __banners: string[] }).__banners)).toContain("THE WALLS CLOSE IN!");
  await expect(page.locator(".fight[data-rage]")).toBeVisible();
  await expect(page.getByRole("status", { name: /Boss intent: Labyrinth Rampage/ }).first()).toContainText("Labyrinth Daze");
  await axeClean(page, "battle: enraged verdict");
});

test("the FINAL MOVE: on its knees, one quick question, the champion's finisher, then the score card", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __banners: string[] }).__banners = []);
    new MutationObserver(() => document.querySelectorAll(".px-arena__banner").forEach((b) => {
      const t = b.textContent ?? "";
      if (!seen.includes(t)) seen.push(t);
    })).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await battleServer(page, { finale: true });
  await summon(page);
  await page.keyboard.press("2");
  await expect(page.getByText(/on its knees: your FINAL MOVE is next/)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Final move!" })).toBeVisible();
  await axeClean(page, "battle: final move");
  await page.keyboard.press("Enter");
  await expect(page.getByText("FINAL MOVE", { exact: true })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByText("Last Page Severance! Your final move ends it.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __banners: string[] }).__banners)).toContain("LAST PAGE SEVERANCE");
  await page.getByRole("button", { name: "See result" }).click();
  const card = page.getByRole("region", { name: "Score card" });
  await expect(card.getByRole("img", { name: "Rank S" })).toBeVisible();
  await axeClean(page, "result: score card");
});

test("knocked down: CONTINUE? counts down; C pays coins and the fight goes on", async ({ page }) => {
  await battleServer(page, { knock: true });
  await summon(page);
  await page.keyboard.press("1");
  await expect(page.getByText(/You're down! Continue\?/)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Continue?" })).toBeVisible();
  await expect(page.getByRole("timer", { name: /seconds to continue/ })).toBeVisible();
  await axeClean(page, "battle: continue");
  const paid = page.waitForRequest((r) => r.url().endsWith("/continue") && r.method() === "POST");
  await page.keyboard.press("c");
  expect((await paid).postDataJSON()).toEqual({ with: "coins" });
  await expect(page.getByRole("heading", { name: "Your move" })).toBeVisible();
});

test("character select: the arrows pick another champion, the fight is armed for them, and VS opens it", async ({ page }) => {
  await battleServer(page);
  await page.goto("/arena");
  await page.getByRole("button", { name: /Quick Battle/ }).click();
  await page.getByLabel("Boss topic").fill("cells");
  await page.getByRole("button", { name: /Summon boss/ }).click();
  const group = page.getByRole("radiogroup", { name: "Select your champion" });
  await expect(group.getByRole("radio", { name: "Kaien" })).toHaveAttribute("aria-checked", "true");
  await expect(group.getByRole("radio", { name: "Kaien" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const picked = group.getByRole("radio", { checked: true });
  const name = (await picked.getAttribute("aria-label"))!;
  expect(name).not.toBe("Kaien");
  const saved = page.waitForRequest((r) => r.url().endsWith("/avatar/champion") && r.method() === "PUT");
  const armed = page.waitForRequest((r) => r.url().endsWith("/arena/battles/b1/rearm") && r.method() === "POST");
  await page.keyboard.press("Enter");
  expect((await saved).postDataJSON()).toEqual({ champion_id: name.toLowerCase() });
  await armed;
  await expect(page.getByRole("heading", { name: `${name} versus Cell Warden` })).toBeAttached();
  await expect(page.getByText("Ready. Press Enter to fight.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeVisible();
});

test("Survival from the hub: power level, the first boss, the chest, and the next boss straight to VS", async ({ page }) => {
  test.setTimeout(120_000);
  await battleServer(page);
  await page.goto("/arena");
  await expect(page.getByText("Power level")).toBeVisible();
  await expect(page.getByRole("button", { name: /Boss Rush/ })).toContainText("1/3 hunted");
  await page.getByRole("button", { name: /Survival/ }).click();
  await expect(page.getByRole("heading", { name: "Survival" })).toBeVisible();
  await axeClean(page, "survival start");
  await page.getByLabel("Topic for every fight").fill("cells");
  await page.getByRole("button", { name: /Start Survival/ }).click();
  await throughVs(page);
  await expect(page.getByRole("region", { name: "Survival status" })).toBeVisible();
  await strike(page);
  await expect(page.getByText("Which organelle makes ATP?")).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByText("Correct!")).toBeVisible();
  await page.keyboard.press("Enter");
  await strike(page);
  await expect(page.getByText("Where is DNA stored?")).toBeVisible();
  await page.keyboard.press("2");
  await page.getByRole("button", { name: "See result" }).click();
  await expect(page.getByText(/Boss 1 down/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Chest! Boss 5" })).toContainText("120 coins");
  await axeClean(page, "survival result with chest");
  await page.getByRole("button", { name: "Next boss" }).click();
  await expect(page.getByText("Ready. Press Enter to fight.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Select your champion" })).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeVisible();
});

test("WIN with the keyboard: the boss is drawn, the HUD is complete, and every state passes axe", async ({ page }) => {
  test.setTimeout(150_000);                                                 // four full axe scans: slow on a busy machine
  await battleServer(page);
  await summon(page, true);

  // The fight is really drawn: the pixel stage canvas has painted (many distinct colours, not an empty box).
  const stage = page.getByRole("img", { name: /Cell Warden, the boss, a Minotaur/ });
  await expect(stage).toBeVisible();
  await page.waitForTimeout(400);
  const colours = await stage.evaluate((el) => {
    const c = el as HTMLCanvasElement, d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data, seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return seen.size;
  });
  expect(colours).toBeGreaterThan(40);

  // HUD: boss HP, hearts, timer, combo, question and items are all on screen.
  await expect(page.getByRole("progressbar", { name: "Boss HP" })).toHaveAttribute("aria-valuenow", "20");
  await expect(page.getByRole("img", { name: "10 of 10 hearts" })).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: /Heal/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /50\/50/ })).toBeVisible();
  await axeClean(page, "battle: question");

  await page.keyboard.press("2");
  await expect(page.getByText("Correct!")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeFocused();
  await axeClean(page, "battle: verdict");
  await page.keyboard.press("Enter");
  await strike(page);
  await expect(page.getByText("Where is DNA stored?")).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByText("Cell Warden is defeated!")).toBeVisible();
  await expect(page.getByRole("button", { name: "See result" })).toBeFocused();
  await page.keyboard.press("Enter");                                       // the focused button: no wait for the slide-in to settle
  await expect(page.getByRole("heading", { name: "Victory!" })).toBeVisible();
  await expect(page.getByText("+50 XP")).toBeVisible();
  await axeClean(page, "result: victory");
});

test("LOSE: two wrong answers end the fight; the result screen offers another battle", async ({ page }) => {
  await battleServer(page);
  await summon(page);
  await page.keyboard.press("1");
  await expect(page.getByText("Not quite")).toBeVisible();
  await expect(page.getByRole("img", { name: "5 of 10 hearts" })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await strike(page);
  await expect(page.getByText("Where is DNA stored?")).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByText("You have fallen.")).toBeVisible();
  await page.getByRole("button", { name: "See result" }).click();
  await expect(page.getByRole("heading", { name: "Defeated" })).toBeVisible();
  await axeClean(page, "result: defeat");
  await page.getByRole("button", { name: "Battle again" }).click();
  await expect(page.getByRole("heading", { name: "Quick Battle" })).toBeVisible();
});

test("RETREAT, and a reload in the middle of a fight resumes it", async ({ page }) => {
  await battleServer(page);
  await summon(page);
  await page.reload();                                                       // the battle is found again on load
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeVisible();
  await strike(page);                                                        // the issued question comes back
  await expect(page.getByText("Which organelle makes ATP?")).toBeVisible();
  await page.getByRole("button", { name: /Retreat/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retreat" }).click();
  await expect(page.getByRole("heading", { name: "Retreated" })).toBeVisible();
});

test("the creature's mechanic is in the HUD, and U casts the champion's ultimate once", async ({ page }) => {
  await battleServer(page);
  await summon(page);
  await expect(page.getByRole("group", { name: "Creature mechanic: Labyrinth Charge" }).first()).toBeVisible();
  const meter = page.getByRole("progressbar", { name: "Ultimate: Ninth Page Cut" }).first();
  await expect(meter).toHaveAttribute("aria-valuetext", "Ninth Page Cut ready");
  const cast = page.waitForRequest((r) => r.url().endsWith("/ultimate") && r.method() === "POST");
  await page.keyboard.press("u");
  await cast;
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("button", { name: /Ninth Page Cut/ })).toBeDisabled();
  await axeClean(page, "battle: ultimate cast");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the sprites do not shake when hit", async ({ page }) => {
    await battleServer(page);
    await summon(page);
    await page.keyboard.press("2");
    await expect(page.getByText("Correct!")).toBeVisible();
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && ((a as CSSAnimation).animationName ?? "").startsWith("arena-")).length);
    expect(running).toBe(0);
  });
});

// Stage C1: Kaien with his own mastery weapon ends the fight with his finisher; the win that finishes a Bestiary tier
// brings a champion, met from the result screen.
test("the signature weapon's finisher ends the fight, and a champion who joins is met from the result", async ({ page }) => {
  await battleServer(page, { signature: true, joins: "asha" });
  // every banner the stage shows, in order (a banner is on screen for a second or two: easy to miss by polling)
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __banners: string[] }).__banners = []);
    new MutationObserver(() => document.querySelectorAll(".px-arena__banner").forEach((b) => {
      const t = b.textContent ?? "";
      if (!seen.includes(t)) seen.push(t);
    })).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await summon(page);
  // (a phone held sideways keeps the HUD to one slim row: the signature weapon's line is on desktop)
  if (!test.info().project.name.startsWith("mobile")) await expect(page.getByText("Signature weapon · Edge of the Ninth Page")).toBeVisible();
  await page.keyboard.press("2");
  await page.getByRole("button", { name: /Continue/ }).click();
  await strike(page);
  await expect(page.getByText("Where is DNA stored?")).toBeVisible();
  await page.keyboard.press("2");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __banners: string[] }).__banners), { timeout: 10_000 })
    .toEqual(expect.arrayContaining(["FINAL CUT", "VICTORY"]));
  const order = await page.evaluate(() => (window as unknown as { __banners: string[] }).__banners);
  expect(order.indexOf("FINAL CUT")).toBeLessThan(order.indexOf("VICTORY"));  // the finisher, then the win
  await page.getByRole("button", { name: "See result" }).click();
  await expect(page.getByText("Asha joins you!")).toBeVisible();
  await page.getByRole("button", { name: "Meet Asha" }).click();
  const dialog = page.getByRole("dialog", { name: "Asha joins you" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Claim reward" }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

// Stage A2: the taunt (once a fight: the boss rages), then a victory emote from the wheel.
test("taunt the boss mid-fight, win, and act out a victory emote", async ({ page }) => {
  await battleServer(page);
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __banners: string[] }).__banners = []);
    new MutationObserver(() => document.querySelectorAll(".px-arena__banner").forEach((b) => { const t = b.textContent ?? ""; if (!seen.includes(t)) seen.push(t); }))
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  await summon(page);
  const tauntBtn = page.getByRole("button", { name: /^Taunt/ });
  await expect(tauntBtn).toBeEnabled();
  const sent = page.waitForRequest((r) => r.url().endsWith("/taunt"));
  await page.keyboard.press("t");
  await sent;
  await expect(page.getByRole("button", { name: /^Taunted/ })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __banners: string[] }).__banners), { timeout: 10_000 }).toContain("ENRAGED!");

  await page.keyboard.press("2");
  await page.getByRole("button", { name: /Continue/ }).click();
  await strike(page);
  await expect(page.getByText("Where is DNA stored?")).toBeVisible();
  await page.keyboard.press("2");
  await page.getByRole("button", { name: "See result" }).click();
  await expect(page.getByRole("heading", { name: "Victory!" })).toBeVisible();
  await expect(page.getByLabel("Taunt bonus")).toContainText("+13 XP");
  const wheel = page.getByRole("list", { name: "Emotes" });
  await expect(wheel.getByRole("button", { name: /Victory Dance, locked/ })).toBeDisabled();
  await wheel.getByRole("button", { name: "GG", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "GG!" })).toBeVisible();
  await axeClean(page, "result: emote");
});

test("chiptune: the fight has music and effects, the music switch stops it, and the sound switch is remembered", async ({ page }) => {
  await battleServer(page);
  // count every synthesized note (oscillators and noise) the page starts
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: number };
    w.__notes = 0;
    for (const P of [OscillatorNode.prototype, AudioBufferSourceNode.prototype] as unknown as { start: (...a: unknown[]) => void }[]) {
      const start = P.start;
      P.start = function (this: unknown, ...a: unknown[]) { w.__notes++; return start.apply(this, a); };
    }
  });
  const notes = () => page.evaluate(() => (window as unknown as { __notes: number }).__notes);
  await summon(page);
  await expect.poll(notes, { timeout: 5_000 }).toBeGreaterThan(20);              // the arena loop is playing

  const musicBtn = page.getByTestId("sound-music");
  await expect(musicBtn).toHaveAttribute("aria-pressed", "true");
  await musicBtn.click();
  await expect(musicBtn).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(400);
  const after = await notes();
  await page.waitForTimeout(900);
  expect(await notes()).toBe(after);                                             // quiet now

  await page.keyboard.press("2");                                                // a hit still makes a sound
  await expect.poll(notes, { timeout: 5_000 }).toBeGreaterThan(after);

  await page.goto("/quests");
  const soundBtn = page.getByRole("button", { name: "Sound", exact: true });
  await expect(soundBtn).toHaveAttribute("aria-pressed", "true");
  await soundBtn.click();
  await expect(soundBtn).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: "Sound", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("chiptune: off by default for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await battleServer(page);
  await page.goto("/quests");
  await expect(page.getByRole("button", { name: "Sound", exact: true })).toHaveAttribute("aria-pressed", "false");
});
