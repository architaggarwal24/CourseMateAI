// Search over a user's documents (Stage 4.2): chunk embeddings in Vectorize (VECTORS), made by Workers AI
// (bge-small-en-v1.5, the same model the Python backend ran locally). The text of each chunk is in D1.
// Picks are MMR (relevant and not repetitive, like the Python backend), and in a course every document that is
// nearly as relevant as the best one gets at least one passage.
import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db";
import { documentChunks } from "../db/schema";

export const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const DIMENSIONS = 384;
const EMBED_BATCH = 100;                 // Workers AI's most texts per call
export const VOICE_SHARE = 0.75;

export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorMatch { id: string; score: number; values?: number[]; metadata?: Record<string, unknown> }
export interface VectorIndex {
  upsert(vectors: { id: string; values: number[]; metadata: Record<string, string | number> }[]): Promise<void>;
  query(values: number[], opts: { topK: number; filter?: Record<string, unknown>; returnValues?: boolean }): Promise<VectorMatch[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

type AiBinding = { run(model: string, input: { text: string[]; pooling?: "cls" | "mean" }): Promise<{ data?: number[][] }> };
type VectorizeBinding = {
  upsert(v: unknown[]): Promise<unknown>;
  query(values: number[], opts: Record<string, unknown>): Promise<{ matches: VectorMatch[] }>;
  deleteByIds(ids: string[]): Promise<unknown>;
};

export function workersAiEmbedder(ai: AiBinding): Embedder {
  return {
    model: EMBEDDING_MODEL,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        // CLS pooling: how BGE models are meant to be read (the default "mean" is only kept for old indexes).
        const r = await ai.run(EMBEDDING_MODEL, { text: texts.slice(i, i + EMBED_BATCH), pooling: "cls" });
        if (!r?.data || r.data.length !== Math.min(EMBED_BATCH, texts.length - i)) throw new Error("Workers AI returned no embeddings");
        out.push(...r.data);
      }
      return out;
    },
  };
}

export function vectorizeIndex(v: VectorizeBinding): VectorIndex {
  return {
    async upsert(vectors) {
      for (let i = 0; i < vectors.length; i += 500) await v.upsert(vectors.slice(i, i + 500));
    },
    async query(values, { topK, filter, returnValues }) {
      const r = await v.query(values, { topK, filter, returnValues: !!returnValues, returnMetadata: "indexed" });
      return r.matches ?? [];
    },
    async deleteByIds(ids) {
      for (let i = 0; i < ids.length; i += 1000) await v.deleteByIds(ids.slice(i, i + 1000));
    },
  };
}

export interface SearchDeps { embedder: Embedder; vectors: VectorIndex }

let testDeps: SearchDeps | null = null;
export function setSearchForTests(deps: SearchDeps | null): void {
  testDeps = deps;
}

/** The Workers AI + Vectorize pair, or null when either binding is missing (see docs/deploy-cloudflare.md). */
export function searchDeps(env: Partial<Record<"AI" | "VECTORS", unknown>> | null | undefined): SearchDeps | null {
  if (testDeps) return testDeps;
  if (!env?.AI || !env?.VECTORS) return null;
  return { embedder: workersAiEmbedder(env.AI as AiBinding), vectors: vectorizeIndex(env.VECTORS as VectorizeBinding) };
}

export const vectorId = (documentId: string, idx: number) => `${documentId}:${idx}`;

function parseId(id: string): { documentId: string; idx: number } | null {
  const at = id.lastIndexOf(":");
  const idx = Number(id.slice(at + 1));
  return at > 0 && Number.isInteger(idx) ? { documentId: id.slice(0, at), idx } : null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Maximal marginal relevance: k picks that are similar to the query and not to each other (lambda 0.7). */
export function mmr(query: number[], candidates: VectorMatch[], k: number, lambda = 0.7): VectorMatch[] {
  const pool = candidates.filter((c) => c.values?.length);
  if (pool.length < candidates.length) return candidates.slice(0, k);      // no values: plain top-k
  const picked: VectorMatch[] = [];
  const rel = pool.map((c) => cosine(query, c.values!));
  const left = pool.map((_, i) => i);
  while (picked.length < k && left.length) {
    let best = -1, bestScore = -Infinity;
    for (const i of left) {
      const redundancy = picked.length ? Math.max(...picked.map((p) => cosine(pool[i].values!, p.values!))) : 0;
      const s = lambda * rel[i] - (1 - lambda) * redundancy;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    picked.push({ ...pool[best], score: rel[best] });
    left.splice(left.indexOf(best), 1);
  }
  return picked;
}

export interface Passage {
  documentId: string;
  documentName: string;
  idx: number;
  page: number;
  text: string;
  /** Cosine similarity to the question, 0..1. */
  score: number;
}

/**
 * The k best passages for `question` among `docs` (one document, or a course's ready documents), best first.
 * Every document nearly as relevant as the best one gets at least one passage (VOICE_SHARE).
 */
export async function searchPassages(
  db: Db, deps: SearchDeps, docs: { id: string; name: string }[], question: string, k = 5,
): Promise<Passage[]> {
  if (!docs.length || !question.trim()) return [];
  const [q] = await deps.embedder.embed([question]);
  const names = new Map(docs.map((d) => [d.id, d.name]));
  const filter = docs.length === 1 ? { doc: docs[0].id } : { doc: { $in: docs.map((d) => d.id) } };
  const raw = await deps.vectors.query(q, { topK: 20, filter, returnValues: true });
  const hits = raw.filter((m) => names.has(parseId(m.id)?.documentId ?? ""));
  let top = mmr(q, hits, k);
  if (docs.length > 1 && top.length) {
    const floor = top[0].score * VOICE_SHARE;
    const docOf = (m: VectorMatch) => parseId(m.id)!.documentId;
    const have = new Set(top.map(docOf));
    for (const h of hits.map((m) => ({ ...m, score: m.values ? cosine(q, m.values) : m.score })).sort((a, b) => b.score - a.score)) {
      if (have.has(docOf(h)) || h.score < floor) continue;
      const counts = new Map<string, number>();
      for (const t of top) counts.set(docOf(t), (counts.get(docOf(t)) ?? 0) + 1);
      const [crowded, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (n < 2) break;
      const i = top.map(docOf).lastIndexOf(crowded);
      top[i] = h;
      have.add(docOf(h));
    }
    top = [...top].sort((a, b) => b.score - a.score);
  }
  const keys = top.map((m) => parseId(m.id)!).filter(Boolean);
  if (!keys.length) return [];
  const rows = await db.select().from(documentChunks).where(
    or(...keys.map((key) => and(eq(documentChunks.documentId, key.documentId), eq(documentChunks.idx, key.idx)))),
  ).all();
  const byKey = new Map(rows.map((r) => [vectorId(r.documentId, r.idx), r]));
  return top.flatMap((m) => {
    const r = byKey.get(m.id);
    return r ? [{ documentId: r.documentId, documentName: names.get(r.documentId) ?? "", idx: r.idx, page: r.page, text: r.text,
                  score: Math.max(0, Math.min(1, m.score)) }] : [];
  });
}

/** Every chunk of the documents, in reading order (quizzes, notes and maps read whole documents). */
export async function allChunks(db: Db, documentIds: string[]) {
  if (!documentIds.length) return [];
  const rows = await db.select().from(documentChunks).where(inArray(documentChunks.documentId, documentIds)).all();
  const order = new Map(documentIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.documentId)! - order.get(b.documentId)!) || a.idx - b.idx);
}
