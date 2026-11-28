/** @vitest-environment node */
// Security audit run 1: parallel requests from one player must not resolve one game action twice. An expedition
// choice is taken once, and one queued arena charge pays for one use.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { fakeMailer, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { person } from "../test/flows";
import { choose } from "./expedition";
import { applyBuff, consumeCharge } from "./progression";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => { setEnvForTests(null); setMailerForTests(null); vi.unstubAllEnvs(); await p?.dispose(); });

async function player(email: string, name: string) {
  const b = await person(mail, email, name);
  const id = (await p.env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: number }>())!.id;
  return { b, id, ctx: () => requestContext(b.request("/api/v1/hud")) };
}

async function seedRun(userId: number, pending: unknown, fields: Record<string, number> = {}) {
  const t = new Date().toISOString();
  const row = { hearts: 4, max_hearts: 10, gold: 0, act: 1, ...fields };
  await p.env.DB.prepare(
    "INSERT INTO arena_runs (id, user_id, session_id, doc_hash, difficulty, seed, acts_json, map_json, hearts, max_hearts, gold, act, pending_json, created_at, updated_at) " +
    "VALUES ('run1', ?, 's', ?, 'normal', 1, '[]', '{}', ?, ?, ?, ?, ?, ?, ?)",
  ).bind(userId, "a".repeat(64), row.hearts, row.max_hearts, row.gold, row.act, JSON.stringify(pending), t, t).run();
}
const runRow = () => p.env.DB.prepare("SELECT hearts, max_hearts, depth, score, act, gold, pending_json FROM arena_runs WHERE id = 'run1'").first<Record<string, number | string | null>>();

describe("an expedition choice", () => {
  it("is taken once: parallel heals heal once, never past max hearts, and count one step", async () => {
    const { id, ctx } = await player("run@example.com", "runner");
    await seedRun(id, { kind: "rest", heal: 3, concepts: [], options: ["heal"] });
    const tries = await Promise.allSettled([1, 2, 3, 4].map(async () => choose(await ctx(), id, "run1", "heal", null)));
    // (the seeded run has no real map, so the winner's reply can't be drawn: count the refusals instead)
    const refused = tries.filter((t) => t.status === "rejected" && /nothing to choose/.test(String(t.reason)));
    expect(refused).toHaveLength(3);
    const r = await runRow();
    expect(r).toMatchObject({ hearts: 7, depth: 1, score: 25, pending_json: null });
    expect(Number(r!.hearts)).toBeLessThanOrEqual(Number(r!.max_hearts));
  }, 60_000);

  it("a boss relic offer answered twice at once moves on one act, not two", async () => {
    const { id, ctx } = await player("act@example.com", "actor");
    await seedRun(id, { kind: "relic", options: ["aegis"], then: "next_act" });
    await Promise.allSettled([1, 2].map(async () => choose(await ctx(), id, "run1", "skip", null)));
    expect((await runRow())!.act).toBe(2);
  }, 60_000);
});

describe("an arena charge", () => {
  it("pays for one use, however many ask at once", async () => {
    const { id, ctx } = await player("vial@example.com", "vial");
    const c = await ctx();
    expect((await applyBuff(c, { id, tz: null } as never, "heal_1")).ok).toBe(true);
    const used = await Promise.all([1, 2, 3].map(async () => consumeCharge(await ctx(), id, "heal_1")));
    expect(used.filter((n) => n >= 0)).toHaveLength(1);
    expect(await consumeCharge(c, id, "heal_1")).toBe(-1);
  }, 60_000);
});
