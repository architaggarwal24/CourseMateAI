/** @vitest-environment node */
// Security audit run 2: what arena leaderboards show and who shares them.
//  * The weekly board shows only the mode's name for Nemesis, Invasion and Season battles, whose topics list the
//    player's own missed or studied concepts.
//  * A document board is shared only through a file hash the server checked (a PDF's bytes). A Word, text or image
//    upload can claim any hash, so its board is its owner's alone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as battles from "@/app/api/v1/arena/battles/route";
import * as battleOne from "@/app/api/v1/arena/battles/[id]/route";
import * as question from "@/app/api/v1/arena/battles/[id]/question/route";
import * as answerRoute from "@/app/api/v1/arena/battles/[id]/answer/route";
import * as board from "@/app/api/v1/arena/leaderboard/route";
import * as upload from "@/app/api/v1/upload/route";
import * as pagesRoute from "@/app/api/v1/documents/[id]/pages/route";
import { setMailerForTests } from "../context";
import { setEnvForTests, settleBackground, trackBackgroundForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
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
  setLlmFactoryForTests(fakeLlms({ "*": script }).factory);
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
const ask = async (b: Browser, battle: string) => json(await question.GET(b.request(`/api/v1/arena/battles/${battle}/question`), params({ id: battle })));
const reply = async (b: Browser, battle: string, qid: number, answer: string) =>
  json(await answerRoute.POST(post(b, `/api/v1/arena/battles/${battle}/answer`, { question_id: qid, answer }), params({ id: battle })));

/** Win a battle the way the repository's own arena test does (boss HP lowered on the last answer). */
async function win(b: Browser, battleId: string) {
  await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 999, '$.max_hp', 999), boss_hp = 999, boss_max_hp = 999 WHERE id = ?").bind(battleId).run();
  for (let i = 0; i < 5; i++) {
    const q = await ask(b, battleId);
    if (i === 4) await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 1), boss_hp = 1, shield = 0 WHERE id = ?").bind(battleId).run();
    const r = await reply(b, battleId, q.question.id, "ATP");
    if (r.battle.status !== "active") break;
  }
  const done = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${battleId}`), params({ id: battleId })));
  return done.battle.status as string;
}

const BIO_HASH = async (id: string) => (await db().prepare("SELECT file_hash FROM documents WHERE id = ?").bind(id).first<{ file_hash: string }>())!.file_hash;

describe("arena boards", () => {
  it("the weekly board shows a Nemesis battle as 'Nemesis', never the concepts it was built from", async () => {
    const alice = await person(mail, "alice@example.com", "alice");
    const aliceDoc = await uploadPdf(alice, "Private-notes.pdf", BIO);
    const uid = (await db().prepare("SELECT user_id FROM documents WHERE id = ?").bind(aliceDoc).first<{ user_id: number }>())!.user_id;
    const t = new Date().toISOString();
    for (const c of ["secret concept alpha", "secret concept beta", "secret concept gamma"]) {
      await db().prepare("INSERT INTO concept_mastery (user_id, doc_hash, concept_key, concept, seen, correct, wrong_streak, last_seen_at, last_wrong_at) VALUES (?, ?, ?, ?, 3, 0, 3, ?, ?)")
        .bind(uid, await BIO_HASH(aliceDoc), c, c, t, t).run();
    }
    const s = await json(await battles.POST(post(alice, "/api/v1/arena/battles", { session_id: aliceDoc, mode: "nemesis", difficulty: "easy" })));
    expect(s.ok).toBe(true);
    expect(await win(alice, s.battle_id)).toBe("won");

    const bob = await person(mail, "bob@example.com", "bob");
    const g = await json(await board.GET(bob.request("/api/v1/arena/leaderboard?difficulty=easy&scope=global")));
    const entry = g.entries.find((e: { username: string }) => e.username === "alice");
    expect(entry.topic).toBe("Nemesis");
    expect(JSON.stringify(g)).not.toContain("secret concept");
  }, 120_000);

  it("a text upload that claims a PDF's hash neither sees nor joins that PDF's board; the same PDF shares it", async () => {
    const alice = await person(mail, "alice@example.com", "alice");
    const aliceDoc = await uploadPdf(alice, "Bio.pdf", BIO);
    const s = await json(await battles.POST(post(alice, "/api/v1/arena/battles", { session_id: aliceDoc, topic: "mitochondria", difficulty: "easy" })));
    expect(await win(alice, s.battle_id)).toBe("won");
    const H = await BIO_HASH(aliceDoc);

    const bob = await person(mail, "bob@example.com", "bob");
    const started = await json(await upload.POST(post(bob, "/api/v1/upload", { filename: "anything.txt", size: 10, pages: 1, file_hash: H })));
    const bobDoc = started.session_id as string;
    expect((await pagesRoute.POST(post(bob, `/api/v1/documents/${bobDoc}/pages`, { pages: [{ page: 1, text: "Mitochondria make ATP. ATP is the answer." }], done: true }), params({ id: bobDoc }))).status).toBe(200);
    const read = await json(await board.GET(bob.request(`/api/v1/arena/leaderboard?difficulty=easy&topic=mitochondria&session_id=${bobDoc}`)));
    expect(read.entries.some((e: { username: string }) => e.username === "alice")).toBe(false);
    const sb = await json(await battles.POST(post(bob, "/api/v1/arena/battles", { session_id: bobDoc, topic: "mitochondria", difficulty: "easy" })));
    expect(await win(bob, sb.battle_id)).toBe("won");

    // dave has the same PDF (the server checked its bytes): he shares alice's board, bob doesn't
    const dave = await person(mail, "dave@example.com", "dave");
    const daveDoc = await uploadPdf(dave, "Bio.pdf", BIO);
    expect(await BIO_HASH(daveDoc)).toBe(H);
    const sd = await json(await battles.POST(post(dave, "/api/v1/arena/battles", { session_id: daveDoc, topic: "mitochondria", difficulty: "easy" })));
    expect(await win(dave, sd.battle_id)).toBe("won");
    const seen = await json(await board.GET(alice.request(`/api/v1/arena/leaderboard?difficulty=easy&topic=mitochondria&session_id=${aliceDoc}`)));
    expect(seen.entries.map((e: { username: string }) => e.username).sort()).toEqual(["alice", "dave"]);
  }, 120_000);
});
