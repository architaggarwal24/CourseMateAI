import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";

// A whole battle in a real browser, against a small stand-in for the battle API (same contract as backend/routers/arena.py;
// the backend's own tests cover the rules). Win, lose and retreat, keyboard answering, the sprites actually painted,
// and axe on every state of the screen.

const BANK = [
  { question: "Which organelle makes ATP?", options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], correct: "Mitochondria" },
  { question: "Where is DNA stored?", options: ["Vacuole", "Nucleus", "Lysosome", "Membrane"], correct: "Nucleus" },
  { question: "Which sugar is in DNA?", options: ["Ribose", "Glucose", "Deoxyribose", "Fructose"], correct: "Deoxyribose" },
];
const PROFILE = { name: "Cell Warden", species: "minotaur", origin: "Greek", tagline: "Guardian of cells", intro_taunt: "You will not pass.", weakness: "Nucleus" };

async function battleServer(page: Page) {
  await mockApi(page);
  let battle: any = null, seq = -1, answered = false;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const end = (status: "won" | "lost") => {
    battle.status = status;
    battle.result = { grade: status === "won" ? "A" : "F", accuracy: Math.round((battle.correct / Math.max(1, battle.answered)) * 100), time_seconds: 42, new_personal_best: status === "won" };
    battle.rewards = { arena_round_complete: null, boss_defeat: status === "won" ? { ok: true, xp_gained: 50, coins_gained: 25 } : null };
  };
  // Registered after mockApi, so it answers first.
  await page.route("**/api/v1/arena/battles**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (path === "/arena/battles/active") return json(route, { ok: true, battle: battle?.status === "active" ? { ...battle, boss_profile: PROFILE } : null });
    if (path === "/arena/battles") {
      battle = { battle_id: "b1", status: "active", session_id: "s", topic: "cells", difficulty: "medium", phase: 1, rage: false,
        boss: { name: "Cell Warden", hp: 20, max_hp: 20, species: "minotaur", title: "Warden of cells" }, player: { hp: 10, max_hp: 10 }, combo: 0, max_combo: 0, answered: 0, correct: 0, heals_used: 0, fifty_used: 0,
        mode: "quick", run_id: null, focus: 0, focus_cap: 5, shield: 0, heavy_cost: 2, free_timewarp: false, relics: [],
        intent: { kind: "attack", name: "Concept Crush", value: 5, description: "Hits for 5 on a wrong answer." } };
      seq = -1; answered = false;
      return json(route, { ok: true, battle_id: "b1", resumed: false, boss: PROFILE, battle });
    }
    if (path.endsWith("/question")) {
      if (seq < 0 || answered) { seq += 1; answered = false; }
      const q = BANK[seq];
      return json(route, { ok: true, battle, previous: null, stock: { heal: 1, fifty_fifty: 1 },
        question: { id: seq, number: seq + 1, question: q.question, options: q.options, phase: 1, weakness: false, fifty_used: false, time_limit: 30, seconds_left: 30 } });
    }
    if (path.endsWith("/answer")) {
      const body = req.postDataJSON();
      const q = BANK[body.question_id];
      const correct = body.answer === q.correct;
      answered = true; battle.answered += 1;
      if (correct) { battle.correct += 1; battle.combo += 1; battle.max_combo = Math.max(battle.max_combo, battle.combo); battle.boss.hp = Math.max(0, battle.boss.hp - 10); }
      else { battle.combo = 0; battle.player.hp = Math.max(0, battle.player.hp - 5); }
      if (battle.boss.hp === 0) end("won"); else if (battle.player.hp === 0) end("lost");
      return json(route, { ok: true, replayed: false, battle, rewards: battle.rewards ?? null, question_id: body.question_id, correct, timed_out: false, answer: body.answer,
        correct_answer: q.correct, explanation: `It is ${q.correct}.`, damage_dealt: correct ? 10 : 0, hit_type: "normal", weakness: false,
        damage_taken: correct ? 0 : 5, attack_name: correct ? undefined : "Concept Crush", taunt: correct ? "Hm." : "Ha!", phase_changed: false, combo: battle.combo,
        move: "strike", intent: battle.intent, next_intent: battle.status === "active" ? battle.intent : null });
    }
    if (path.endsWith("/forfeit")) { end("lost"); return json(route, { ok: true, battle, rewards: battle.rewards }); }
    return json(route, { error: { code: "not_found", message: "Not found.", action: null, details: null } }, 404);
  });
}

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`).join("\n"), `axe on ${label}`).toBe("");
}

/** Arena v2: every turn starts with a move (Q = Strike). */
async function strike(page: Page) {
  await expect(page.getByRole("heading", { name: "Your move" })).toBeVisible();
  await page.keyboard.press("q");
}

async function summon(page: Page) {
  await page.goto("/hero?tab=arena");
  await page.getByRole("button", { name: /Quick Battle/ }).click();
  await page.getByLabel("Boss topic").fill("cells");
  await page.getByRole("button", { name: /Summon boss/ }).click();
  await expect(page.getByRole("heading", { name: "Cell Warden" })).toBeVisible();
  await axeClean(page, "battle: move choice");
  await strike(page);
  await expect(page.getByText("Which organelle makes ATP?")).toBeVisible();
}

test("WIN with the keyboard: the boss is drawn, the HUD is complete, and every state passes axe", async ({ page }) => {
  test.setTimeout(150_000);                                                 // four full axe scans: slow on a busy machine
  await battleServer(page);
  await summon(page);

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
