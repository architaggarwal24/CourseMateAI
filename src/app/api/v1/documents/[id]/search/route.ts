// The passages a question would be answered from (the chat uses the same search, Stage 4.3).
import { requireUser } from "@/server/context";
import { courseMembers, getDocumentOrCourse } from "@/server/study/documents";
import { HttpError, rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { searchDeps, searchPassages } from "@/server/search";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `search:${u.id}`, 60, 60);
  const deps = searchDeps(ctx.env);
  if (!deps) throw new HttpError(503, "search_unavailable", "Search isn't set up on this server yet (Workers AI and Vectorize).", "retry");
  const q = new URL(req.url).searchParams;
  const question = (q.get("q") ?? "").slice(0, 1000);
  const k = Math.min(10, Math.max(1, Number(q.get("k") ?? 5) || 5));
  const doc = await getDocumentOrCourse(ctx, u, id);
  const docs = "kind" in doc && doc.kind === "course"
    ? (await courseMembers(ctx, id)).filter((m) => m.status === "ready").map((m) => ({ id: m.id, name: m.filename }))
    : doc.status === "ready" ? [{ id: doc.id, name: doc.filename }] : [];
  if (!docs.length) throw new HttpError(409, "document_not_ready", "This document isn't ready yet.");
  const passages = await searchPassages(ctx.db, deps, docs, question, k);
  return { passages: passages.map((p) => ({ document_id: p.documentId, document: p.documentName, page: p.page, chunk: p.idx, score: p.score, text: p.text })) };
});
