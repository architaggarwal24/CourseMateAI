/** @vitest-environment node */
// Admin AI control: models for everyone (saved in D1, over the LLM_* settings), each admin's own model for testing,
// and Ollama on the admin's own computer during local development only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type Db } from "../db";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { route } from "./models";
import { generate, setLlmFactoryForTests } from "./run";
import { setCapUsd } from "./usage";
import {
  aiSettings, effectiveEnv, ollamaEnabled, ollamaModels, overrideTarget, providerStatus, saveOverride, saveSlots,
} from "./config";

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
const student = { id: 2, owner: false, admin: false, tier: "apprentice" as const };
const admin = { id: 1, owner: false, admin: true, tier: "archmage" as const };
const ask = [{ role: "user" as const, content: "hi" }];

describe("models for everyone", () => {
  it("a saved slot replaces the LLM_* setting; clearing it goes back to the setting", async () => {
    await saveSlots(db, { fast: "claude:haiku" });
    expect(route("apprentice", "strong", { env: await effectiveEnv(db) })[0]).toMatchObject({ provider: "claude", model: "haiku" });
    await saveSlots(db, { fast: null });
    expect(route("apprentice", "strong", { env: await effectiveEnv(db) })[0]).toMatchObject({ provider: "gemini", model: "flash-lite" });
  });

  it("every user's calls use the saved models", async () => {
    const f = fakeLlms({ "*": "ok" });
    setLlmFactoryForTests(f.factory);
    await saveSlots(db, { fast: "claude:haiku" });
    expect((await generate(ctx(), student, "strong", ask)).target).toMatchObject({ provider: "claude", model: "haiku" });
  });

  it("refuses a provider with no key on the server, a bad spec, and Ollama (never for everyone)", async () => {
    await expect(saveSlots(db, { strong: "openai:gpt-5" })).rejects.toMatchObject({ code: "provider_not_configured" });
    await expect(saveSlots(db, { strong: "nonsense" })).rejects.toMatchObject({ code: "invalid_model" });
    await expect(saveSlots(db, { strong: "ollama:llama3" })).rejects.toMatchObject({ code: "invalid_model" });
  });

  it("the small slot is a Workers AI model", async () => {
    await saveSlots(db, { small: "@cf/meta/llama-3.2-3b-instruct" });
    expect(route("apprentice", "small", { env: await effectiveEnv(db) })[0]).toMatchObject({ provider: "workers-ai", model: "@cf/meta/llama-3.2-3b-instruct" });
    await expect(saveSlots(db, { small: "gemini:flash" })).rejects.toMatchObject({ code: "invalid_model" });
  });
});

describe("an admin's own model", () => {
  it("answers the admin first; students never get it", async () => {
    const f = fakeLlms({ "*": "ok" });
    setLlmFactoryForTests(f.factory);
    await saveOverride(db, 1, "claude:opus");
    expect((await generate(ctx(), admin, "strong", ask)).target).toMatchObject({ provider: "claude", model: "opus" });
    expect((await generate(ctx(), { ...student, id: 1, admin: false }, "strong", ask)).target.model).not.toBe("opus");
    expect((await generate(ctx(), student, "strong", ask)).target.model).not.toBe("opus");
  });

  it("falls back to the normal models when it fails", async () => {
    setLlmFactoryForTests(fakeLlms({ "claude:opus": new Error("down"), "*": "ok" }).factory);
    await saveOverride(db, 1, "claude:opus");
    expect((await generate(ctx(), admin, "strong", ask)).target.model).not.toBe("opus");
  });

  it("clearing it goes back to the normal models", async () => {
    await saveOverride(db, 1, "claude:opus");
    await saveOverride(db, 1, null);
    expect((await aiSettings(db, 1)).override).toBeNull();
  });

  it("an API model is skipped once the day's spend cap is reached (Workers AI only, as for everyone)", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": "ok" }).factory);
    await saveOverride(db, 1, "claude:opus");
    await setCapUsd(db, 0);
    expect((await generate(ctx(), admin, "strong", ask)).target.provider).toBe("workers-ai");
  });
});

describe("Ollama (local development only)", () => {
  it("is on only under next dev", () => {
    expect(ollamaEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(ollamaEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(ollamaEnabled({ NODE_ENV: "test" })).toBe(false);
  });

  it("an admin can pick it in development; it is refused anywhere else", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await saveOverride(db, 1, "ollama:llama3.2");
    expect(overrideTarget("ollama:llama3.2", process.env)).toMatchObject({ provider: "ollama", model: "llama3.2" });
    vi.stubEnv("NODE_ENV", "production");
    expect(overrideTarget("ollama:llama3.2", process.env)).toBeNull();               // a saved choice is ignored live
    await expect(saveOverride(db, 1, "ollama:llama3.2")).rejects.toMatchObject({ code: "invalid_model" });
  });

  it("lists the models Ollama has, and an empty list when it isn't running", async () => {
    const env = { NODE_ENV: "development", OLLAMA_BASE_URL: "http://localhost:11434" };
    const ok = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:7b" }] })));
    expect(await ollamaModels(env, ok as unknown as typeof fetch)).toEqual(["llama3.2:latest", "qwen2.5:7b"]);
    expect((ok.mock.calls[0] as unknown[])[0]).toBe("http://localhost:11434/api/tags");
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    expect(await ollamaModels(env, down as unknown as typeof fetch)).toEqual([]);
    expect(await ollamaModels({ NODE_ENV: "production" }, ok as unknown as typeof fetch)).toEqual([]);
  });
});

describe("what the admin page shows", () => {
  it("which providers have a key on the server", () => {
    const s = providerStatus(process.env);
    expect(s.find((x) => x.id === "gemini")?.configured).toBe(true);
    expect(s.find((x) => x.id === "openai")?.configured).toBe(false);
    expect(s.find((x) => x.id === "workers-ai")?.configured).toBe(true);
    expect(s.some((x) => x.id === "ollama")).toBe(false);                               // not in production / tests
  });
});
