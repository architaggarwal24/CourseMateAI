/** @vitest-environment node */
// The arena on the Worker (Stage 4.5b): battles decided by the server, creature mechanics, champion kits,
// leaderboards and expeditions, with scripted models.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as battles from "@/app/api/v1/arena/battles/route";
import * as battleActive from "@/app/api/v1/arena/battles/active/route";
import * as battleOne from "@/app/api/v1/arena/battles/[id]/route";
import * as question from "@/app/api/v1/arena/battles/[id]/question/route";
import * as answerRoute from "@/app/api/v1/arena/battles/[id]/answer/route";
import * as items from "@/app/api/v1/arena/battles/[id]/items/route";
import * as spells from "@/app/api/v1/arena/battles/[id]/spells/route";
import * as ultimate from "@/app/api/v1/arena/battles/[id]/ultimate/route";
import * as forfeit from "@/app/api/v1/arena/battles/[id]/forfeit/route";
import * as board from "@/app/api/v1/arena/leaderboard/route";
import * as weak from "@/app/api/v1/arena/weak-concepts/route";
import * as runs from "@/app/api/v1/arena/runs/route";
import * as runActive from "@/app/api/v1/arena/runs/active/route";
import * as travel from "@/app/api/v1/arena/runs/[id]/travel/route";
import * as abandon from "@/app/api/v1/arena/runs/[id]/abandon/route";
import * as champion from "@/app/api/v1/avatar/champion/route";
import { setMailerForTests } from "../context";
import { setEnvForTests, settleBackground, trackBackgroundForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";
import { CREATURES, pickSpecies, summon } from "./bestiary";
import { openSpecies } from "./tome";
import { playerHit, rollIntent } from "./boss";
import { buildMap } from "./expedition";
import * as kits from "./kits";
import { MECHANICS, Turn } from "./mechanics";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let llm: ReturnType<typeof fakeLlms>;
let n = 0;

const BIO = [
  { page: 1, text: "Cell biology basics. The cell membrane controls what enters and leaves the cell. Membrane proteins move ions across the membrane." },
  { page: 2, text: "Mitochondria make ATP through cellular respiration. Respiration uses glucose and oxygen and releases carbon dioxide and water." },
];
const TIERS = ["easy", "medium", "hard"];
function script(m: ChatMessage[]) {
  const all = m.map((x) => x.content).join("\n");
  if (all.includes("battle game")) {
    return JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => {
      n++;
      return { question: `Battle question ${n}?`, options: ["ATP", "DNA", "RNA", "Fat"], correct_answer: "ATP", explanation: "Energy.", concept: `concept ${n}`, difficulty: TIERS[i % 3] };
    }) });
  }
  if (all.includes("boss dialogue")) return JSON.stringify({ title: "Lord of Respiration", attack_names: ["ATP Burst", "Krebs Cycle"], hit_taunts: ["Ow."] });
  if (all.includes("level designer")) return JSON.stringify({ acts: [{ title: "Cells", topic: "cell membrane" }, { title: "Energy", topic: "mitochondria ATP" }] });
  return "ok";
}

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  trackBackgroundForTests(true);
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV })) vi.stubEnv(k, v as string);
  llm = fakeLlms({ "*": script });
  setLlmFactoryForTests(llm.factory);
}, 60_000);
afterEach(async () => {
  await settleBackground();
  trackBackgroundForTests(false);
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const post = (b: Browser, path: string, body: unknown = {}) => b.request(path, { body });
const db = () => p.env.DB;
async function start(b: Browser, id: string, body: Record<string, unknown> = {}) {
  return json(await battles.POST(post(b, "/api/v1/arena/battles", { session_id: id, topic: "mitochondria", difficulty: "easy", ...body })));
}
const ask = async (b: Browser, battle: string, move?: string) =>
  json(await question.GET(b.request(`/api/v1/arena/battles/${battle}/question${move ? `?move=${move}` : ""}`), params({ id: battle })));
const reply = async (b: Browser, battle: string, qid: number, answer: string) =>
  json(await answerRoute.POST(post(b, `/api/v1/arena/battles/${battle}/answer`, { question_id: qid, answer }), params({ id: battle })));

describe("the rules", () => {
  it("a topic always summons the same creature; words pick it; a Nemesis is Ammit", async () => {
    expect(await pickSpecies("cell biology")).toBe("hydra");
    expect(await pickSpecies("graph algorithms")).toBe("minotaur");
    expect(await pickSpecies("Nemesis: x, y")).toBe("ammit");
    expect(await pickSpecies("zzz qqq")).toBe(await pickSpecies("zzz qqq"));
    expect(Object.keys(CREATURES)).toHaveLength(13);
  });

  it("hits, intents, a Hydra's regrowth and an ultimate's meter", () => {
    expect(playerHit({ phase: 1 }, 1)).toEqual({ damage: Math.trunc(28 * 1.3), hit_type: "PERFECT STRIKE" });
    expect(playerHit({ phase: 2 }, 9).damage).toBe(Math.trunc(50 * 1.3));
    const kinds = new Set(Array.from({ length: 200 }, () => rollIntent({ phase: 1, max_hp: 100, attack_names: ["A"] }, "easy").kind));
    expect([...kinds].sort()).toEqual(["attack", "drain", "heavy", "shield"]);
    const boss = { current_hp: 50, max_hp: 100 };
    const t = new Turn({ difficulty: "easy", boss, state: { heads: 0 }, intent: { kind: "attack", name: "A", value: 1, description: "" }, move: "strike", correct: false });
    MECHANICS.hydra.settle(t);
    expect(t.state.heads).toBe(1);
    expect(t.bossHeal).toBe(3);
    const ks = kits.initKit("thorne");
    expect(() => kits.activate(ks)).toThrow(kits.NotReady);
    // Heavy Plate: Thorne's ultimate charges 20% slower (20 a right answer, not 25)
    for (let i = 0; i < 4; i++) kits.charge(ks, true, 1);
    expect(() => kits.activate(ks)).toThrow(kits.NotReady);
    kits.charge(ks, true, 1);
    expect(kits.activate(ks)).toMatchObject({ name: "Last Chapter", hearts: 3 });
  });

  it("an act's map is a pure function of its seed: layer 0 fights, every last-layer node leads to the boss", () => {
    const a = buildMap(42, 1, true), b = buildMap(42, 1, true);
    expect(a).toEqual(b);
    expect(a.nodes.filter((x) => x.layer === 0).every((x) => x.kind === "battle")).toBe(true);
    expect(a.nodes.filter((x) => x.layer === 3).every((x) => x.edges[0] === "1-boss")).toBe(true);
    const reached = new Set(a.nodes.flatMap((x) => x.edges));
    expect(a.nodes.filter((x) => x.layer > 0).every((x) => reached.has(x.id))).toBe(true);
    expect(buildMap(42, 1, false).nodes.some((x) => x.kind === "nemesis")).toBe(false);
  });
});

describe("a battle", () => {
  it("never shows an answer; grades on the server; the first answer is final; a refresh resumes it", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    expect(s).toMatchObject({ ok: true, resumed: false, battle: { status: "active", player: { hp: 10, max_hp: 10 }, focus: 0, intent: expect.any(Object) } });
    expect(JSON.stringify(s)).not.toContain("correct_answer");
    // a new player's Bestiary has tier I open only: the topic's creature, or the closest open one standing in
    expect(s.boss.species).toBe((await summon("mitochondria", openSpecies(new Map()))).species);
    const again = await start(b, id);
    expect(again).toMatchObject({ resumed: true, battle_id: s.battle_id });
    expect((await battles.POST(post(b, "/api/v1/arena/battles", { session_id: id, topic: "membranes", difficulty: "easy" }))).status).toBe(409);

    const q = await ask(b, s.battle_id);
    expect(q.question).toMatchObject({ id: expect.any(Number), move: "strike", time_limit: 30 });
    expect(q.question).not.toHaveProperty("correct_answer");
    expect(q.stock).toEqual({ heal: 0, fifty_fifty: 0 });
    expect((await ask(b, s.battle_id)).question.id).toBe(q.question.id);                 // asking again: the same one
    const r = await reply(b, s.battle_id, q.question.id, "atp");
    expect(r).toMatchObject({ ok: true, correct: true, correct_answer: "ATP", replayed: false, combo: 1, focus_gained: 1 });
    expect(r.damage_dealt + r.shield_absorbed).toBeGreaterThan(0);
    expect((await reply(b, s.battle_id, q.question.id, "DNA"))).toMatchObject({ replayed: true, correct: true });
    const act = await json(await battleActive.GET(b.request(`/api/v1/arena/battles/active?session_id=${id}`)));
    expect(act.battle).toMatchObject({ battle_id: s.battle_id, answered: 1, correct: 1 });
  });

  it("Heavy costs Focus; Insight takes two wrong options; potions are only what you own; time runs out on the server", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    expect((await json(await question.GET(b.request(`/api/v1/arena/battles/${s.battle_id}/question?move=heavy`), params({ id: s.battle_id })))).error.code).toBe("not_enough_focus");
    const q1 = await ask(b, s.battle_id, "jab");
    expect(q1.question).toMatchObject({ move: "jab", time_limit: 15 });
    await reply(b, s.battle_id, q1.question.id, "ATP");                                    // a right Jab: +2 Focus
    const q2 = await ask(b, s.battle_id);
    const spell = await json(await spells.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/spells`, { spell: "insight" }), params({ id: s.battle_id })));
    expect(spell).toMatchObject({ ok: true, cost: 1, question: { fifty_used: true } });
    expect(spell.question.options).toHaveLength(2);
    expect(spell.question.options).toContain("ATP");
    expect((await json(await items.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/items`, { item: "fifty_fifty" }), params({ id: s.battle_id })))).error.code).toBe("already_used");
    expect((await json(await items.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/items`, { item: "heal" }), params({ id: s.battle_id })))).error.code).toMatch(/hp_full|no_stock/);
    expect((await json(await ultimate.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/ultimate`), params({ id: s.battle_id })))).error.code).toBe("ultimate_not_ready");
    await db().prepare("UPDATE arena_questions SET deadline_at = '2000-01-01T00:00:00.000Z' WHERE battle_id = ? AND seq = ?").bind(s.battle_id, q2.question.id).run();
    const after = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    expect(after.battle).toMatchObject({ answered: 2, correct: 1, combo: 0, question_issued: false });
  });

  it("winning pays boss_defeat once, writes the board and levels the champion; retreating loses", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 999, '$.max_hp', 999), boss_hp = 999, boss_max_hp = 999 WHERE id = ?").bind(s.battle_id).run();
    for (let i = 0; i < 5; i++) {
      const q = await ask(b, s.battle_id);
      if (i === 4) await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 1), boss_hp = 1, shield = 0 WHERE id = ?").bind(s.battle_id).run();
      const r = await reply(b, s.battle_id, q.question.id, "ATP");
      if (r.battle.status !== "active") break;
    }
    const done = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    expect(done.battle).toMatchObject({ status: "won", result: { grade: "S+", accuracy: 100, champion: { id: "kaien", xp_gained: 10 * done.battle.correct + 50 } } });
    expect(done.battle.rewards.boss_defeat).toMatchObject({ ok: true, action_type: "boss_defeat" });
    expect(done.battle.rewards.arena_round_complete).toMatchObject({ ok: true });
    const lb = await json(await board.GET(b.request(`/api/v1/arena/leaderboard?difficulty=easy&topic=Mitochondria&session_id=${id}`)));
    expect(lb.entries).toEqual([expect.objectContaining({ rank: 1, username: "free", grade: "S+", is_me: true })]);
    expect((await json(await board.GET(b.request("/api/v1/arena/leaderboard?difficulty=easy&scope=global")))).entries[0].topic).toBe("mitochondria");
    expect((await json(await champion.GET(b.request("/api/v1/avatar/champion")))).progress.kaien).toMatchObject({ xp: 10 * done.battle.correct + 50, battles: 1, wins: 1 });

    const s2 = await start(b, id, { topic: "membranes" });
    const lost = await json(await forfeit.POST(post(b, `/api/v1/arena/battles/${s2.battle_id}/forfeit`), params({ id: s2.battle_id })));
    expect(lost.battle).toMatchObject({ status: "lost" });
    expect((await json(await forfeit.POST(post(b, `/api/v1/arena/battles/${s2.battle_id}/forfeit`), params({ id: s2.battle_id })))).battle.status).toBe("lost");
  }, 30_000);

  it("a Nemesis needs missed concepts first", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await battles.POST(post(b, "/api/v1/arena/battles", { session_id: id, mode: "nemesis", difficulty: "easy" }));
    expect((await json(r)).error).toMatchObject({ code: "not_enough_data", details: { needed: 3 } });
    expect(await json(await weak.GET(b.request(`/api/v1/arena/weak-concepts?session_id=${id}`)))).toMatchObject({ nemesis_ready: false, missed_total: 0 });
  });
});

describe("a Hunt (the Bestiary's Hunt button)", () => {
  it("summons the creature asked for when its page is open, and refuses a sealed one", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const sealed = await battles.POST(post(b, "/api/v1/arena/battles", { session_id: id, topic: "mitochondria", difficulty: "easy", species: "hydra" }));
    expect(sealed.status).toBe(409);
    expect((await json(sealed)).error).toMatchObject({ code: "creature_sealed", details: { species: "hydra" } });
    const want = (await summon("mitochondria", openSpecies(new Map()))).species === "oni" ? "kitsune" : "oni";   // not what the topic calls
    const s = await start(b, id, { species: want });
    expect(s.boss.species).toBe(want);
  });
});

describe("an expedition", () => {
  it("draws three acts once; a fight node starts a run battle; abandoning ends both", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await json(await runs.POST(post(b, "/api/v1/arena/runs", { session_id: id, difficulty: "easy" })));
    expect(r).toMatchObject({ ok: true, resumed: false, run: { act: 1, acts_total: 3, hearts: 10, gold: 0, document_ready: true } });
    expect(r.run.acts.map((a: any) => a.topic)).toEqual(["cell membrane", "mitochondria ATP", "cell membrane"]);
    expect(r.run.reachable.length).toBeGreaterThanOrEqual(2);
    expect((await json(await runs.POST(post(b, "/api/v1/arena/runs", { session_id: id, difficulty: "hard" })))).error.code).toBe("run_in_progress");
    const node = r.run.reachable[0];
    const t = await json(await travel.POST(post(b, `/api/v1/arena/runs/${r.run.run_id}/travel`, { node_id: node }), params({ id: r.run.run_id })));
    expect(t).toMatchObject({ ok: true, battle_id: expect.any(String), battle: { mode: "expedition", run_id: r.run.run_id } });
    expect((await json(await travel.POST(post(b, `/api/v1/arena/runs/${r.run.run_id}/travel`, { node_id: node }), params({ id: r.run.run_id })))).error.code).toBe("battle_in_progress");
    const gone = await json(await abandon.POST(post(b, `/api/v1/arena/runs/${r.run.run_id}/abandon`), params({ id: r.run.run_id })));
    expect(gone.run).toMatchObject({ status: "abandoned", battle_id: null });
    expect((await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${t.battle_id}`), params({ id: t.battle_id })))).battle.status).toBe("lost");
    expect((await json(await runActive.GET(b.request("/api/v1/arena/runs/active")))).run).toBeNull();
  });
});
