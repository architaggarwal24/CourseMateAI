/** @vitest-environment node */
// The taunt (Stage A2): once a fight the boss rages, the ultimate charges +50, and the win pays +25%. And the victory
// emotes: free ones, shop ones, achievement ones.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as battles from "@/app/api/v1/arena/battles/route";
import * as battleOne from "@/app/api/v1/arena/battles/[id]/route";
import * as question from "@/app/api/v1/arena/battles/[id]/question/route";
import * as answerRoute from "@/app/api/v1/arena/battles/[id]/answer/route";
import * as tauntRoute from "@/app/api/v1/arena/battles/[id]/taunt/route";
import * as emotesRoute from "@/app/api/v1/emotes/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests, settleBackground, trackBackgroundForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";
import { TAUNT_BONUS, TAUNT_METER } from "./arena";

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

const db = () => p.env.DB;
const uid = async (b: Browser) => {
  const req = b.request("/api/v1/emotes");
  const ctx = await requestContext(req);
  return Number((await ctx.auth.api.getSession({ headers: req.headers }))!.user.id);
};
const start = async (b: Browser, id: string) =>
  json(await battles.POST(b.request("/api/v1/arena/battles", { body: { session_id: id, topic: "graph algorithms", difficulty: "easy" } })));
const doTaunt = (b: Browser, id: string) => tauntRoute.POST(b.request(`/api/v1/arena/battles/${id}/taunt`, { body: {} }), params({ id }));
async function win(b: Browser, id: string) {
  await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 1), boss_hp = 1, shield = 0 WHERE id = ?").bind(id).run();
  const q = await json(await question.GET(b.request(`/api/v1/arena/battles/${id}/question?move=strike`), params({ id })));
  return json(await answerRoute.POST(b.request(`/api/v1/arena/battles/${id}/answer`, { body: { question_id: q.question.id, answer: "BFS" } }), params({ id })));
}

describe("the taunt", () => {
  it("once a fight: the boss rages, the ultimate charges, and the win pays a quarter more", async () => {
    const b = await person(mail, "t@example.com", "taunter");
    const id = await uploadPdf(b, "Graphs.pdf", BIO);
    const s = await start(b, id);
    expect(s.battle).toMatchObject({ taunted: false, rage: false });
    const t = await json(await doTaunt(b, s.battle_id));
    expect(t).toMatchObject({ ok: true, taunt: { meter_gain: TAUNT_METER, enraged: true, bonus_pct: 25 }, battle: { taunted: true, rage: true, phase: 2 } });
    expect(t.battle.kit.meter).toBe(TAUNT_METER);
    const again = await doTaunt(b, s.battle_id);
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("taunt_used");

    await win(b, s.battle_id);
    const done = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    const paid = done.battle.rewards.boss_defeat;
    expect(done.battle.result.taunt_bonus).toEqual({ xp: Math.round(paid.xp_gained * TAUNT_BONUS), coins: Math.round(paid.coins_gained * TAUNT_BONUS) });
    expect((await doTaunt(b, s.battle_id)).status).toBe(409);                        // the fight is over
  }, 60_000);

  it("a fight without a taunt pays no bonus", async () => {
    const b = await person(mail, "n@example.com", "calm");
    const id = await uploadPdf(b, "Graphs.pdf", BIO);
    const s = await start(b, id);
    await win(b, s.battle_id);
    const done = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    expect(done.battle.result.taunt_bonus).toBeUndefined();
  }, 60_000);
});

describe("victory emotes", () => {
  it("three free, three in the shop, four from achievements", async () => {
    const b = await person(mail, "e@example.com", "emoter");
    const e0 = await json(await emotesRoute.GET(b.request("/api/v1/emotes")));
    const owned = (e: { emotes: { id: string; owned: boolean }[] }) => e.emotes.filter((x) => x.owned).map((x) => x.id).sort();
    expect(e0.emotes).toHaveLength(10);
    expect(owned(e0)).toEqual(["emote_bow", "emote_flex", "emote_gg"]);
    const me = await uid(b);
    await db().prepare("UPDATE user_avatar SET owned_json = '[\"emote_dance\"]' WHERE user_id = ?").bind(me).run();
    await db().prepare("INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, 'first_boss', '2026-11-08')").bind(me).run();
    const e1 = await json(await emotesRoute.GET(b.request("/api/v1/emotes")));
    expect(owned(e1)).toEqual(["emote_bow", "emote_dance", "emote_flex", "emote_gg", "emote_heart"]);
    expect(e1.emotes.find((x: { id: string }) => x.id === "emote_crown")).toMatchObject({ owned: false, how: "Defeat 10 bosses" });
  }, 60_000);
});
