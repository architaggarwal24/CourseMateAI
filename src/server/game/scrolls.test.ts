/** @vitest-environment node */
// The quest board (Stage Q1): weekly trials picked for the week, Bestiary hunts that find lost pages, the champion's
// story, every seal broken once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as questsRoute from "@/app/api/v1/quests/route";
import * as claimRoute from "@/app/api/v1/quests/claim/route";
import * as bestiary from "@/app/api/v1/bestiary/route";
import * as battles from "@/app/api/v1/arena/battles/route";
import * as question from "@/app/api/v1/arena/battles/[id]/question/route";
import * as answerRoute from "@/app/api/v1/arena/battles/[id]/answer/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests, settleBackground, trackBackgroundForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";
import { HUNT_REWARD, STORIES, TRIALS, fightEvents, huntsWanted, scrollEvent, trialsFor, weekOf } from "./scrolls";

const rec = (wins: number, extra: Record<string, unknown> = {}) => ({ wins, flawlessWins: 0, nightmareWins: 0, baneFound: false, lostPage: false, ...extra });
const recs = (m: Record<string, number>) => new Map(Object.entries(m).map(([s, w]) => [s, rec(w)])) as never;

describe("the rules", () => {
  it("a week runs Monday to Sunday (ISO weeks)", () => {
    expect(weekOf("2026-11-08")).toBe("2026-W45");             // a Sunday
    expect(weekOf("2026-11-09")).toBe("2026-W46");             // the Monday after
    expect(weekOf("2027-01-01")).toBe("2026-W53");             // a Friday that still belongs to 2026's last week
    expect(weekOf("2026-01-01")).toBe("2026-W01");
  });

  it("three different trials per week, the same all week, different from week to week", () => {
    const a = trialsFor(7, "2026-W45");
    expect(a).toHaveLength(3);
    expect(new Set(a.map((t) => t.id)).size).toBe(3);
    expect(trialsFor(7, "2026-W45")).toEqual(a);
    const weeks = ["2026-W46", "2026-W47", "2026-W48", "2026-W49"].map((w) => trialsFor(7, w).map((t) => t.id).join());
    expect(new Set([a.map((t) => t.id).join(), ...weeks]).size).toBeGreaterThan(1);
  });

  it("hunts: open creatures never beaten first, then Elder forms whose lost page is still missing; never the Nemesis", () => {
    expect(huntsWanted(recs({}))).toEqual(["hunt:minotaur", "hunt:cyclops", "hunt:oni", "hunt:kitsune"]);
    const some = huntsWanted(recs({ minotaur: 1 }));
    expect(some.slice(0, 3)).toEqual(["hunt:cyclops", "hunt:oni", "hunt:kitsune"]);
    expect(some).toContain("hunt:elder:minotaur");
    const found = new Map([["minotaur", rec(1, { lostPage: true })]]) as never;
    expect(huntsWanted(found)).not.toContain("hunt:elder:minotaur");
    expect(huntsWanted(recs({ minotaur: 1, oni: 1, naga: 1, sphinx: 1 }))).not.toContain("hunt:ammit");
  });

  it("a won fight sets off its creature, its champion and (on hard) the trials of iron", () => {
    expect(fightEvents({ species: "oni", difficulty: "easy", champion: "asha" })).toEqual(["win:oni", "win_as:asha"]);
    expect(fightEvents({ species: "oni", difficulty: "nightmare", champion: "asha" })).toEqual(
      ["win:oni", "win_as:asha", "nightmare_win:oni", "hard_win", "hard_win_as:asha"]);
  });

  it("every champion has a three-chapter story", () => {
    for (const s of Object.values(STORIES)) expect(s).toHaveLength(3);
  });
});

// ── through the routes ────────────────────────────────────────────────────────────────────────────────────────
let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let n = 0;
const BIO = [{ page: 1, text: "Graph algorithms. Breadth first search visits neighbours level by level." }];
function script(m: ChatMessage[]) {
  const all = m.map((x) => x.content).join("\n");
  if (all.includes("battle game")) {
    return JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => {
      n++;
      return { question: `Battle question ${n}?`, options: ["BFS", "DFS", "DP", "Sort"], correct_answer: "BFS", explanation: "Levels.", concept: `concept ${n % 3}`, difficulty: ["easy", "medium", "hard"][i % 3] };
    }) });
  }
  return JSON.stringify({ title: "Lord of Mazes" });
}

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  trackBackgroundForTests(true);
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV })) vi.stubEnv(k, v as string);
  setLlmFactoryForTests(fakeLlms({ "*": script }).factory);
}, 60_000);
afterEach(async () => {
  await settleBackground();
  trackBackgroundForTests(false);
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const board = async (b: Browser) => json(await questsRoute.GET(b.request("/api/v1/quests")));
const claim = (b: Browser, id: string) => claimRoute.POST(b.request("/api/v1/quests/claim", { body: { id } }));
const uid = async (b: Browser) => {
  const req = b.request("/api/v1/quests");
  const ctx = await requestContext(req);
  const s = await ctx.auth.api.getSession({ headers: req.headers });
  return Number(s!.user.id);
};
const happen = async (b: Browser, events: string[], amount = 1) => {
  const ctx = await requestContext(b.request("/api/v1/quests"));
  await scrollEvent(ctx, await uid(b), events, amount);
};

describe("the board in play", () => {
  it("posts today's quests, three trials, two hunts and the champion's first chapter", async () => {
    const b = await person(mail, "a@example.com", "alpha");
    const q = await board(b);
    expect(q.daily.length).toBeGreaterThan(0);
    expect(q.weekly).toHaveLength(3);
    expect(q.weekly[0]).toMatchObject({ kind: "weekly", completed: false, claimed: false, progress: 0 });
    expect(q.hunts.map((h: { id: string }) => h.id)).toEqual(["hunt:minotaur", "hunt:cyclops"]);
    expect(q.hunts[0]).toMatchObject({ reward: HUNT_REWARD[1], call: { place: "arena", topic: "graph algorithms" }, lost_page: "minotaur" });
    expect(q.story).toMatchObject({ champion: "kaien", chapters_done: 0, scroll: { id: "story:kaien:1", kind: "story", target: 1 } });
    // reading it again posts nothing new
    const again = await board(b);
    expect(again.weekly.map((w: { id: string }) => w.id)).toEqual(q.weekly.map((w: { id: string }) => w.id));
  }, 60_000);

  it("a hunt's seal breaks once: its reward, and the creature's lost page in the book", async () => {
    const b = await person(mail, "h@example.com", "hunter");
    await board(b);
    expect((await json(await claim(b, "hunt:minotaur"))).error.code).toBe("scroll_not_done");
    await happen(b, ["win:minotaur"]);
    expect((await board(b)).hunts[0]).toMatchObject({ id: "hunt:minotaur", completed: true, progress: 1 });
    const c = await json(await claim(b, "hunt:minotaur"));
    expect(c).toMatchObject({ ok: true, kind: "hunt", reward: HUNT_REWARD[1], lost_page: "minotaur" });
    expect((await json(await claim(b, "hunt:minotaur"))).error.code).toBe("scroll_claimed");
    const book = await json(await bestiary.GET(b.request("/api/v1/bestiary")));
    expect(book.creatures.find((x: { species: string }) => x.species === "minotaur").lost_page).toBe(true);
    // the claimed hunt leaves the board and another takes its place
    expect((await board(b)).hunts.map((h: { id: string }) => h.id)).toEqual(["hunt:cyclops", "hunt:oni"]);
    expect((await claim(b, "nonsense")).status).toBe(404);
  }, 60_000);

  it("a weekly trial counts its action; the champion's story moves to the next chapter once claimed", async () => {
    const b = await person(mail, "w@example.com", "weekly");
    const q = await board(b);
    const trial = TRIALS.find((t) => t.id === q.weekly[0].id)!;
    await happen(b, [trial.event], trial.target - 1);
    expect((await board(b)).weekly[0]).toMatchObject({ completed: false, progress: trial.target - 1 });
    await happen(b, [trial.event], 5);
    expect((await board(b)).weekly[0]).toMatchObject({ completed: true, progress: trial.target });
    expect(await json(await claim(b, trial.id))).toMatchObject({ ok: true, reward: trial.reward });

    await happen(b, ["win_as:kaien"]);
    expect((await json(await claim(b, "story:kaien:1"))).ok).toBe(true);
    expect((await board(b)).story).toMatchObject({ chapters_done: 1, scroll: { id: "story:kaien:2", progress: 0, target: 2 } });
  }, 60_000);

  it("a real won fight sets off the hunt for its creature and the champion's chapter", async () => {
    const b = await person(mail, "f@example.com", "fighter");
    const id = await uploadPdf(b, "Graphs.pdf", BIO);
    await board(b);
    const s = await json(await battles.POST(b.request("/api/v1/arena/battles", { body: { session_id: id, topic: "graph algorithms", difficulty: "easy" } })));
    expect(s.boss.species).toBe("minotaur");
    await p.env.DB.prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 1), boss_hp = 1, shield = 0 WHERE id = ?").bind(s.battle_id).run();
    const qn = await json(await question.GET(b.request(`/api/v1/arena/battles/${s.battle_id}/question?move=strike`), params({ id: s.battle_id })));
    const r = await json(await answerRoute.POST(b.request(`/api/v1/arena/battles/${s.battle_id}/answer`, { body: { question_id: qn.question.id, answer: "BFS" } }), params({ id: s.battle_id })));
    expect(r.battle.status).toBe("won");
    const q = await board(b);
    expect(q.hunts.find((h: { id: string }) => h.id === "hunt:minotaur")).toMatchObject({ completed: true });
    expect(q.story.scroll).toMatchObject({ id: "story:kaien:1", completed: true });
  }, 60_000);
});
