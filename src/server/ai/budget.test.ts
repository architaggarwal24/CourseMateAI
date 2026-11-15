/** @vitest-environment node */
// The AI money limits (ai/budget.ts): reserve the worst case before a call, all or nothing across the user's, the
// plan's and the global budget, settle to the real cost after. These tests are the guard that no one can spend past
// a limit: in parallel, after a failure, or with a lowered limit.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type Db } from "../db";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { generate, setLlmFactoryForTests, stream } from "./run";
import { setCapUsd } from "./usage";
import {
  BUDGETS_KEY, DEFAULT_BUDGETS, budgetToday, checkBudgets, loadLimits, parseBudgets, release, reserve, saveBudgets,
  settle, toolScopes, userScopes, worstCostMicro, worstInputTokens, type Budgets,
} from "./budget";

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
const today = () => new Date().toISOString().slice(0, 10);
const row = async (scope: string) =>
  p.env.DB.prepare("SELECT spent_micro AS spent, reserved_micro AS reserved, limit_micro AS lim FROM ai_budget WHERE scope = ? AND day = ?")
    .bind(scope, today()).first<{ spent: number; reserved: number; lim: number }>();
const budgets = (patch: Partial<{ plan: Partial<Budgets["plan"]>; user: Partial<Budgets["user"]>; tools: number | null }>): Budgets => ({
  plan: { ...DEFAULT_BUDGETS.plan, ...patch.plan },
  user: { ...DEFAULT_BUDGETS.user, ...patch.user },
  tools: patch.tools === undefined ? DEFAULT_BUDGETS.tools : patch.tools,
});

describe("settings", () => {
  it("start from the defaults (paid users' days stay under their plan's price), and nothing passes the ceiling", () => {
    expect(parseBudgets(null)).toEqual(DEFAULT_BUDGETS);
    expect(DEFAULT_BUDGETS.plan.apprentice).toBe(0.25);
    expect(DEFAULT_BUDGETS.user.apprentice).toBe(0.02);
    // ₹149 / ₹299 / ₹599 a month over 30 days at about ₹84 a dollar
    for (const [tier, rupees] of [["scholar", 149], ["sage", 299], ["archmage", 599]] as const) {
      expect((DEFAULT_BUDGETS.user[tier] ?? Infinity) * 30 * 84).toBeLessThan(rupees);
    }
    const saved = parseBudgets(JSON.stringify({ plan: { scholar: 3, sage: "x" }, user: { archmage: null }, tools: 500 }));
    expect(saved.plan).toMatchObject({ apprentice: 0.25, scholar: 3, sage: null });      // a bad value keeps its default
    expect(saved.user.archmage).toBeNull();                                                 // no limit at this level
    expect(saved.tools).toBe(20);                                                           // the ceiling
    expect(parseBudgets("{not json")).toEqual(DEFAULT_BUDGETS);
  });

  it("from Admin are checked strictly", () => {
    const ok = { plan: { apprentice: 1, scholar: null, sage: null, archmage: null }, user: { apprentice: 0.01, scholar: 0.05, sage: 0.1, archmage: 0.2 }, tools: 0 };
    expect(checkBudgets(ok)).toEqual(ok);
    for (const bad of [null, "x", { ...ok, plan: null }, { ...ok, tools: -1 }, { ...ok, user: { ...ok.user, sage: 21 } }, { ...ok, user: { ...ok.user, sage: "1" } }]) {
      expect(() => checkBudgets(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: "invalid_budget" }));
    }
  });

  it("are read with the cap in one query", async () => {
    await saveBudgets(db, budgets({ tools: 0.5 }));
    await setCapUsd(db, 3);
    expect(await loadLimits(db)).toEqual({ capUsd: 3, budgets: budgets({ tools: 0.5 }) });
    const row = await p.env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(BUDGETS_KEY).first<{ value: string }>();
    expect(JSON.parse(row!.value).tools).toBe(0.5);
  });
});

describe("the worst case", () => {
  it("counts input as UTF-8 bytes (Hindi is 3 bytes a letter) and output as the max output tokens", () => {
    expect(worstInputTokens([{ content: "abcd" }])).toBe(16 + 4 + 8);
    expect(worstInputTokens([{ content: "नमस्ते" }])).toBe(16 + 18 + 8);
    // flash-lite: $0.1 in, $0.4 out per 1M tokens
    expect(worstCostMicro({ provider: "gemini", model: "flash-lite" }, [{ content: "abcd" }], { maxOutputTokens: 1000 })).toBe(Math.ceil(28 * 0.1 + 1000 * 0.4));
    expect(worstCostMicro({ provider: "gemini", model: "flash-lite" }, [{ content: "x" }], {})).toBeGreaterThan(4096 * 0.4);   // the default max
  });

  it("is zero for free models, so they never need room in a budget", () => {
    expect(worstCostMicro({ provider: "workers-ai", model: "@cf/x" }, [{ content: "x".repeat(10_000) }], {})).toBe(0);
    expect(worstCostMicro({ provider: "ollama", model: "llama3" }, [{ content: "x" }], {})).toBe(0);
  });
});

describe("reserve and settle", () => {
  const scopes = [{ key: "user:1", limitMicro: 100 }, { key: "plan:apprentice", limitMicro: 1000 }, { key: "global", limitMicro: 10_000 }];

  it("reserves against every scope, then settles to the real cost", async () => {
    const hold = await reserve(db, scopes, 60);
    expect(hold).toMatchObject({ worstMicro: 60, scopes: ["user:1", "plan:apprentice", "global"] });
    expect(await row("plan:apprentice")).toEqual({ spent: 0, reserved: 60, lim: 1000 });
    await settle(db, hold!, 25);
    for (const s of ["user:1", "plan:apprentice", "global"]) expect(await row(s)).toMatchObject({ spent: 25, reserved: 0 });
  });

  it("is all or nothing: when one scope has no room, none is touched", async () => {
    expect(await reserve(db, scopes, 80)).not.toBeNull();
    expect(await reserve(db, scopes, 30)).toBeNull();                       // the user's 100 is passed
    expect(await row("plan:apprentice")).toMatchObject({ reserved: 80 });   // the plan and global weren't charged
    expect(await row("global")).toMatchObject({ reserved: 80 });
    expect(await reserve(db, scopes, 101)).toBeNull();                      // bigger than a limit: refused without a query
  });

  it("can't be overshot by parallel calls", async () => {
    const tight = [{ key: "plan:apprentice", limitMicro: 1000 }, { key: "global", limitMicro: 10_000 }];
    const holds = await Promise.all(Array.from({ length: 50 }, () => reserve(db, tight, 100)));
    expect(holds.filter(Boolean)).toHaveLength(10);
    const r = await row("plan:apprentice");
    expect(r!.spent + r!.reserved).toBeLessThanOrEqual(1000);
    expect(await row("global")).toMatchObject({ reserved: 1000 });
  });

  it("a release gives the whole reservation back", async () => {
    const hold = await reserve(db, scopes, 90);
    await release(db, hold!);
    expect(await row("user:1")).toMatchObject({ spent: 0, reserved: 0 });
    expect(await reserve(db, scopes, 100)).not.toBeNull();
  });

  it("a real cost above the reservation is still recorded, and then the scope refuses until the day ends", async () => {
    const hold = await reserve(db, scopes, 50);
    await settle(db, hold!, 150);                   // a wrong price: more than reserved
    expect(await row("user:1")).toMatchObject({ spent: 150, reserved: 0 });
    expect(await reserve(db, scopes, 1)).toBeNull();
  });

  it("a lowered limit applies to the next call", async () => {
    await reserve(db, scopes, 60);
    const lower = [{ key: "user:1", limitMicro: 50 }, ...scopes.slice(1)];
    expect(await reserve(db, lower, 1)).toBeNull();
  });

  it("a free call holds nothing", async () => {
    expect(await reserve(db, scopes, 0)).toMatchObject({ worstMicro: 0, scopes: [] });
    expect(await row("global")).toBeNull();
  });

  it("owners skip the plan and user budgets, never the global cap; the free tools have their own", async () => {
    const lim = { capUsd: 2, budgets: DEFAULT_BUDGETS };
    expect(userScopes(free, lim).map((s) => s.key)).toEqual(["user:1", "plan:apprentice", "global"]);
    expect(userScopes({ id: 9, owner: false, tier: "sage" }, lim).map((s) => s.key)).toEqual(["user:9", "global"]);   // no plan budget by default
    expect(userScopes({ id: 1, owner: true, tier: "archmage" }, lim)).toEqual([{ key: "global", limitMicro: 2_000_000 }]);
    expect(toolScopes(lim)).toEqual([{ key: "tools", limitMicro: 100_000 }, { key: "global", limitMicro: 2_000_000 }]);
  });
});

describe("calling a model", () => {
  const ask = [{ role: "user" as const, content: "What is ATP?" }];

  it("a free user's call is reserved, settled to the real cost, and shows in the plan's spend", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "ATP is energy." }).factory);
    const r = await generate(ctx(), free, "strong", ask);
    expect(r).toMatchObject({ target: { model: "flash-lite" }, limited: false });
    const cost = Math.round(100 * 0.1 + 50 * 0.4);                           // the fake reports 100 in, 50 out
    for (const s of ["user:1", "plan:apprentice", "global"]) expect(await row(s)).toEqual(expect.objectContaining({ spent: cost, reserved: 0 }));
    expect((await budgetToday(db))["plan:apprentice"]).toEqual({ spent_usd: cost / 1e6, reserved_usd: 0 });
    expect(await budgetToday(db)).not.toHaveProperty("user:1");
  });

  it("past a user's budget the free model answers and the paid one is never asked", async () => {
    const f = fakeLlms({ "*": "fine" });
    setLlmFactoryForTests(f.factory);
    await saveBudgets(db, budgets({ user: { apprentice: 0.001 } }));         // under one worst case
    const r = await generate(ctx(), free, "strong", ask);
    expect(r).toMatchObject({ target: { provider: "workers-ai" }, limited: true });
    expect(f.calls.map((c) => c.target)).toEqual(["workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8"]);
    // another free user still has their own budget, and the owner has none
    await saveBudgets(db, budgets({}));
    expect((await generate(ctx(), { ...free, id: 2 }, "strong", ask)).target.provider).toBe("gemini");
  });

  it("past the plan's budget every user of that plan gets the free model, other plans don't", async () => {
    const f = fakeLlms({ "*": "fine" });
    setLlmFactoryForTests(f.factory);
    await saveBudgets(db, budgets({ plan: { apprentice: 0 } }));
    expect((await generate(ctx(), free, "strong", ask)).target.provider).toBe("workers-ai");
    expect((await generate(ctx(), { id: 2, owner: false, tier: "scholar" }, "strong", ask)).target.provider).toBe("gemini");
  });

  it("the global cap holds the owner too", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "fine" }).factory);
    await setCapUsd(db, 0);
    expect((await generate(ctx(), { id: 1, owner: true, tier: "archmage" }, "strong", ask)).target.provider).toBe("workers-ai");
  });

  it("parallel calls never take a plan past its budget", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "fine" }).factory);
    const worst = worstCostMicro({ provider: "gemini", model: "flash-lite" }, [{ content: "x" }], {});
    await saveBudgets(db, budgets({ plan: { apprentice: (worst * 3.5) / 1e6 }, user: { apprentice: null } }));
    const users = [1, 2];
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => generate(ctx(), { ...free, id: users[i % 2] }, "strong", ask)));
    expect(results.every((r) => r.text === "fine")).toBe(true);
    const r = await row("plan:apprentice");
    expect(r!.reserved).toBe(0);
    expect(r!.spent).toBeLessThanOrEqual(r!.lim);
  });

  it("a model that fails gives its reservation back before the next one is tried", async () => {
    setLlmFactoryForTests(fakeLlms({ "gemini:flash-lite": new Error("429"), "*": "from the free one" }).factory);
    const r = await generate(ctx(), free, "strong", ask);
    expect(r.target.provider).toBe("workers-ai");
    expect(await row("user:1")).toMatchObject({ spent: 0, reserved: 0 });
  });

  it("a stream settles when it ends, and one that fails before a word gives its reservation back", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "One two three." }).factory);
    const s = await stream(ctx(), free, "strong", ask);
    expect(await row("user:1")).toMatchObject({ reserved: expect.any(Number) });
    expect((await row("user:1"))!.reserved).toBeGreaterThan(0);
    for await (const _ of s.pieces) { /* read it all */ }
    expect(await row("user:1")).toMatchObject({ spent: 20 + 10, reserved: 0 });   // 100 in, 50 out
    setLlmFactoryForTests(fakeLlms({ "gemini:flash-lite": new Error("timeout"), "*": "free" }).factory);
    const s2 = await stream(ctx(), { ...free, id: 2 }, "strong", ask);
    expect(s2.target.provider).toBe("workers-ai");
    expect(await row("user:2")).toMatchObject({ spent: 0, reserved: 0 });
  });
});

describe("Mana", () => {
  const ask = [{ role: "user" as const, content: "What is ATP?" }];
  const scholar = { id: 1, owner: false, tier: "scholar" as const };
  const grant = (userId: number, micro: number) =>
    p.env.DB.prepare("INSERT INTO mana_ledger (user_id, kind, ref, micro, created_at) VALUES (?, 'grant', ?, ?, 'now')").bind(userId, `g${userId}-${micro}`, micro).run();
  const wallet = (id: number) => p.env.DB.prepare("SELECT balance_micro AS balance, reserved_micro AS reserved FROM ai_wallet WHERE user_id = ?").bind(id).first<{ balance: number; reserved: number }>();

  it("past the user's budget, their Mana pays for the full model and the real cost comes off it", async () => {
    const f = fakeLlms({ "*": "fine" });
    setLlmFactoryForTests(f.factory);
    await saveBudgets(db, budgets({ user: { scholar: 0 } }));
    await grant(1, 300_000);                                                    // 50 Mana
    const r = await generate(ctx(), scholar, "strong", ask);
    expect(r).toMatchObject({ target: { model: "flash" }, mana: true, limited: false });
    const cost = Math.round(100 * 0.3 + 50 * 2.5);                              // flash: $0.3 in, $2.5 out
    expect(await wallet(1)).toEqual({ balance: 300_000 - cost, reserved: 0 });
    expect(await row("user:1")).toBeNull();                                     // the user budget wasn't touched
    expect(await row("global")).toMatchObject({ spent: cost, reserved: 0 });   // the cap still counts it
    const use = await p.env.DB.prepare("SELECT micro FROM mana_ledger WHERE kind = 'use'").first<{ micro: number }>();
    expect(use!.micro).toBe(cost);
  });

  it("not enough Mana for the worst case: the free model answers and nothing is taken", async () => {
    const f = fakeLlms({ "*": "fine" });
    setLlmFactoryForTests(f.factory);
    await saveBudgets(db, budgets({ user: { scholar: 0 } }));
    await grant(1, 50);
    const r = await generate(ctx(), scholar, "strong", ask);
    expect(r).toMatchObject({ target: { provider: "workers-ai" }, limited: true, mana: false });
    expect(await wallet(1)).toEqual({ balance: 50, reserved: 0 });
    // no wallet at all: the same, and no wallet row is left behind
    expect((await generate(ctx(), { ...scholar, id: 2 }, "strong", ask)).target.provider).toBe("workers-ai");
    expect(await wallet(2)).toBeNull();
  });

  it("a stream paid with Mana settles when it ends; the global cap still stops Mana", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "One two." }).factory);
    await saveBudgets(db, budgets({ user: { scholar: 0 } }));
    await grant(1, 300_000);
    const s = await stream(ctx(), scholar, "strong", ask);
    expect(s.mana).toBe(true);
    expect((await wallet(1))!.reserved).toBeGreaterThan(0);
    for await (const _ of s.pieces) { /* read it all */ }
    expect(await wallet(1)).toMatchObject({ reserved: 0 });
    await setCapUsd(db, 0);
    expect((await generate(ctx(), scholar, "strong", ask)).target.provider).toBe("workers-ai");
  });
});

// Guard: every model call goes through a reservation. A new file that calls a model directly (llmFor / apiLlm)
// without reserving first would spend outside every limit.
describe("guard", () => {
  it("only files that reserve first call a model", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(root);
    const callers = files.filter((f) => /\b(llmFor|apiLlm)\(/.test(readFileSync(f, "utf8").replace(/export function (llmFor|apiLlm)\(/g, "")));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) {
      if (f.endsWith(join("ai", "run.ts")) && /return apiLlm\(t\);/.test(readFileSync(f, "utf8"))) {
        // run.ts: llmFor wraps apiLlm, and generate / stream reserve before each llmFor
        expect(readFileSync(f, "utf8").match(/await reserve\(/g)?.length, f).toBeGreaterThanOrEqual(2);
        continue;
      }
      expect(readFileSync(f, "utf8"), f).toMatch(/await reserve\(/);
    }
  });
});
