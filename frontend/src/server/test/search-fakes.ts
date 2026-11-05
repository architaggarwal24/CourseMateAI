// Stand-ins for Workers AI and Vectorize in tests (both only run on Cloudflare's network): a bag-of-words
// embedding (texts sharing words point the same way) and an in-memory index with Vectorize's `doc` filter.
import type { Embedder, VectorIndex, VectorMatch } from "../search";

const DIM = 512;

function hashWord(w: string): number {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
  return Math.abs(h) % DIM;
}

export function fakeEmbedder(): Embedder & { calls: number } {
  const e = {
    model: "@cf/baai/bge-small-en-v1.5",
    calls: 0,
    async embed(texts: string[]) {
      e.calls++;
      return texts.map((t) => {
        const v = new Array(DIM).fill(0);
        for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) if (w.length > 2) v[hashWord(w)] += 1;
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      });
    },
  };
  return e;
}

export function fakeVectors(): VectorIndex & { store: Map<string, { values: number[]; metadata: Record<string, string | number> }> } {
  const store = new Map<string, { values: number[]; metadata: Record<string, string | number> }>();
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  return {
    store,
    async upsert(vectors) { for (const v of vectors) store.set(v.id, { values: v.values, metadata: v.metadata }); },
    async query(values, { topK, filter, returnValues }) {
      const want = filter?.doc as string | { $in: string[] } | undefined;
      const ok = (doc: string | number) => !want || (typeof want === "string" ? doc === want : want.$in.includes(String(doc)));
      const matches: VectorMatch[] = [...store].filter(([, v]) => ok(v.metadata.doc))
        .map(([id, v]) => ({ id, score: cos(values, v.values), values: returnValues ? v.values : undefined, metadata: v.metadata }));
      return matches.sort((a, b) => b.score - a.score).slice(0, topK);
    },
    async deleteByIds(ids) { for (const id of ids) store.delete(id); },
  };
}
