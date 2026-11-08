/** @vitest-environment node */
// The AI layer (Stage 4.3): routes per plan and job, fallbacks, metering, quotas, costs and the spend cap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type Db } from "../db";
import { appSettings } from "../db/schema";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { parseSpec, route, slotTarget } from "./models";
import { generate, setLlmFactoryForTests, stream } from "./run";
import { CAP_KEY, capCeilingUsd, capUsd, costMicroUsd, costReport, price, setCapUsd, spendToday, usedThisMonth, usedToday } from "./usage";

let p: LocalPlatform;
let db: Db;
beforeEach(async () => {
  p = await localPlatform();
  db = getDb(p.env.DB);
  for (const [k, v] of Object.entries(AI_ENV)) vi.stubEnv(k, v);
  await p.env.DB.prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (1, 'A', 'a@x.io', 1, 0, 0), (2, 'B', 'b@x.io', 1, 0, 0)").run();
}, 60_000);
afterEach(async () => {
  setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const ctx = () => ({ db, env: { AI: {} } });
const free = { id: 1, owner: false, tier: "apprentice" as const };

describe("routes", () => {
  it("parse provider:model, need the provider's key, and fall through the slots", () => {
    expect(parseSpec("google:gemini-x")).toEqual({ provider: "gemini", model: "gemini-x" });
    expect(parseSpec("nope")).toBeNull();
    expect(slotTarget("premium")).toMatchObject({ provider: "claude", model: "sonnet", apiKey: "a-key" });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(slotTarget("premium")).toMatchObject({ provider: "gemini", model: "flash" });          // LLM_STRONG next
    expect(slotTarget("small")).toMatchObject({ provider: "workers-ai", model: "@cf/meta/llama-3.1-8b-instruct-fp8" });
  });

  it("per plan and job, the spend cap leaving only Workers AI, and MODEL_ROUTES_JSON overriding", () => {
    const names = (ts: { provider: string; model: string }[]) => ts.map((t) => `${t.provider}:${t.model}`);
    expect(names(route("apprentice", "strong"))).toEqual(["gemini:flash-lite", "gemini:flash", "workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8"]);
    expect(names(route("archmage", "strong"))[0]).toBe("claude:sonnet");
    expect(names(route("sage", "small"))[0]).toBe("workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(names(route("archmage", "strong", { capped: true }))).toEqual(["workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8"]);
    vi.stubEnv("MODEL_ROUTES_JSON", JSON.stringify({ apprentice: { strong: ["strong"] } }));
    expect(names(route("apprentice", "strong"))).toEqual(["gemini:flash"]);
  });
});

describe("costs", () => {
  it("come from MODEL_PRICES_JSON, Workers AI is free, an unpriced model is estimated", () => {
    expect(costMicroUsd("gemini", "flash", 1_000_000, 100_000)).toBe(300_000 + 250_000);
    expect(price("claude", "anything").priced).toBe(true);
    expect(price("workers-ai", "x").rate).toEqual([0, 0]);
    expect(price("openai", "mystery")).toEqual({ rate: [1, 4], priced: false });
  });
});

describe("calling a model", () => {
  it("meters each call for the user and the model", async () => {
    const f = fakeLlms({ "gemini:flash-lite": "Mitochondria make ATP." });
    setLlmFactoryForTests(f.factory);
    const r = await generate(ctx(), free, "strong", [{ role: "user", content: "hi" }]);
    expect(r).toMatchObject({ text: "Mitochondria make ATP.", target: { provider: "gemini", model: "flash-lite" } });
    expect(await usedToday(db, 1)).toEqual({ ai_calls: 1 });
    expect(await usedThisMonth(db, 1)).toEqual({ calls: 1, tokens: 150 });
    const report = await costReport(db);
    expect(report.models[0]).toMatchObject({ provider: "gemini", model: "flash-lite", calls: 1, priced: true });
    expect(report.today_usd).toBeCloseTo(0.00003, 6);
  });

  it("falls back to the next model when one fails, and says so when none answers", async () => {
    setLlmFactoryForTests(fakeLlms({ "gemini:flash-lite": new Error("429"), "gemini:flash": "From the strong one." }).factory);
    const r = await generate(ctx(), free, "strong", [{ role: "user", content: "hi" }]);
    expect(r.target.model).toBe("flash");
    expect((await costReport(db)).models[0].fallbacks).toBe(1);
    setLlmFactoryForTests(fakeLlms({ "*": new Error("down") }).factory);
    await expect(generate(ctx(), free, "strong", [{ role: "user", content: "hi" }])).rejects.toMatchObject({ status: 503, code: "ai_unavailable" });
  });

  it("streams: the next model takes over before the first word, and the whole text is metered", async () => {
    setLlmFactoryForTests(fakeLlms({ "gemini:flash-lite": new Error("timeout"), "gemini:flash": "One two three." }).factory);
    const s = await stream(ctx(), free, "strong", [{ role: "user", content: "hi" }]);
    const got: string[] = [];
    for await (const piece of s.pieces) got.push(piece);
    expect(got.join("")).toBe("One two three.");
    expect((await s.done).text).toBe("One two three.");
    expect(await usedToday(db, 1)).toEqual({ ai_calls: 1 });
  });

  it("stops at the plan's daily calls with an upgrade prompt; the owner has no quota", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "ok" }).factory);
    await p.env.DB.prepare("INSERT INTO usage_daily (user_id, day, ai_calls, tokens_in, tokens_out) VALUES (1, ?, 25, 0, 0)").bind(new Date().toISOString().slice(0, 10)).run();
    await expect(generate(ctx(), free, "strong", [{ role: "user", content: "hi" }]))
      .rejects.toMatchObject({ status: 429, code: "plan_limit", action: "plans", details: { limit: "ai_calls_day", allowed: 25, upgrade_tier: "scholar" } });
    await expect(generate(ctx(), { id: 1, owner: true, tier: "archmage" }, "strong", [{ role: "user", content: "hi" }])).resolves.toBeTruthy();
  });

  it("parallel calls can't overshoot the daily calls (each takes its call atomically before the model is asked)", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "ok" }).factory);
    await p.env.DB.prepare("INSERT INTO usage_daily (user_id, day, ai_calls, tokens_in, tokens_out) VALUES (1, ?, 23, 0, 0)").bind(new Date().toISOString().slice(0, 10)).run();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => generate(ctx(), free, "strong", [{ role: "user", content: "hi" }])));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "plan_limit")).toBe(true);
    expect(await usedToday(db, 1)).toEqual({ ai_calls: 25 });
  });

  it("a call no model answered is given back", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": new Error("down") }).factory);
    await expect(generate(ctx(), free, "strong", [{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "ai_unavailable" });
    await expect(stream(ctx(), free, "strong", [{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(await usedToday(db, 1)).toEqual({ ai_calls: 0 });
  });

  it("once the day's spend reaches the cap, only Workers AI answers", async () => {
    const f = fakeLlms({ "*": "fine" });
    setLlmFactoryForTests(f.factory);
    expect(await capUsd(db)).toBe(2);
    await setCapUsd(db, 0.00001);
    await generate(ctx(), free, "strong", [{ role: "user", content: "hi" }]);          // spends a little
    expect(await spendToday(db)).toBeGreaterThan(0.00001);
    const r = await generate(ctx(), { ...free, id: 2 }, "strong", [{ role: "user", content: "hi" }]);
    expect(r.target.provider).toBe("workers-ai");
  });

  it("the cap is never off and never above the hard ceiling (AI_DAILY_CAP_MAX_USD, default 20)", async () => {
    await db.insert(appSettings).values({ key: CAP_KEY, value: "off", updatedAt: "x" })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: "off" } });
    expect(await capUsd(db)).toBe(20);                                   // an old "no cap" now means the ceiling
    await setCapUsd(db, 50);
    expect(await capUsd(db)).toBe(20);
    expect(await capUsd(db, { AI_DAILY_CAP_MAX_USD: "100" })).toBe(50);   // raised on purpose, in the dashboard
    expect(await capUsd(db, { AI_DAILY_CAP_USD: "off" })).toBe(20);       // the saved value wins, still under the ceiling
    expect(capCeilingUsd({})).toBe(20);
    expect(capCeilingUsd({ AI_DAILY_CAP_MAX_USD: "nonsense" })).toBe(20);
  });
});
