/** @vitest-environment node */
// Admin -> AI -> Test connection, and why a slot can't be used.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, type Db } from "../db";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { saveOllamaUrl } from "./config";
import { setLlmFactoryForTests } from "./run";
import { slotProblem, testModel } from "./test";

let p: LocalPlatform;
let db: Db;
beforeEach(async () => { p = await localPlatform(); db = getDb(p.env.DB); }, 60_000);
afterEach(async () => { setLlmFactoryForTests(null); await p?.dispose(); });

let clock = 0;
const now = () => (clock += 250);

describe("why a slot can't be used", () => {
  it("names a setting without provider:, and a missing key", () => {
    expect(slotProblem("fast", { LLM_FAST: "gemini-3.6-flash", GOOGLE_API_KEY: "k" })).toMatch(/LLM_FAST is "gemini-3.6-flash": write it as provider:model, e.g. gemini:gemini-3.6-flash/);
    expect(slotProblem("fast", { LLM_FAST: "claude:sonnet" })).toMatch(/needs ANTHROPIC_API_KEY/);
    expect(slotProblem("fast", {})).toMatch(/isn't set/);
    expect(slotProblem("fast", AI_ENV)).toBeNull();
    expect(slotProblem("small", {})).toBeNull();
  });
});

describe("test connection", () => {
  it("a working model: its reply and the time", async () => {
    setLlmFactoryForTests(fakeLlms({ "gemini:flash-lite": "OK" }).factory);
    const r = await testModel(db, 1, { slot: "fast" }, {}, AI_ENV, now);
    expect(r).toMatchObject({ ok: true, spec: "gemini:flash-lite", source: "LLM_FAST", reply: "OK", latency_ms: 250 });
  });

  it("a mis-written slot says how to fix it", async () => {
    const r = await testModel(db, 1, { slot: "fast" }, {}, { LLM_FAST: "gemini-3.6-flash", GOOGLE_API_KEY: "k" }, now);
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/provider:model/);
  });

  it("a provider error comes back with a plain hint", async () => {
    setLlmFactoryForTests(fakeLlms({ "gemini:nope": new Error("404 model not found") }).factory);
    const r = await testModel(db, 1, { spec: "gemini:nope" }, {}, AI_ENV, now);
    expect(r).toMatchObject({ ok: false, spec: "gemini:nope", error: "404 model not found" });
    expect(r.hint).toMatch(/No model called "nope"/);
  });

  it("Ollama: no tunnel on the live site, then a model it hasn't pulled", async () => {
    const live = await testModel(db, 1, { spec: "ollama:llama3.2" }, {}, AI_ENV, now);
    expect(live).toMatchObject({ ok: false, error: "Ollama can't be reached from here." });
    expect(live.hint).toMatch(/tunnel address/);
    await saveOllamaUrl(db, "https://abc.trycloudflare.com", AI_ENV);
    setLlmFactoryForTests(fakeLlms({ "ollama:llama3.2": new Error("404 model 'llama3.2' not found") }).factory);
    const r = await testModel(db, 1, { spec: "ollama:llama3.2" }, {}, AI_ENV, now);
    expect(r.hint).toMatch(/ollama pull llama3.2/);
    setLlmFactoryForTests(fakeLlms({ "ollama:llama3.2": new Error("fetch failed") }).factory);
    expect((await testModel(db, 1, { spec: "ollama:llama3.2" }, {}, AI_ENV, now)).hint).toMatch(/new address every time/);
  });

  it("Ollama: a wrong path, and a cloud model it doesn't know yet", async () => {
    await saveOllamaUrl(db, "https://abc.trycloudflare.com", AI_ENV);
    setLlmFactoryForTests(fakeLlms({ "ollama:qwen3:8b": new Error("404 404 page not found") }).factory);
    expect((await testModel(db, 1, { spec: "ollama:qwen3:8b" }, {}, AI_ENV, now)).hint).toMatch(/no \/v1 or \/api/);
    setLlmFactoryForTests(fakeLlms({ "ollama:gpt-oss:120b-cloud": new Error("404 model \"gpt-oss:120b-cloud\" not found, try pulling it first") }).factory);
    expect((await testModel(db, 1, { spec: "ollama:gpt-oss:120b-cloud" }, {}, AI_ENV, now)).hint).toMatch(/ollama signin, then ollama pull gpt-oss:120b-cloud/);
  });

  it("refuses something that isn't provider:model", async () => {
    expect(await testModel(db, 1, { spec: "llama" }, {}, AI_ENV, now)).toMatchObject({ ok: false, spec: null });
  });
});
