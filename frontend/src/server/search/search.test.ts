/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { mmr, searchDeps, vectorizeIndex, workersAiEmbedder, type VectorMatch } from "./index";

describe("the Cloudflare bindings", () => {
  it("embeds through Workers AI in batches of 100, with CLS pooling", async () => {
    const run = vi.fn(async (_m: string, input: { text: string[] }) => ({ data: input.text.map(() => [1, 0]) }));
    const out = await workersAiEmbedder({ run }).embed(Array.from({ length: 150 }, (_, i) => `t${i}`));
    expect(out).toHaveLength(150);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]).toEqual(["@cf/baai/bge-small-en-v1.5", { text: expect.any(Array), pooling: "cls" }]);
    expect(run.mock.calls[0][1].text).toHaveLength(100);
  });

  it("refuses an answer without embeddings", async () => {
    await expect(workersAiEmbedder({ run: async () => ({}) }).embed(["x"])).rejects.toThrow(/no embeddings/);
  });

  it("talks to Vectorize with its own option names", async () => {
    const v = { upsert: vi.fn(async () => ({})), query: vi.fn(async () => ({ matches: [{ id: "d:0", score: 0.9 }] })), deleteByIds: vi.fn(async () => ({})) };
    const idx = vectorizeIndex(v);
    expect(await idx.query([1, 2], { topK: 20, filter: { doc: "d" }, returnValues: true })).toEqual([{ id: "d:0", score: 0.9 }]);
    expect(v.query).toHaveBeenCalledWith([1, 2], { topK: 20, filter: { doc: "d" }, returnValues: true, returnMetadata: "indexed" });
    await idx.deleteByIds(Array.from({ length: 1500 }, (_, i) => `d:${i}`));
    expect(v.deleteByIds).toHaveBeenCalledTimes(2);
  });

  it("is off when either binding is missing", () => {
    expect(searchDeps({ AI: {} })).toBeNull();
    expect(searchDeps(null)).toBeNull();
    expect(searchDeps({ AI: { run: async () => ({}) }, VECTORS: {} })).not.toBeNull();
  });
});

describe("mmr", () => {
  it("prefers a different passage over a near-copy of the first", () => {
    const m = (id: string, values: number[]): VectorMatch => ({ id, score: 0, values });
    // a:1 is an exact copy of a:0; b:0 is as relevant but says something a little different
    const picked = mmr([1, 1, 0], [m("a:0", [1, 0.8, 0]), m("a:1", [1, 0.8, 0]), m("b:0", [0.8, 1, 0])], 2);
    expect(picked.map((p) => p.id)).toEqual(["a:0", "b:0"]);
    expect(picked[0].score).toBeCloseTo(0.994, 2);
  });
});
