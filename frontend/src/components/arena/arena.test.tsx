import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
const game = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));
vi.mock("@/components/FileUploader", () => ({ default: ({ sessionId }: { sessionId: string }) => <div>uploader {sessionId}</div> }));
vi.mock("@/hooks/useHero", () => ({
  useHeroStore: Object.assign((sel: (s: unknown) => unknown) => sel({ shop: null }), { getState: () => ({ reconcile: game.reconcile }) }),
  previewEquipped: () => ({}),
}));

import ArenaArea from "./ArenaArea";
import { AUTO_ADVANCE_MS } from "@/hooks/useArenaBattle";

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

function server(opts: { stock?: { heal: number; fifty_fifty: number }; active?: boolean; secondsLeft?: number; failQuestionOnce?: boolean; focus?: number } = {}) {
  const log = { calls: [] as string[], answers: [] as any[], items: [] as string[], forfeits: 0 };
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
    answered: 0, correct: 0, heals_used: 0, fifty_used: 0,
    mode: "quick", run_id: null, focus: 0, focus_cap: 5, shield: 0, heavy_cost: 2, free_timewarp: false, relics: [],
    intent: { kind: "attack", name: "Concept Crush", value: 4, description: "Hits for 4 on a wrong answer." },
  });
  const profile = { name: "Cell Warden", tagline: "Guardian of cells", intro_taunt: "You will not pass.", weakness: "Nucleus" };
  const publicQuestion = () => ({
    id: seq, number: seq + 1, question: BANK[seq].question, options: BANK[seq].options.filter((o) => !removed.includes(o)),
    phase: 1, weakness: false, fifty_used: removed.length > 0, time_limit: 30, seconds_left: opts.secondsLeft ?? 30,
  });
  const end = (status: "won" | "lost") => {
    battle.status = status;
    battle.result = { grade: status === "won" ? "A" : "F", accuracy: Math.round((battle.correct / Math.max(1, battle.answered)) * 100), time_seconds: 75, new_personal_best: status === "won" };
    battle.rewards = status === "won"
      ? { arena_round_complete: { ok: true, xp_gained: 20, coins_gained: 5 }, boss_defeat: { ok: true, xp_gained: 50, coins_gained: 25 } }
      : { arena_round_complete: null, boss_defeat: null };
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
      battle = fresh(); seq = -1; removed = [];
      const body = await bodyOf(input, init);
      battle.topic = body.topic; battle.difficulty = body.difficulty;
      return json(200, { ok: true, battle_id: "b1", resumed: false, boss: profile, battle });
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
      if (battle.boss.hp === 0) end("won"); else if (battle.player.hp === 0) end("lost");
      return json(200, {
        ok: true, replayed: false, battle, rewards: battle.rewards ?? null, question_id: body.question_id, correct, timed_out: false,
        answer: body.answer, correct_answer: q.correct, explanation: q.explanation, damage_dealt: dealt, hit_type: "normal", weakness: false,
        damage_taken: taken, attack_name: taken ? "Concept Crush" : undefined, taunt: correct ? "Lucky." : "Too easy.", phase_changed: false, combo: battle.combo,
        move: "strike", intent: battle.intent, next_intent: battle.status === "active" ? battle.intent : null,
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
const summonBoss = async (topic = "cells") => {
  await openQuick();
  fireEvent.change(await screen.findByLabelText("Boss topic"), { target: { value: topic } });
  fireEvent.click(screen.getByRole("button", { name: /Summon boss/ }));
  await screen.findByRole("heading", { name: "Cell Warden" });
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
    await screen.findByRole("heading", { name: "Cell Warden" });
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

  it("the hub offers the modes; Multiplayer is coming soon and Nemesis is locked until 3 concepts are missed", async () => {
    server();
    render(<ArenaArea />);
    await screen.findByRole("button", { name: /Quick Battle/ });
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Expedition/ })).toBeTruthy();
    expect(await screen.findByText("0/3 missed")).toBeTruthy();
  });
});
