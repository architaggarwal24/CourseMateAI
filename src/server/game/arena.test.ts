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
import * as continueRoute from "@/app/api/v1/arena/battles/[id]/continue/route";
import * as prepareRoute from "@/app/api/v1/arena/battles/[id]/prepare/route";
import * as rearmRoute from "@/app/api/v1/arena/battles/[id]/rearm/route";
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
    const asked = Number(/Questions to generate: (\d+)/.exec(all)?.[1] ?? 6);
    return JSON.stringify({ questions: Array.from({ length: asked }, (_, i) => {
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

describe("a fight is prepared before it starts (no waiting for the model mid-fight)", () => {
  const battleCalls = () => llm.calls.filter((c) => c.messages.some((m) => m.content.includes("battle game"))).length;
  const pool = async (battle: string, phase: number) =>
    (await db().prepare("SELECT COUNT(*) AS n FROM arena_questions WHERE battle_id = ? AND phase = ? AND status = 'queued'").bind(battle, phase).first<{ n: number }>())!.n;

  it("the whole fight's questions, normal and enraged, are written before the battle is handed over", async () => {
    const b = await person(mail, "prep@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    expect(s.ok).toBe(true);
    expect(s.boss.prepared).toBe(true);
    expect(await pool(s.battle_id, 1)).toBeGreaterThanOrEqual(10);
    expect(await pool(s.battle_id, 2)).toBeGreaterThanOrEqual(6);
    // side by side: the phase-1 batches read different passages (the second searches with extra words)
    const prompts = llm.calls.filter((c) => c.messages.some((m) => m.content.includes("battle game")));
    expect(prompts).toHaveLength(3);
    await settleBackground();
    // several turns in a row: none of them asks the model for questions (a long fight is topped up in the
    // background only once it runs low; four turns never get there)
    const before = battleCalls();
    for (let i = 0; i < 4; i++) {
      const q = await ask(b, s.battle_id, "strike");
      if (!q.question) break;
      await reply(b, s.battle_id, q.question.id, "ATP");
    }
    await settleBackground();
    expect(battleCalls()).toBe(before);
  });

  it("when the enraged phase's questions run out, the fight uses what is left instead of waiting", async () => {
    const b = await person(mail, "prep2@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    await settleBackground();
    await db().prepare("DELETE FROM arena_questions WHERE battle_id = ? AND phase = 2").bind(s.battle_id).run();
    await db().prepare("UPDATE arena_battles SET phase = 2, gen_attempts_2 = 6 WHERE id = ?").bind(s.battle_id).run();
    const before = battleCalls();
    const q = await ask(b, s.battle_id, "strike");
    expect(q.question).toMatchObject({ phase: 1 });
    expect(battleCalls()).toBe(before);
  });

  it("if the questions can't be written, starting again resumes the same battle and prepares it", async () => {
    const b = await person(mail, "prep3@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    setLlmFactoryForTests(fakeLlms({ "*": (m) => (m.some((x) => x.content.includes("battle game")) ? "not json" : script(m)) }).factory);
    const failed = await battles.POST(post(b, "/api/v1/arena/battles", { session_id: id, topic: "mitochondria", difficulty: "easy" }));
    expect(failed.status).toBe(503);
    expect((await json(failed)).error.code).toBe("battle_generation_failed");
    setLlmFactoryForTests(llm.factory);
    const s = await start(b, id);
    expect(s).toMatchObject({ ok: true, resumed: true });
    expect(s.boss.prepared).toBe(true);
    expect(await pool(s.battle_id, 1)).toBeGreaterThan(0);
  });
});

describe("boss effects and the enraged form (Stage 3)", () => {
  const setIntent = (battle: string, intent: object) =>
    db().prepare("UPDATE arena_battles SET intent_json = ? WHERE id = ?").bind(JSON.stringify(intent), battle).run();
  const bigBoss = (battle: string) => db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 999, '$.max_hp', 999), boss_hp = 999, boss_max_hp = 999 WHERE id = ?").bind(battle).run();
  const blow = (effect: string, name = "Freeze") => ({ kind: "attack", name: "Bite", value: 1, description: "Attacks for 1.", effect: { id: effect, name, kind: "x", text: "" } });

  it("a telegraphed effect lands on a miss (a right answer shrugs it off) and changes the next questions", async () => {
    const b = await person(mail, "fx@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    expect(s.boss.effects.pool.length).toBeGreaterThanOrEqual(2);
    await bigBoss(s.battle_id);
    // a right answer: nothing lands
    await setIntent(s.battle_id, blow("freeze"));
    let q = await ask(b, s.battle_id, "strike");
    const full = q.question.time_limit;
    let r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r.effects.landed).toBeNull();
    // a miss: Freeze lands, and the next question has half the time
    await setIntent(s.battle_id, blow("freeze"));
    q = await ask(b, s.battle_id, "strike");
    r = await reply(b, s.battle_id, q.question.id, "DNA");
    expect(r.effects.landed).toMatchObject({ id: "freeze", name: "Freeze" });
    expect(r.battle.effects).toEqual([expect.objectContaining({ id: "freeze", turns: 1 })]);
    q = await ask(b, s.battle_id, "strike");
    expect(q.question.time_limit).toBe(Math.round(full * 0.5));
    r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r.effects.expired).toEqual(["Freeze"]);
    expect(r.battle.effects).toEqual([]);
  });

  it("silence stops spells, a curse stops potions, a stun locks a move, poison costs hearts each question", async () => {
    const b = await person(mail, "fx2@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    await bigBoss(s.battle_id);
    // (each lasts its turns from the question after it lands: poison 3, silence 2, curse 2)
    for (const [effect, name] of [["poison", "Poison"], ["silence", "Silence"], ["curse", "Curse"]]) {
      await setIntent(s.battle_id, blow(effect, name));
      const q = await ask(b, s.battle_id, "guard");
      await reply(b, s.battle_id, q.question.id, "DNA");
    }
    await db().prepare("UPDATE arena_battles SET focus = 5 WHERE id = ?").bind(s.battle_id).run();
    const q = await ask(b, s.battle_id, "strike");
    expect(q.battle).toMatchObject({ silenced: true, cursed: true });
    expect(q.question.effects ?? null).toBeNull();
    const spell = await json(await spells.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/spells`, { spell: "insight" }), params({ id: s.battle_id })));
    expect(spell.error.code).toBe("silenced");
    const item = await json(await items.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/items`, { item: "fifty_fifty" }), params({ id: s.battle_id })));
    expect(item.error.code).toBe("cursed");
    const before = q.battle.player.hp;
    const r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r.effects.ticked).toEqual([expect.objectContaining({ id: "poison", damage: 1 })]);
    expect(r.effects.damage).toBe(1);
    expect(r.battle.player.hp).toBeLessThanOrEqual(before - 1);                     // (the creature's own rule may add to it)
    // a stun locks one move (never Guard): asking for it is refused
    await db().prepare("UPDATE arena_battles SET player_hp = 10, player_max_hp = 10 WHERE id = ?").bind(s.battle_id).run();
    await setIntent(s.battle_id, blow("stun", "Stun"));
    const q2 = await ask(b, s.battle_id, "guard");
    const r2 = await reply(b, s.battle_id, q2.question.id, "DNA");
    const locked = r2.battle.locked_moves as string[];
    expect(locked).toHaveLength(1);
    expect(locked[0]).not.toBe("guard");
    const refused = await question.GET(b.request(`/api/v1/arena/battles/${s.battle_id}/question?move=${locked[0]}`), params({ id: s.battle_id }));
    expect((await json(refused)).error.code).toBe("move_locked");
  });

  it("enraged: the clock runs shorter, and every third turn is the creature's signature blow with one of its own effects", async () => {
    const b = await person(mail, "fx3@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    await bigBoss(s.battle_id);
    let q = await ask(b, s.battle_id, "strike");
    const calm = q.question.time_limit;
    await reply(b, s.battle_id, q.question.id, "ATP");
    await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.rage', json('true'), '$.phase', 2), phase = 2, answered = 4 WHERE id = ?").bind(s.battle_id).run();
    q = await ask(b, s.battle_id, "strike");
    expect(q.question.time_limit).toBe(Math.max(6, Math.round(calm * 0.85)));
    const r = await reply(b, s.battle_id, q.question.id, "ATP");           // the 5th answer: turn 6 comes next
    const species = s.boss.species as string;
    expect(r.next_intent).toMatchObject({ kind: "fury", special: true });
    expect(s.boss.effects.unique).toContain(r.next_intent.effect.id);
    expect(species).toBeTruthy();
  });
});

describe("character select while the questions are written (Stage 5)", () => {
  it("a deferred start makes the battle at once; .../prepare writes its questions; .../rearm fights as the champion picked, until the first question", async () => {
    const b = await person(mail, "select@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id, { defer: true });
    expect(s).toMatchObject({ ok: true, resumed: false });
    expect(s.battle).toMatchObject({ prepared: false, answered: 0, kit: { champion: "kaien" } });
    const pool = async () => (await db().prepare("SELECT COUNT(*) AS n FROM arena_questions WHERE battle_id = ?").bind(s.battle_id).first<{ n: number }>())!.n;
    expect(await pool()).toBe(0);

    // the player picks Asha (joined) on the character select screen while the questions are written
    await db().prepare("INSERT INTO champion_unlocks (user_id, champion_id, source, unlocked_at) VALUES ((SELECT user_id FROM arena_battles WHERE id = ?), 'asha', 'tier1', '2026-11-08')").bind(s.battle_id).run();
    const [ready, picked] = await Promise.all([
      prepareRoute.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/prepare`), params({ id: s.battle_id })).then(json),
      champion.PUT(b.request("/api/v1/avatar/champion", { method: "PUT", body: { champion_id: "asha" } }))
        .then(() => rearmRoute.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/rearm`), params({ id: s.battle_id }))).then(json),
    ]);
    expect(picked.battle.kit).toMatchObject({ champion: "asha" });
    expect(ready.battle.prepared).toBe(true);
    expect(await pool()).toBeGreaterThanOrEqual(5);
    const again = await json(await prepareRoute.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/prepare`), params({ id: s.battle_id })));
    expect(again.battle).toMatchObject({ prepared: true, kit: { champion: "asha" } });  // prepared once; the pick kept

    // once a question is out, the champion is set
    const q = await ask(b, s.battle_id, "strike");
    expect(q.battle.kit).toMatchObject({ champion: "asha" });
    const late = await rearmRoute.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/rearm`), params({ id: s.battle_id }));
    expect(late.status).toBe(409);
    expect((await json(late)).error.code).toBe("battle_started");
  });
});

describe("the combo, the final move, the score card and CONTINUE (Stage 4)", () => {
  const big = (battle: string, hp = 999) => db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', ?, '$.max_hp', 999), boss_hp = ?, boss_max_hp = 999, shield = 0 WHERE id = ?").bind(hp, hp, battle).run();
  const calm = (battle: string) => db().prepare("UPDATE arena_battles SET intent_json = ? WHERE id = ?").bind(JSON.stringify({ kind: "attack", name: "Bite", value: 1, description: "1." }), battle).run();
  const owner = async (battle: string) => (await db().prepare("SELECT user_id AS u FROM arena_battles WHERE id = ?").bind(battle).first<{ u: number }>())!.u;
  const keepGoing = (b: Browser, battle: string, by: string) =>
    continueRoute.POST(post(b, `/api/v1/arena/battles/${battle}/continue`, { with: by }), params({ id: battle }));

  it("the combo climbs to x5 and hits harder; at x5 the next right answer is a combo special; points add up", async () => {
    const b = await person(mail, "combo@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    await big(s.battle_id);
    await calm(s.battle_id);
    let q = await ask(b, s.battle_id, "strike");
    let r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r).toMatchObject({ combo: 1, combo_level: 1, combo_special: false });
    expect(r.points).toBeGreaterThan(0);
    const first = r.score;
    await db().prepare("UPDATE arena_battles SET combo = 5 WHERE id = ?").bind(s.battle_id).run();
    q = await ask(b, s.battle_id, "strike");
    r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r).toMatchObject({ combo: 6, combo_level: 5, combo_special: false });
    q = await ask(b, s.battle_id, "strike");
    r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r).toMatchObject({ combo: 7, combo_level: 5, combo_special: true });
    expect(r.score).toBeGreaterThan(first);
    expect(r.battle.combo_level).toBe(5);
  });

  it("on its knees the boss gives a FINAL MOVE: one quick question; right ends it with your finisher, wrong lets it stagger back up", async () => {
    const b = await person(mail, "finale@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    await big(s.battle_id, 160);                                              // 16%: one more hit puts it under 15%
    await calm(s.battle_id);
    let q = await ask(b, s.battle_id, "strike");
    let r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r.finale_armed).toBe(true);
    expect(r.next_intent).toMatchObject({ kind: "finale" });
    // a miss: it staggers back up (+10%) and the final move is spent
    q = await ask(b, s.battle_id, "strike");
    expect(q.question).toMatchObject({ finale: true });
    expect(q.question.time_limit).toBeLessThanOrEqual(12);
    const before = q.battle.boss.hp;
    r = await reply(b, s.battle_id, q.question.id, "DNA");
    expect(r).toMatchObject({ finale_missed: true, damage_taken: 0 });
    expect(r.battle.boss.hp).toBe(before + 100);
    expect(r.battle.finale).toBe(false);
    // down low again: this time the final move lands, whatever HP is left
    await big(s.battle_id, 140);
    q = await ask(b, s.battle_id, "strike");
    r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r.finale_armed).toBe(true);
    q = await ask(b, s.battle_id, "strike");
    r = await reply(b, s.battle_id, q.question.id, "ATP");
    expect(r.finisher).toMatchObject({ name: expect.any(String) });
    expect(r.battle.status).toBe("won");
    expect(r.battle.result.score).toMatchObject({ finisher: 1000, rank: expect.stringMatching(/^[SABCD]$/) });
    expect(r.battle.result.score.total).toBeGreaterThanOrEqual(1000);
  });

  it("knocked down: CONTINUE with a potion or coins (price doubles, 3 at most) or the countdown loses it", async () => {
    const b = await person(mail, "cont@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id);
    const me = await owner(s.battle_id);
    await big(s.battle_id);
    const knock = async () => {
      await db().prepare("UPDATE arena_battles SET player_hp = 1, intent_json = ? WHERE id = ?")
        .bind(JSON.stringify({ kind: "attack", name: "Bite", value: 3, description: "3." }), s.battle_id).run();
      const q = await ask(b, s.battle_id, "strike");
      return reply(b, s.battle_id, q.question.id, "DNA");
    };
    let r = await knock();
    expect(r.knocked_down).toBe(true);
    expect(r.battle).toMatchObject({ status: "active", player: { hp: 0 }, down: { continues: 0, max: 3, coins: 100, can_continue: true } });
    const refused = await question.GET(b.request(`/api/v1/arena/battles/${s.battle_id}/question?move=strike`), params({ id: s.battle_id }));
    expect((await json(refused)).error.code).toBe("knocked_down");
    // no coins yet: refused, nothing changes
    expect((await keepGoing(b, s.battle_id, "coins")).status).toBe(402);
    await db().prepare("UPDATE user_progress SET coins = 1000 WHERE user_id = ?").bind(me).run();
    let c = await json(await keepGoing(b, s.battle_id, "coins"));
    expect(c.battle).toMatchObject({ player: { hp: c.battle.player.max_hp }, down: null });
    expect(Number((await db().prepare("SELECT coins FROM user_progress WHERE user_id = ?").bind(me).first<{ coins: number }>())!.coins)).toBe(900);
    // a potion next time
    await db().prepare("INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, 'potion_health_small', 1) ON CONFLICT DO UPDATE SET quantity = 1").bind(me).run();
    r = await knock();
    expect(r.battle.down.coins).toBe(200);
    c = await json(await keepGoing(b, s.battle_id, "potion"));
    expect(c.continued).toEqual({ by: "potion", continues: 2 });
    // the third knock-down: too slow, the countdown runs out and the fight is lost
    r = await knock();
    await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.down.deadline', '2000-01-01T00:00:00.000Z') WHERE id = ?").bind(s.battle_id).run();
    const after = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    expect(after.battle.status).toBe("lost");
    expect(after.battle.result.score.continues).toBe(2);
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
