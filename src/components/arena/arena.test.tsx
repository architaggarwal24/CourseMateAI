import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
const game = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));
vi.mock("@/components/pdf/FileUploader", () => ({ default: ({ sessionId }: { sessionId: string }) => <div>uploader {sessionId}</div> }));
vi.mock("@/hooks/useHero", () => ({
  useHeroStore: Object.assign((sel: (s: unknown) => unknown) => sel({ shop: null }), { getState: () => ({ reconcile: game.reconcile }) }),
  previewEquipped: () => ({}),
}));

import ArenaArea from "./ArenaArea";
import { AUTO_ADVANCE_MS } from "@/hooks/useArenaBattle";
import { useChampion } from "@/hooks/useChampion";
import { VS_HOLD_MS } from "./VersusScreen";

// The verdict normally moves on by itself; most tests click Continue themselves, so it waits (one test checks the timer).
const advance = AUTO_ADVANCE_MS as { correct: number; wrong: number };

// ── A small in-memory battle server: the same contract as backend/routers/arena.py ──────────────────────────────
type Q = { question: string; options: string[]; correct: string; explanation: string };
const BANK: Q[] = [
  { question: "Which organelle makes ATP?", options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], correct: "Mitochondria", explanation: "Mitochondria run oxidative phosphorylation." },
  { question: "Where is DNA stored?", options: ["Vacuole", "Nucleus", "Lysosome", "Membrane"], correct: "Nucleus", explanation: "In the nucleus." },
  { question: "Which sugar is in DNA?", options: ["Ribose", "Glucose", "Deoxyribose", "Fructose"], correct: "Deoxyribose", explanation: "Deoxyribose." },
  { question: "Where does glycolysis happen?", options: ["Cytoplasm", "Nucleus", "Matrix", "Membrane"], correct: "Cytoplasm", explanation: "In the cytoplasm." },
];

function server(opts: {
  stock?: { heal: number; fifty_fifty: number }; active?: boolean; secondsLeft?: number; failQuestionOnce?: boolean; focus?: number;
  /** Stage 2: the champion's kit and the creature's mechanic on the battle, extra outcome fields, the champion's XP. */
  kit?: any; mechanic?: any; outcome?: (correct: boolean) => any; champion?: any;
  /** The create call takes this long (the server writes the fight's questions first). */
  createDelayMs?: number;
  /** Stage 3: the battle's effect fields, and what the effects do to every question's screen. */
  battleExtra?: any; questionEffects?: { blind: number; fog: number; shuffle: number };
  /** Stage 4: a miss knocks you down (CONTINUE?), and the end's score card. */
  knockOnMiss?: boolean; scoreCard?: any;
  /** Stage 5: writing the questions (.../prepare) takes this long; it fails once first. */
  prepareDelayMs?: number; failPrepareOnce?: boolean;
  /** Stage 6: the battle is a Survival's (a chest when won). */
  survival?: boolean;
} = {}) {
  const log = { calls: [] as string[], answers: [] as any[], items: [] as string[], forfeits: 0, created: [] as any[], gauntletStage: 0 };
  let prepFailed = false;
  let chosen = "kaien";
  const stock = { heal: 1, fifty_fifty: 1, ...opts.stock };
  let battle: any = null;
  let seq = -1;            // index of the question on screen
  let answered = false;
  let removed: string[] = [];
  let failed = false;
  let previous: any = null;

  const fresh = (): any => ({
    battle_id: "b1", status: "active", session_id: "sess-1", topic: "cells", difficulty: "medium", phase: 1, rage: false,
    boss: { name: "Cell Warden", hp: 30, max_hp: 30 }, player: { hp: 10, max_hp: 10 }, combo: 0, max_combo: 0,
    answered: 0, correct: 0, heals_used: 0, fifty_used: 0, prepared: true,
    mode: "quick", run_id: null, focus: 0, focus_cap: 5, shield: 0, heavy_cost: 2, free_timewarp: false, relics: [],
    intent: { kind: "attack", name: "Concept Crush", value: 4, description: "Hits for 4 on a wrong answer." },
    ...(opts.kit ? { kit: structuredClone(opts.kit) } : {}), ...(opts.mechanic ? { mechanic: structuredClone(opts.mechanic) } : {}),
    ...(opts.battleExtra ? structuredClone(opts.battleExtra) : {}),
  });
  const profile = { name: "Cell Warden", tagline: "Guardian of cells", intro_taunt: "You will not pass.", weakness: "Nucleus" };
  const publicQuestion = () => ({
    id: seq, number: seq + 1, question: BANK[seq].question, options: BANK[seq].options.filter((o) => !removed.includes(o)),
    phase: 1, weakness: false, fifty_used: removed.length > 0, time_limit: 30, seconds_left: opts.secondsLeft ?? 30,
    ...(opts.questionEffects ? { effects: opts.questionEffects } : {}),
  });
  const end = (status: "won" | "lost") => {
    battle.status = status;
    battle.result = { grade: status === "won" ? "A" : "F", accuracy: Math.round((battle.correct / Math.max(1, battle.answered)) * 100), time_seconds: 75, new_personal_best: status === "won",
      ...(opts.scoreCard ? { score: opts.scoreCard } : {}) };
    battle.rewards = status === "won"
      ? { arena_round_complete: { ok: true, xp_gained: 20, coins_gained: 5 }, boss_defeat: { ok: true, xp_gained: 50, coins_gained: 25 } }
      : { arena_round_complete: null, boss_defeat: null };
    if (opts.champion) battle.result.champion = opts.champion;
    if (battle.gauntlet_id) {
      log.gauntletStage += status === "won" ? 1 : 0;
      const st = log.gauntletStage;
      battle.result.gauntlet = status === "won"
        ? { gauntlet_id: "g1", kind: "survival", stage: st, over: false, status: "active", next: { power: 40 }, next_chest_at: 5,
          chest: st === 1 ? { size: "chest", at: 5, coins: 120, xp: 60, items: [{ id: "fifty_fifty", name: "50/50", kind: "potion" }] } : null }
        : { gauntlet_id: "g1", kind: "survival", stage: st, over: true, status: "lost", chest: null, result: { status: "lost", stage: st, score: 1200, power: 42, chests: 1, accuracy: 70 } };
    }
  };
  if (opts.active) { battle = fresh(); battle.focus = opts.focus ?? 0; }

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    const path = url.pathname.replace("/api/v1", "");
    const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
    log.calls.push(`${method} ${path}${url.search}`);
    if (path === "/arena/battles/active") return json(200, { ok: true, battle: battle?.status === "active" ? { ...battle, boss_profile: profile } : null });
    if (path === "/arena/battles" && method === "POST") {
      if (battle?.status === "active") return json(409, { error: { code: "battle_in_progress", message: "Finish it first.", action: null, details: { battle_id: "b1" } } });
      if (opts.createDelayMs) await new Promise((r) => setTimeout(r, opts.createDelayMs));
      battle = fresh(); seq = -1; removed = [];
      const body = await bodyOf(input, init);
      log.created.push(body);
      battle.topic = body.topic; battle.difficulty = body.difficulty; battle.prepared = !body.defer;
      return json(200, { ok: true, battle_id: "b1", resumed: false, boss: profile, battle });
    }
    if (path === "/arena/battles/b1/prepare") {
      if (opts.prepareDelayMs) await new Promise((r) => setTimeout(r, opts.prepareDelayMs));
      if (opts.failPrepareOnce && !prepFailed) { prepFailed = true; return json(503, { error: { code: "battle_generation_failed", message: "The boss is gathering its thoughts.", action: "retry", details: { retryable: true } } }); }
      battle.prepared = true;
      return json(200, { ok: true, battle_id: "b1", boss: profile, battle });
    }
    if (path === "/arena/battles/b1/rearm") {
      battle.kit = { champion: chosen, meter: 0, max: 100, ready: false, active: false, effects: {},
        passive: { name: "Reach", text: "Longer blows." }, ultimate: { name: "Dawnbreaker Lance", text: "A big hit." } };
      return json(200, { ok: true, battle_id: "b1", boss: profile, battle });
    }
    if (path === "/arena/power") {
      return json(200, { ok: true, power: { power: 42, from_score: 20, from_hunts: 12, best_scores: [800], hunted: ["minotaur"] },
        rush: { unlocked: false, hunted: 1, need: 3, bosses: [{ species: "minotaur", name: "Minotaur" }], wins: 0, best: null },
        survival: { best: { stage: 7, score: 9000 } }, active: null });
    }
    const gauntletState = () => ({ gauntlet_id: "g1", kind: "survival", status: battle?.status === "lost" ? "lost" : "active", topic: "cells", session_id: "sess-1", power: 42,
      stage: log.gauntletStage, hearts: battle?.player.hp ?? 10, max_hearts: 10, battle_id: "b1", score: 1200, chests: [], answered: 0, correct: 0, next_power: 34, next_chest_at: 5 });
    if (path === "/arena/gauntlets" && method === "POST") {
      const body = await bodyOf(input, init);
      log.created.push(body);
      battle = fresh(); seq = -1; removed = []; battle.gauntlet_id = "g1"; battle.mode = "survival"; battle.prepared = false;
      return json(200, { ok: true, gauntlet: gauntletState(), battle_id: "b1", boss: profile, battle });
    }
    if (path === "/arena/gauntlets/g1") return json(200, { ok: true, gauntlet: gauntletState() });
    if (path === "/arena/gauntlets/g1/next") {
      battle = fresh(); seq = -1; removed = []; battle.gauntlet_id = "g1"; battle.mode = "survival"; battle.prepared = false; battle.player.hp = 6;
      return json(200, { ok: true, gauntlet: gauntletState(), battle_id: "b1", boss: profile, battle });
    }
    if (path === "/avatar/champion" && method === "PUT") {
      chosen = (await bodyOf(input, init)).champion_id;
      return json(200, { champion_id: chosen, chosen: true, progress: {} });
    }
    if (path === "/arena/weak-concepts") return json(200, { concepts: [], missed_total: 0, nemesis_ready: false });
    if (path === "/arena/runs/active") return json(200, { ok: true, run: null });
    if (path === "/arena/leaderboard") return json(200, { ok: true, entries: [{ rank: 1, username: "ada", grade: "S", accuracy: 100, time: 61, is_me: true }], total: 1 });
    if (path === "/arena/battles/b1/question") {
      if (opts.failQuestionOnce && !failed) { failed = true; return json(503, { error: { code: "battle_generation_failed", message: "The boss is gathering its thoughts.", action: "retry", details: { retryable: true } } }); }
      if (battle.status !== "active") return json(200, { ok: true, battle, question: null, previous, stock });
      if (seq < 0 || answered) { seq += 1; answered = false; removed = []; }
      battle.question_issued = true;
      const prev = previous; previous = null;
      return json(200, { ok: true, battle, question: publicQuestion(), previous: prev, stock });
    }
    if (path === "/arena/battles/b1/answer") {
      const body = await bodyOf(input, init);
      log.answers.push(body);
      const q = BANK[body.question_id];
      const correct = body.answer === q.correct;
      answered = true;
      battle.question_issued = false;
      battle.answered += 1;
      let dealt = 0, taken = 0;
      if (correct) { battle.correct += 1; battle.combo += 1; battle.max_combo = Math.max(battle.max_combo, battle.combo); dealt = 15; battle.boss.hp = Math.max(0, battle.boss.hp - dealt); }
      else { battle.combo = 0; taken = 4; battle.player.hp = Math.max(0, battle.player.hp - taken); }
      const knocked = !!opts.knockOnMiss && !correct;
      if (knocked) { battle.player.hp = 0; battle.down = { deadline: new Date(Date.now() + 10_000).toISOString(), continues: 0, max: 3, coins: 100, can_continue: true }; }
      if (battle.boss.hp === 0) end("won"); else if (battle.player.hp === 0 && !knocked) end("lost");
      return json(200, {
        ok: true, replayed: false, battle, rewards: battle.rewards ?? null, question_id: body.question_id, correct, timed_out: false,
        answer: body.answer, correct_answer: q.correct, explanation: q.explanation, damage_dealt: dealt, hit_type: "normal", weakness: false,
        damage_taken: taken, attack_name: taken ? "Concept Crush" : undefined, taunt: correct ? "Lucky." : "Too easy.", phase_changed: false, combo: battle.combo,
        move: "strike", intent: battle.intent, next_intent: battle.status === "active" ? battle.intent : null,
        ...(knocked ? { knocked_down: true } : {}),
        ...(opts.outcome?.(correct) ?? {}),
      });
    }
    if (path === "/arena/battles/b1/items") {
      const { item } = await bodyOf(input, init);
      log.items.push(item);
      if (item === "heal") { stock.heal -= 1; battle.player.hp = Math.min(10, battle.player.hp + 1); battle.heals_used += 1; }
      else { stock.fifty_fifty -= 1; removed = BANK[seq].options.filter((o) => o !== BANK[seq].correct).slice(0, 2); battle.fifty_used += 1; }
      return json(200, { ok: true, item, battle, question: item === "fifty_fifty" ? publicQuestion() : null, stock });
    }
    if (path === "/arena/battles/b1" && method === "GET") {
      if (previous) { previous = null; }                                      // reading the battle settles the miss
      return json(200, { ok: true, battle_id: "b1", boss: profile, battle });
    }
    if (path === "/arena/battles/b1/spells") {
      const { spell } = await bodyOf(input, init);
      log.items.push(`spell:${spell}`);
      battle.focus -= 1;
      if (spell === "insight") removed = BANK[seq].options.filter((o) => o !== BANK[seq].correct).slice(0, 2);
      return json(200, { ok: true, spell, cost: 1, battle, question: publicQuestion() });
    }
    if (path === "/arena/battles/b1/ultimate") {
      log.items.push("ultimate");
      if (!battle.kit?.ready) return json(409, { error: { code: "ultimate_not_ready", message: "Not charged yet.", action: null, details: null } });
      battle.kit = { ...battle.kit, meter: 0, ready: false, active: true };
      return json(200, { ok: true, ultimate: { name: battle.kit.ultimate.name, text: battle.kit.ultimate.text, hearts: 0, insight: false, timewarp: false }, battle, question: seq >= 0 && !answered ? publicQuestion() : null });
    }
    if (path === "/arena/battles/b1/continue") {
      const { with: by } = await bodyOf(input, init);
      log.items.push(`continue:${by}`);
      battle.down = null; battle.player.hp = 10;
      return json(200, { ok: true, continued: { by, continues: 1 }, battle, stock });
    }
    if (path === "/arena/battles/b1/forfeit") {
      log.forfeits += 1;
      end("lost");
      return json(200, { ok: true, battle, rewards: battle.rewards });
    }
    return json(404, { error: { code: "not_found", message: `unexpected ${method} ${path}`, action: null, details: null } });
  }));
  return { log, issueOnResume: () => { battle.question_issued = true; }, expire: () => { previous = { question_id: seq, correct: false, timed_out: true, answer: null, correct_answer: BANK[seq].correct, damage_dealt: 0, damage_taken: 4, combo: 0 }; battle.player.hp -= 4; answered = true; battle.question_issued = false; } };
}

const press = (key: string) => fireEvent.keyDown(window, { key });
/** From the hub into Quick Battle's summon screen. */
const openQuick = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Quick Battle/ }));
  await screen.findByRole("heading", { name: "Quick Battle" });
};
/** Arena v2: every turn starts with a move. Strike asks the normal question. */
const strike = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /^Strike/ }));
};
/** Stage 5: character select (Enter keeps the champion), then the VS screen (Enter once the questions are ready). */
const throughVs = async () => {
  await screen.findByRole("heading", { name: "Select your champion" });
  press("Enter");
  await screen.findByText("Ready. Press Enter to fight.");
  press("Enter");
  await screen.findByRole("heading", { name: "Cell Warden" });
};
const summonBoss = async (topic = "cells") => {
  await openQuick();
  fireEvent.change(await screen.findByLabelText("Boss topic"), { target: { value: topic } });
  fireEvent.click(screen.getByRole("button", { name: /Summon boss/ }));
  await throughVs();
  await strike();
};
/** Past the verdict (Continue) and into the next turn with a Strike. */
const carryOn = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await strike();
};

beforeEach(() => {
  advance.correct = 1e9; advance.wrong = 1e9;
  sessionStorage.clear();
  Object.values(toasts).forEach((f) => f.mockClear());
  game.reconcile.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);     // jsdom draws nothing
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Arena: summoning", () => {
  it("opens on the summon screen when no battle is running, and the summon sends the document, topic and difficulty", async () => {
    const { log } = server();
    render(<ArenaArea />);
    await openQuick();
    fireEvent.click(screen.getByRole("button", { name: /Hard/ }));
    fireEvent.change(await screen.findByLabelText("Boss topic"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: /Summon boss/ }));
    await throughVs();
    expect(screen.getByRole("status", { name: /Boss intent: Concept Crush/ })).toBeTruthy();      // the telegraph comes first
    await strike();
    const created = log.calls.indexOf("POST /arena/battles");
    expect(created).toBeGreaterThan(-1);
    expect(screen.getByRole("progressbar", { name: "Boss HP" }).getAttribute("aria-valuenow")).toBe("30");
    expect(await screen.findByText("Which organelle makes ATP?")).toBeTruthy();
    expect(screen.getByText(/Question 1/)).toBeTruthy();
    expect(log.calls).toContain("GET /arena/battles/b1/question?move=strike");
  });

  it("does not let an empty topic be summoned", async () => {
    server();
    render(<ArenaArea />);
    await openQuick();
    const button = await screen.findByRole("button", { name: /Summon boss/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Arena: a full battle", () => {
  it("WIN: correct answers wear the boss down; the verdict shows the explanation, then the result shows grade, rewards and board", async () => {
    const { log } = server();
    render(<ArenaArea />);
    await summonBoss();

    await screen.findByText("Which organelle makes ATP?");
    press("2");                                                              // Mitochondria
    await screen.findByText("Correct!");
    expect(log.answers[0]).toEqual({ question_id: 0, answer: "Mitochondria" });
    expect(screen.getByText("You hit Cell Warden for 15.")).toBeTruthy();
    expect(screen.getByText("Mitochondria run oxidative phosphorylation.")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Boss HP" }).getAttribute("aria-valuenow")).toBe("15");
    expect(document.querySelector(".arena-combo .pixel-font")?.textContent).toBe("x1");     // combo
    expect(screen.getByText(/Lucky\./)).toBeTruthy();                        // the boss's taunt

    const next = screen.getByRole("button", { name: /Continue/ });
    await waitFor(() => expect(document.activeElement).toBe(next));
    fireEvent.click(next);
    await strike();
    await screen.findByText("Where is DNA stored?");

    press("2");                                                              // Nucleus: the last blow
    await screen.findByText("Cell Warden is defeated!");
    fireEvent.click(screen.getByRole("button", { name: "See result" }));

    await screen.findByRole("heading", { name: "Victory!" });
    expect(screen.getByLabelText("Grade A")).toBeTruthy();
    expect(screen.getByText("New best")).toBeTruthy();
    expect(screen.getByText("+70 XP")).toBeTruthy();                         // both awards, added up
    expect(screen.getByText("+30 coins")).toBeTruthy();
    expect(screen.getByText("1m 15s")).toBeTruthy();
    await screen.findByText("ada");                                          // the leaderboard
    expect(game.reconcile).toHaveBeenCalled();                               // coins / XP re-read after the rewards
  });

  it("LOSE: wrong answers cost hearts, the verdict names the right answer, and three misses end the fight", async () => {
    server();
    render(<ArenaArea />);
    await summonBoss();

    await screen.findByText("Which organelle makes ATP?");
    press("1");                                                              // Nucleus: wrong
    await screen.findByText("Not quite");
    expect(screen.getByText("Correct answer: Mitochondria")).toBeTruthy();
    expect(screen.getByText("Concept Crush hits you for 4.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "6 of 10 hearts" })).toBeTruthy();
    await carryOn();
    await screen.findByText("Where is DNA stored?");
    press("1");
    await screen.findByText("Not quite");
    await carryOn();
    await screen.findByText("Which sugar is in DNA?");
    press("1");
    await screen.findByText("You have fallen.");
    fireEvent.click(screen.getByRole("button", { name: "See result" }));

    await screen.findByRole("heading", { name: "Defeated" });
    expect(screen.queryByText(/XP$/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Battle again" }));
    await screen.findByRole("heading", { name: "Quick Battle" });            // back to the summon screen
  });

  it("RETREAT: asks first, then ends the battle as a loss", async () => {
    const { log } = server();
    render(<ArenaArea />);
    await summonBoss();
    fireEvent.click(screen.getByRole("button", { name: /Retreat/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep fighting" }));
    expect(log.forfeits).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Retreat/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Retreat" }));
    await screen.findByRole("heading", { name: "Retreated" });
    expect(log.forfeits).toBe(1);
  });
});

describe("Arena: keyboard and items", () => {
  it("answers only with keys that have an option, ignores typing in a field, and does not answer twice", async () => {
    const { log } = server();
    render(<ArenaArea />);
    await summonBoss();
    await screen.findByText("Which organelle makes ATP?");
    press("5"); press("0"); press("a");
    const stray = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(stray, { key: "1", bubbles: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(log.answers).toEqual([]);
    press("3"); press("3");
    await screen.findByText("Not quite");
    expect(log.answers).toHaveLength(1);
    press("2");                                                              // the verdict is on screen: keys are off
    await new Promise((r) => setTimeout(r, 10));
    expect(log.answers).toHaveLength(1);
    stray.remove();
  });

  it("the heal and 50/50 items show their stock, act through the server, and run out", async () => {
    const { log } = server();
    render(<ArenaArea />);
    await summonBoss();
    await screen.findByText("Which organelle makes ATP?");
    const heal = screen.getByRole("button", { name: /Heal/ }) as HTMLButtonElement;
    expect(heal.disabled).toBe(true);                                        // hearts are full

    fireEvent.click(screen.getByRole("button", { name: /50\/50/ }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));   // two wrong options are gone
    expect(log.items).toEqual(["fifty_fifty"]);
    expect((screen.getByRole("button", { name: /50\/50/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Press 1–2 to answer")).toBeTruthy();

    press("1");                                                              // what is left is [Mitochondria, Golgi]
    await screen.findByText("Correct!");
    await carryOn();
    await screen.findByText("Where is DNA stored?");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);                 // the next question has all its options again
  });

  it("a potion heals one heart when hearts are missing", async () => {
    const { log } = server();
    render(<ArenaArea />);
    await summonBoss();
    await screen.findByText("Which organelle makes ATP?");
    press("1");                                                              // wrong: 6 of 10
    await screen.findByText("Not quite");
    await carryOn();
    await screen.findByText("Where is DNA stored?");
    fireEvent.click(screen.getByRole("button", { name: /Heal/ }));
    await screen.findByRole("img", { name: "7 of 10 hearts" });
    expect(log.items).toEqual(["heal"]);
    expect((screen.getByRole("button", { name: /Heal/ }) as HTMLButtonElement).disabled).toBe(true);   // none left
  });
});

describe("Arena: resuming and failing safely", () => {
  it("a refresh while a question is out goes straight back to that question (no move choice)", async () => {
    const s = server({ active: true });
    s.issueOnResume();
    render(<ArenaArea />);
    await screen.findByText("Which organelle makes ATP?");
    expect(screen.queryByRole("heading", { name: "Your move" })).toBeNull();
  });

  it("opens straight into the battle in progress (refresh / new tab) and remembers its document", async () => {
    const { log } = server({ active: true });
    render(<ArenaArea />);
    await screen.findByRole("heading", { name: "Cell Warden" });
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    expect(log.calls[0]).toBe("GET /arena/battles/active");
    expect(sessionStorage.getItem("cmai_arena_session")).toBe("sess-1");
    expect(screen.queryByRole("heading", { name: "Battle Arena" })).toBeNull();
  });

  it("a question that cannot be generated is a retry, not a loss", async () => {
    server({ failQuestionOnce: true });
    render(<ArenaArea />);
    await summonBoss();
    await screen.findByText("The boss is gathering its thoughts");
    expect(toasts.apiError).not.toHaveBeenCalled();                          // the screen shows it; no second message
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    expect(screen.getByRole("progressbar", { name: "Boss HP" }).getAttribute("aria-valuenow")).toBe("30");
  });

  it("a question whose clock ran out is settled by the server: after the grace period the next question comes with the miss", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = server({ active: true, secondsLeft: 2 });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    s.expire();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 3000 + 500); });
    // Arena v2: the miss is settled by reading the battle (nothing new is issued), then the next turn starts at the move choice
    await screen.findByRole("heading", { name: "Your move" });
    expect(screen.getByText(/Time ran out on the last question, and the boss struck for 4/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "6 of 10 hearts" })).toBeTruthy();
    expect(s.log.calls.filter((c) => c.startsWith("GET /arena/battles/b1/question"))).toHaveLength(1);
    await strike();
    await screen.findByText("Where is DNA stored?");
  });
});

describe("Arena v2: tactics", () => {
  it("Heavy needs Focus: it is offered but disabled at 0, and the Q key picks Strike", async () => {
    const { log } = server({ active: true, focus: 0 });
    render(<ArenaArea />);
    const heavy = await screen.findByRole("button", { name: /^Heavy/ });
    expect((heavy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("img", { name: "Focus 0 of 5" })).toBeTruthy();
    press("q");
    await screen.findByText("Which organelle makes ATP?");
    expect(log.calls).toContain("GET /arena/battles/b1/question?move=strike");
  });

  it("Insight spends Focus to remove two wrong options", async () => {
    const { log } = server({ active: true, focus: 2 });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    fireEvent.click(screen.getByRole("button", { name: /Insight/ }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(log.items).toEqual(["spell:insight"]);
    expect(screen.getByRole("img", { name: "Focus 1 of 5" })).toBeTruthy();
  });

  it("the verdict moves on by itself to the next move choice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    advance.correct = 1800;
    const { log } = server({ active: true });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("2");
    await waitFor(() => expect(log.answers).toHaveLength(1));
    await screen.findByText("Correct!");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await screen.findByRole("heading", { name: "Your move" });
    expect(screen.queryByText("Correct!")).toBeNull();
  });

  it("Enter moves the verdict on at once, and on the next turn Enter picks the same move again", async () => {
    const { log } = server({ active: true, focus: 2 });
    render(<ArenaArea />);
    fireEvent.click(await screen.findByRole("button", { name: /^Jab/ }));
    await screen.findByText("Which organelle makes ATP?");
    press("2");
    await screen.findByText("Correct!");
    press("Enter");
    await screen.findByRole("heading", { name: "Your move" });
    expect(screen.getByText(/Jab again/)).toBeTruthy();
    press("Enter");
    await waitFor(() => expect(log.calls.filter((c) => c.endsWith("move=jab"))).toHaveLength(2));
  });

  it("while the fight's questions are written, the summon says what is happening", async () => {
    server({ createDelayMs: 200 });
    render(<ArenaArea />);
    await openQuick();
    fireEvent.change(await screen.findByLabelText("Boss topic"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: /Summon boss/ }));
    expect(await screen.findByText("The beast circles you…")).toBeTruthy();
    await throughVs();
  });

  it("the hub offers the modes (Boss Rush and Survival where Multiplayer was) and your power level; Nemesis is locked until 3 concepts are missed", async () => {
    server();
    render(<ArenaArea />);
    await screen.findByRole("button", { name: /Quick Battle/ });
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.getByRole("button", { name: /Boss Rush/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Survival/ })).toBeTruthy();
    expect(await screen.findByText("1/3 hunted")).toBeTruthy();
    expect(screen.getByText("Best: 7 bosses")).toBeTruthy();
    expect(screen.getByText("Power level").parentElement!.textContent).toContain("42");
    expect(screen.getByRole("button", { name: /Expedition/ })).toBeTruthy();
    expect(await screen.findByText("0/3 missed")).toBeTruthy();
  });
});

// ── Phase 3 Stage 2: creature mechanics, champion kits and champion XP ─────────────────────────────────────────────
const KIT = {
  champion: "kaien", meter: 100, max: 100, ready: true, active: false, effects: {},
  passive: { name: "Riposte", text: "A right Guard hits back for half a Strike." },
  ultimate: { name: "Blade Storm", text: "Your next two right answers hit twice." },
};
const KRAKEN = {
  id: "kraken", name: "Tentacle Grab", summary: "A miss on a grab locks the move you used.",
  counters: [{ label: "Grip", value: 1, max: 2, hint: "Turns the lock lasts" }], locked_moves: ["jab"],
};

describe("Arena: creature mechanics and champion kits", () => {
  it("the mechanic is in the HUD with its counters, and a grabbed move is locked (its key does nothing)", async () => {
    const { log } = server({ active: true, mechanic: KRAKEN });
    render(<ArenaArea />);
    const jab = await screen.findByRole("button", { name: /^Jab/ });
    expect((jab as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Locked: Cell Warden has it pinned.")).toBeTruthy();
    const hud = screen.getAllByRole("group", { name: "Creature mechanic: Tentacle Grab" });
    expect(hud.length).toBeGreaterThan(0);
    expect(screen.getByText("A miss on a grab locks the move you used.")).toBeTruthy();
    expect(within(hud[0]).getByText("Grip")).toBeTruthy();
    expect(within(hud[0]).getByText("1/2")).toBeTruthy();
    press("w");
    expect(log.calls.some((c) => c.includes("move=jab"))).toBe(false);
    press("q");
    await screen.findByText("Which organelle makes ATP?");
  });

  it("a full meter: the U key casts the ultimate through the server, and the meter empties", async () => {
    const { log } = server({ active: true, kit: KIT });
    render(<ArenaArea />);
    await screen.findByRole("heading", { name: "Your move" });
    const meters = screen.getAllByRole("progressbar", { name: "Ultimate: Blade Storm" });
    expect(meters[0].getAttribute("aria-valuetext")).toBe("Blade Storm ready");
    press("u");
    await waitFor(() => expect(log.items).toEqual(["ultimate"]));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Blade Storm!"));
    await waitFor(() => expect(screen.getAllByRole("progressbar", { name: "Ultimate: Blade Storm" })[0].getAttribute("aria-valuenow")).toBe("0"));
    press("u");                                                     // active now: a second press sends nothing
    expect(log.items).toEqual(["ultimate"]);
  });

  it("the ultimate button is offered only when charged", async () => {
    const { log } = server({ active: true, kit: { ...KIT, meter: 40, ready: false } });
    render(<ArenaArea />);
    const btn = await screen.findByRole("button", { name: /Blade Storm/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.textContent).toContain("40%");
    press("u");
    expect(log.items).toEqual([]);
  });

  it("the verdict says what the mechanic and the kit did", async () => {
    server({
      active: true, kit: KIT, mechanic: KRAKEN,
      outcome: (correct) => correct ? {
        riposte: 3, dodged: true,
        mechanic: { id: "kraken", events: [{ type: "break_free", text: "You break the Kraken's grip." }], boss_healed: 0, damage: 0, hearts: 1, focus: 0, shield: 0, illusion_picked: false, hud: KRAKEN },
        kit: { events: [{ type: "storm", text: "Blade Storm hits twice!" }], refund: 0, hud: KIT },
      } : {},
    });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("2");
    await screen.findByText("Correct!");
    expect(screen.getByText("Riposte! You hit back for 3.")).toBeTruthy();
    expect(screen.getByText("You dodged the blow.")).toBeTruthy();
    expect(screen.getByText("You break the Kraken's grip.")).toBeTruthy();
    expect(screen.getByText("+1 heart.")).toBeTruthy();
    expect(screen.getByText("Blade Storm hits twice!")).toBeTruthy();
  });

  it("the result shows the champion's XP and a level-up's mastery skin", async () => {
    server({
      active: true,
      champion: { id: "kaien", xp_gained: 70, xp: 120, level: 2, leveled_up: true, next_level_xp: 250, unlocked: ["mastery_kaien_outfit"] },
    });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("2");
    await screen.findByText("Correct!");
    await carryOn(); await screen.findByText("Where is DNA stored?"); press("2");
    await screen.findByText("Correct!");
    fireEvent.click(screen.getByRole("button", { name: /See result/ }));
    const panel = await screen.findByRole("region", { name: "Kaien's progress" });
    expect(within(panel).getByText(/\+70 Kaien XP/)).toBeTruthy();
    expect(within(panel).getByText(/Kaien reached Lv 2!/)).toBeTruthy();
    expect(within(panel).getByRole("list", { name: "Mastery skins unlocked" })).toBeTruthy();
    await waitFor(() => expect(game.reconcile).toHaveBeenCalled());
  });
});

describe("Arena: boss effects and the enraged form (Stage 3)", () => {
  const burn = { id: "burn", name: "Burn", kind: "dot", turns: 2, text: "-1 heart after each of the next 2 questions" };
  it("the effects on you are in the HUD; silenced: no spells; cursed: no potions", async () => {
    server({ active: true, focus: 3, battleExtra: { effects: [burn, { id: "silence", name: "Silence", kind: "silence", turns: 1, text: "no spells" }], silenced: true, cursed: true } });
    render(<ArenaArea />);
    const list = await screen.findByRole("list", { name: "Effects on you" });
    expect(list.textContent).toContain("Burn, 2 more questions");
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    expect((screen.getByRole("button", { name: /Insight/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Heal/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /50\/50/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an effect lock disables that move and says why; the intent shows the effect its blow carries", async () => {
    server({ active: true, battleExtra: {
      locked_moves: ["heavy"], effects: [{ id: "stun", name: "Stun", kind: "lock", turns: 1, text: "a move is locked", moves: ["heavy"] }],
      intent: { kind: "attack", name: "Concept Crush", value: 4, description: "Hits for 4.", effect: { id: "freeze", name: "Freeze", kind: "clock", text: "half the time" } },
    } });
    render(<ArenaArea />);
    const heavy = await screen.findByRole("button", { name: /^Heavy/ });
    expect((heavy as HTMLButtonElement).disabled).toBe(true);
    expect(heavy.textContent).toContain("Locked: Stun");
    expect(screen.getByRole("status", { name: /Boss intent: Concept Crush/ }).textContent).toContain("Freeze");
  });

  it("Blind hides the options for its seconds (they can't be read, by eye or screen reader), then shows them", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server({ active: true, questionEffects: { blind: 2, fog: 0, shuffle: 0 } });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    expect(screen.getByText(/Blinded/)).toBeTruthy();
    expect(screen.queryByText("Mitochondria")).toBeNull();
    expect(screen.getByRole("button", { name: "Option 1, hidden" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(await screen.findByText("Mitochondria")).toBeTruthy();
  });

  it("Confuse reshuffles the options while you answer, and the keys follow the order shown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { log } = server({ active: true, questionEffects: { blind: 0, fog: 0, shuffle: 1 } });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    const first = screen.getAllByRole("listitem").map((li) => li.textContent);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_500); });           // half the clock: one reshuffle
    const after = screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d/, ""));
    expect(after).not.toEqual(first.map((t) => t?.replace(/^\d/, "")));
    press("1");
    await waitFor(() => expect(log.answers).toHaveLength(1));
    expect(log.answers[0].answer).toBe(after[0]);
  });

  it("the verdict says what landed, what ticked, what wore off, and the enraged roar", async () => {
    server({ active: true, outcome: () => ({
      phase_changed: true,
      effects: { landed: { id: "hydra_venom", name: "Hundred-Fang Venom", kind: "dot", text: "-1 heart after each of the next 4 questions" },
        ticked: [{ id: "burn", name: "Burn", damage: 1 }], expired: ["Freeze"], damage: 1, sapped: 0, drained: 0, active: [] },
    }) });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("1");
    const verdict = await screen.findByRole("status", { name: "Result of your answer" });
    expect(verdict.textContent).toContain("Hundred-Fang Venom! -1 heart after each of the next 4 questions.");
    expect(verdict.textContent).toContain("Burn: -1 heart.");
    expect(verdict.textContent).toContain("Freeze wore off.");
    expect(verdict.textContent).toContain("It is enraged");
  });
});

describe("Arena: combo, final move, score card, CONTINUE (Stage 4)", () => {
  it("the HUD shows the combo's level and the score", async () => {
    server({ active: true, battleExtra: { combo: 4, combo_level: 3, score: 1234 } });
    render(<ArenaArea />);
    expect(await screen.findByText("Combo 4 in a row, x3 damage and points")).toBeTruthy();
    expect(screen.getByText("Score 1234")).toBeTruthy();
  });

  it("the boss on its knees: a FINAL MOVE prompt (Enter asks the quick question)", async () => {
    const { log } = server({ active: true, battleExtra: { finale: true, intent: { kind: "finale", name: "On its knees", value: 0, special: true, description: "One quick question." } } });
    render(<ArenaArea />);
    expect(await screen.findByRole("heading", { name: "Final move!" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Strike/ })).toBeNull();
    press("Enter");
    await screen.findByText("Which organelle makes ATP?");
    expect(log.calls).toContain("GET /arena/battles/b1/question?move=strike");
  });

  it("knocked down: CONTINUE? with a countdown; paying coins puts you back on your feet", async () => {
    const { log } = server({ active: true, knockOnMiss: true });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("1");
    expect(await screen.findByText(/You're down! Continue\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Continue?" })).toBeTruthy();
    expect(screen.getByRole("timer", { name: /seconds to continue/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pay 100 coins/ }));
    await screen.findByRole("heading", { name: "Your move" });
    expect(log.items).toEqual(["continue:coins"]);
  });

  it("the result has a score card with its rank", async () => {
    server({ active: true, scoreCard: { points: 900, speed: 200, finisher: 1000, hearts: 300, best_combo: 4, best_level: 3, specials: 0, continues: 0, total: 2200, rank: "S" } });
    render(<ArenaArea />);
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("2");
    fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
    await strike();
    await screen.findByText("Where is DNA stored?");
    press("2");
    fireEvent.click(await screen.findByRole("button", { name: /See result/ }));
    const card = await screen.findByRole("region", { name: "Score card" });
    expect(within(card).getByRole("img", { name: "Rank S" })).toBeTruthy();
    expect(card.textContent).toContain("Final move+1000");
    expect(card.textContent).toContain("Score2200");
    expect(screen.queryByRole("img", { name: /^Grade / })).toBeNull();   // one rank, not two
  });
});

describe("Arena: character select and the VS screen (Stage 5)", () => {
  beforeEach(() => { useChampion.setState({ championId: "kaien", chosen: true, signedIn: true, loaded: true, progress: {} }); });
  const summonOnly = async () => {
    await openQuick();
    fireEvent.change(await screen.findByLabelText("Boss topic"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: /Summon boss/ }));
    await screen.findByRole("heading", { name: "Select your champion" });
  };

  it("the battle is made at once; you pick a champion while its questions are written, and the fight is armed for them", async () => {
    const { log } = server({ prepareDelayMs: 150 });
    render(<ArenaArea />);
    await summonOnly();
    expect(log.created[0]).toMatchObject({ defer: true, topic: "cells" });
    expect(log.calls).toContain("POST /arena/battles/b1/prepare");
    const group = screen.getByRole("radiogroup", { name: "Select your champion" });
    expect(within(group).getByRole("radio", { name: "Kaien" }).getAttribute("aria-checked")).toBe("true");
    // the arrows move the pick; the big card follows
    fireEvent.keyDown(within(group).getByRole("radio", { name: "Kaien" }), { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: "Asha" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Dawnbreaker")).toBeTruthy();                       // Asha's FINAL MOVE
    fireEvent.click(screen.getByRole("button", { name: /Fight as Asha/ }));
    await screen.findByRole("heading", { name: "Asha versus Cell Warden" });
    await waitFor(() => expect(log.calls).toContain("POST /arena/battles/b1/rearm"));
    expect(log.calls.indexOf("PUT /avatar/champion")).toBeLessThan(log.calls.indexOf("POST /arena/battles/b1/rearm"));
    await screen.findByText("Ready. Press Enter to fight.");
    press("Enter");
    await screen.findByRole("heading", { name: "Cell Warden" });
    await strike();
    expect(await screen.findByText("Which organelle makes ATP?")).toBeTruthy();
  });

  it("keeping your champion re-arms nothing; the VS screen waits for the questions, and a failure is a retry", async () => {
    const { log } = server({ failPrepareOnce: true });
    render(<ArenaArea />);
    await summonOnly();
    press("Enter");
    await screen.findByRole("heading", { name: "Kaien versus Cell Warden" });
    expect(await screen.findByText("The questions didn't come. Nothing is lost.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fight!" })).toBeNull();      // no fight without its questions
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Ready. Press Enter to fight.");
    expect(log.calls.filter((c) => c === "POST /arena/battles/b1/prepare")).toHaveLength(2);
    expect(log.calls).not.toContain("POST /arena/battles/b1/rearm");
    fireEvent.click(screen.getByRole("button", { name: "Fight!" }));
    await screen.findByRole("heading", { name: "Cell Warden" });
  });

  it("the VS screen opens the fight by itself once it has held, when the questions are ready", async () => {
    server();
    render(<ArenaArea />);
    await summonOnly();
    press("Enter");
    await screen.findByText("Ready. Press Enter to fight.");
    await screen.findByRole("heading", { name: "Cell Warden" }, { timeout: VS_HOLD_MS + 1500 });
  });

  it("reopened while the questions were still being written: back to the pick", async () => {
    server({ active: true, battleExtra: { prepared: false } });
    render(<ArenaArea />);
    await screen.findByRole("heading", { name: "Select your champion" });
  });
});

describe("Arena: Boss Rush and Survival (Stage 6)", () => {
  beforeEach(() => { useChampion.setState({ championId: "kaien", chosen: true, signedIn: true, loaded: true, progress: {} }); });

  it("Boss Rush shows what opens it while it is locked", async () => {
    server();
    render(<ArenaArea />);
    fireEvent.click(await screen.findByRole("button", { name: /Boss Rush/ }));
    await screen.findByRole("heading", { name: "Boss Rush" });
    expect(await screen.findByText(/Hunt 3 different creatures to open Boss Rush \(1\/3\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Topic for every fight"), { target: { value: "cells" } });
    expect((screen.getByRole("button", { name: /Start the Boss Rush/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Survival: pick your champion for the first boss, win, open the chest, and the next boss goes straight to VS with your hearts", async () => {
    const { log } = server();
    render(<ArenaArea />);
    fireEvent.click(await screen.findByRole("button", { name: /Survival/ }));
    await screen.findByRole("heading", { name: "Survival" });
    expect(await screen.findByText(/The first boss at power 29/)).toBeTruthy();       // 70% of 42
    fireEvent.change(screen.getByLabelText("Topic for every fight"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: /Start Survival/ }));
    await throughVs();
    expect(log.created[0]).toEqual({ kind: "survival", session_id: expect.any(String), topic: "cells" });
    expect(await screen.findByRole("region", { name: "Survival status" })).toBeTruthy();
    await strike();
    await screen.findByText("Which organelle makes ATP?");
    press("2");
    await screen.findByText("Correct!");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await strike();
    await screen.findByText("Where is DNA stored?");
    press("2");
    fireEvent.click(await screen.findByRole("button", { name: /See result/ }));
    expect(await screen.findByText(/Boss 1 down\. The next one comes at power 40/)).toBeTruthy();
    const chest = screen.getByRole("region", { name: "Chest! Boss 5" });
    expect(chest.textContent).toContain("120 coins");
    expect(chest.textContent).toContain("50/50");
    fireEvent.click(screen.getByRole("button", { name: "Next boss" }));
    // no champion select this time: VS, then the fight with the hearts the last one left
    await screen.findByText("Ready. Press Enter to fight.");
    expect(screen.queryByRole("heading", { name: "Select your champion" })).toBeNull();
    expect(log.calls).toContain("POST /arena/gauntlets/g1/next");
    press("Enter");
    await screen.findByRole("heading", { name: "Cell Warden" });
  });
});
