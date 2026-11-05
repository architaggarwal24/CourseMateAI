// Concept maps (Stage 4.4; port of backend/services/concept_map_service.py + core_brains/concept_brain.py).
//   build   ONE AI pass per document content (file hash) and extractor VERSION, reused by every course with that
//           PDF. POST /concept-map does the work inside the request (a Worker can't run on after it answers for
//           long enough), writing its progress line to D1 as it goes; the page polls GET for that line meanwhile.
//           A build holds a lease: one that died (the tab closed) shows as "stalled" once the lease runs out, and
//           can be started again.
//   view    the map of a document, or of a course (its documents' maps merged by concept name), every concept
//           coloured by mastery heat: new / weak / learning / strong.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "../context";
import { conceptMaps, conceptMastery, documents, type documentChunks } from "../db/schema";
import { courseMembers, getDocumentOrCourse } from "../documents";
import { HttpError } from "../http";
import { requireFeature, tierFor } from "../plans";
import { allChunks } from "../search";
import { callerFor } from "../chat";
import type { Caller } from "../ai/run";
import { generateData } from "./core";
import { heat } from "./mastery";
import { MAP_SYSTEM, conceptMapPrompt } from "./prompts";
import { BadAnswer, conceptMapDraft, MAX_MAP_CONCEPTS, MAX_MAP_RELATIONS } from "./schemas";
import { questionKey } from "./text";

export const VERSION = 1;
export const FAILED_TEXT = "The concept map couldn't be made this time. Try again - a faster (non-reasoning) model helps.";
const DIGEST_CHARS = 14_000;
const PASSAGE_CHARS = 700;
const CALL_TIMEOUT_MS = 150_000;
const LEASE_MS = 2 * CALL_TIMEOUT_MS + 60_000;

type Chunk = typeof documentChunks.$inferSelect;
type DocRow = typeof documents.$inferSelect;
const now = () => new Date().toISOString();

export async function gate(ctx: RequestContext, user: CurrentUser) {
  requireFeature(await tierFor(ctx.db, user), "concept_map");
}

/** Passages spread evenly over the document (start, middle and end), each led by its page. */
export function digest(chunks: { page: number; text: string }[], maxChars = DIGEST_CHARS): string {
  const usable = chunks.filter((c) => c.text.trim());
  if (!usable.length) return "";
  const n = Math.max(1, Math.min(usable.length, Math.floor(maxChars / (PASSAGE_CHARS + 12))));
  const step = usable.length / n;
  return Array.from({ length: n }, (_, i) => usable[Math.floor(i * step)])
    .map((c) => `[p.${c.page || "?"}] ${c.text.split(/\s+/).filter(Boolean).join(" ").slice(0, PASSAGE_CHARS)}`)
    .join("\n\n").slice(0, maxChars);
}

const fatal = (e: unknown) => e instanceof HttpError && ["plan_limit", "ai_not_configured", "feature_locked"].includes(e.code);

/** {concepts, relations} for a document's chunks: a timeout or unusable answer is retried once with half the digest. */
export async function extract(ctx: RequestContext, caller: Caller, chunks: Chunk[], onStage: (s: string) => Promise<void>) {
  const pages = new Set(chunks.map((c) => c.page)).size;
  let last: unknown;
  for (const [attempt, size] of [DIGEST_CHARS, DIGEST_CHARS / 2].entries()) {
    const text = digest(chunks, size);
    if (!text) throw new BadAnswer("no readable text");
    await onStage(attempt === 0 ? `Reading ${pages} page${pages === 1 ? "" : "s"}…` : "That took too long - trying again with a shorter summary…");
    await onStage("Mapping the concepts and how they connect…");
    try {
      return await generateData(ctx, caller, "strong", [
        { role: "system", content: MAP_SYSTEM },
        { role: "user", content: conceptMapPrompt({ digest: text, min: attempt === 0 ? 8 : 6, max: MAX_MAP_CONCEPTS, relations: MAX_MAP_RELATIONS }) },
      ], conceptMapDraft, { temperature: 0.3, timeoutMs: CALL_TIMEOUT_MS, maxOutputTokens: 6000, attempts: 1 });
    } catch (e) {
      last = e;
      console.warn(`[coursemate] concept map attempt ${attempt + 1} failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      if (fatal(e)) break;
    }
  }
  throw last ?? new Error("concept map failed");
}

// ── scope ────────────────────────────────────────────────────────────────────────────────────────────────────
async function scope(ctx: RequestContext, user: CurrentUser, id: string) {
  const view = await getDocumentOrCourse(ctx, user, id);                 // ownership (and the courses gate)
  if ((view as { kind?: string }).kind === "course") {
    const members = await courseMembers(ctx, id);
    return { kind: "course" as const, name: (view as { filename: string }).filename, docs: members, hashes: [...members.map((m) => m.fileHash), `course:${id}`] };
  }
  const row = (await ctx.db.select().from(documents).where(eq(documents.id, id)).get())!;
  return { kind: "document" as const, name: row.filename, docs: [{ ...row, status: (view as { status: DocRow["status"] }).status }], hashes: [row.fileHash] };
}

const mapRow = (ctx: RequestContext, hash: string) =>
  ctx.db.select().from(conceptMaps).where(and(eq(conceptMaps.docHash, hash), eq(conceptMaps.version, VERSION))).get();

const setRow = (ctx: RequestContext, hash: string, fields: Partial<typeof conceptMaps.$inferInsert>) =>
  ctx.db.update(conceptMaps).set({ ...fields, updatedAt: now() }).where(and(eq(conceptMaps.docHash, hash), eq(conceptMaps.version, VERSION)));

const live = (r: { status: string; leaseUntil: string | null }) => (r.status === "queued" || r.status === "running") && !!r.leaseUntil && r.leaseUntil > now();

// ── building ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Map every ready document in the scope that has none (or whose last try failed or died). Returns the view. */
export async function build(ctx: RequestContext, user: CurrentUser, id: string) {
  const s = await scope(ctx, user, id);
  const todo: DocRow[] = [];
  for (const d of s.docs) {
    if (d.status !== "ready") continue;
    const r = await mapRow(ctx, d.fileHash);
    if (r && (r.status === "ready" || live(r))) continue;
    const t = now();
    const lease = new Date(Date.now() + LEASE_MS).toISOString();
    // claim it: only one request builds a given map
    const claimed = await ctx.db.insert(conceptMaps).values({ docHash: d.fileHash, version: VERSION, status: "queued", stage: "Waiting to start…", leaseUntil: lease, createdAt: t, updatedAt: t })
      .onConflictDoUpdate({
        target: [conceptMaps.docHash, conceptMaps.version],
        set: { status: "queued", stage: "Waiting to start…", error: null, leaseUntil: lease, updatedAt: t },
        setWhere: sql`${conceptMaps.status} = 'failed' OR ${conceptMaps.leaseUntil} IS NULL OR ${conceptMaps.leaseUntil} <= ${t}`,
      }).returning({ h: conceptMaps.docHash }).all();
    if (claimed.length) todo.push(d);
  }
  if (todo.length) {
    const caller = await callerFor(ctx, user);
    await Promise.all(todo.map(async (d) => {
      const stage = (text: string) => setRow(ctx, d.fileHash, { status: "running", stage: text }).then(() => undefined);
      try {
        await stage("Reading the document…");
        const chunks = await allChunks(ctx.db, [d.id]);
        const data = await extract(ctx, caller, chunks, stage);
        await setRow(ctx, d.fileHash, { status: "ready", stage: null, error: null, dataJson: JSON.stringify(data), leaseUntil: null });
      } catch (e) {
        console.warn(`[coursemate] concept map failed for ${d.fileHash.slice(0, 12)}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
        await setRow(ctx, d.fileHash, { status: "failed", stage: null, error: FAILED_TEXT, leaseUntil: null });
      }
    }));
  }
  return view(ctx, user, id);
}

// ── viewing ──────────────────────────────────────────────────────────────────────────────────────────────────
interface Concept { id: string; name: string; summary: string; importance: number; pages: { doc_id: string; page: number }[]; docs: string[]; seen?: number; correct?: number; heat?: string }

export async function view(ctx: RequestContext, user: CurrentUser, id: string) {
  const s = await scope(ctx, user, id);
  const docs: { id: string; name: string; status: string; stage: string | null; error: string | null }[] = [];
  const concepts = new Map<string, Concept>();
  const relations = new Map<string, { source: string; target: string; label: string }>();
  for (const d of s.docs) {
    const r = d.status === "ready" ? await mapRow(ctx, d.fileHash) : undefined;
    let status = r ? r.status : d.status === "ready" ? "none" : "not_ready";
    if (r && (r.status === "queued" || r.status === "running") && !live(r)) status = "stalled";
    docs.push({ id: d.id, name: d.filename, status, stage: r?.stage ?? null, error: r?.error ?? null });
    if (!r || r.status !== "ready") continue;
    const data = JSON.parse(r.dataJson || "{}") as ReturnType<typeof conceptMapDraft>;
    for (const c of data.concepts ?? []) {
      const key = questionKey(c.name);
      const into = concepts.get(key) ?? { id: key, name: c.name, summary: c.summary || "", importance: 0, pages: [], docs: [] };
      into.importance = Math.max(into.importance, Number(c.importance) || 2);
      if (!into.summary && c.summary) into.summary = c.summary;
      if (!into.docs.includes(d.id)) into.docs.push(d.id);
      if (c.page) into.pages.push({ doc_id: d.id, page: Number(c.page) });
      concepts.set(key, into);
    }
    for (const rel of data.relations ?? []) {
      const a = questionKey(rel.source), b = questionKey(rel.target);
      if (concepts.has(a) && concepts.has(b) && !relations.has(`${a}|${b}`) && !relations.has(`${b}|${a}`)) {
        relations.set(`${a}|${b}`, { source: a, target: b, label: rel.label || "" });
      }
    }
  }
  await addHeat(ctx, user.id, s.hashes, concepts);
  const built = docs.filter((d) => d.status === "ready").length;
  const buildable = docs.filter((d) => d.status !== "not_ready");
  let status: string;
  if (!buildable.length) status = "not_ready";
  else if (built === buildable.length) status = "ready";
  else if (buildable.some((d) => d.status === "queued" || d.status === "running")) status = "building";
  else if (buildable.some((d) => d.status === "failed")) status = built ? "partial" : "failed";
  else status = built ? "partial" : "none";
  const stage = docs.find((d) => (d.status === "queued" || d.status === "running") && d.stage)?.stage ?? null;
  return {
    scope: { id, kind: s.kind, name: s.name }, status, stage, built, total: buildable.length, documents: docs,
    concepts: [...concepts.values()].sort((a, b) => b.importance - a.importance || a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    relations: [...relations.values()],
  };
}

async function addHeat(ctx: RequestContext, userId: number, hashes: string[], concepts: Map<string, Concept>) {
  const rows = hashes.length ? await ctx.db.select({
    key: conceptMastery.conceptKey, seen: sql<number>`SUM(${conceptMastery.seen})`, correct: sql<number>`SUM(${conceptMastery.correct})`,
    streak: sql<number>`MAX(${conceptMastery.wrongStreak})`,
  }).from(conceptMastery).where(and(eq(conceptMastery.userId, userId), inArray(conceptMastery.docHash, hashes))).groupBy(conceptMastery.conceptKey).all() : [];
  for (const [key, c] of concepts) {
    const hits = rows.filter((r) => r.key === key || (key.length >= 4 && r.key.length >= 4 && (r.key.includes(key) || key.includes(r.key))));
    const seen = hits.reduce((a, r) => a + Number(r.seen), 0);
    const correct = hits.reduce((a, r) => a + Number(r.correct), 0);
    const streak = Math.max(0, ...hits.map((r) => Number(r.streak)));
    Object.assign(c, { seen, correct, heat: heat(seen, correct, streak) });
  }
}
