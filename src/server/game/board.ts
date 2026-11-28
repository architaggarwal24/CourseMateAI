// Which players share a document leaderboard (security audit run 2).
//
// A document's file_hash comes from the browser. For a PDF the server checks it against the uploaded bytes
// (pdf_stored is set only then); for Word, PowerPoint, Excel, text and images it is never checked, so anyone could
// claim another document's hash. Document boards are therefore shared only through a checked hash: an unchecked one
// is kept to its owner ("u<userId>:<hash>"), and a course's hash ("course:<id>") already belongs to one person.
// Mastery, missed questions and the review queue keep using the plain hash: they are always filtered by user too.
import { and, eq } from "drizzle-orm";
import { documents } from "../db/schema";
import type { RequestContext } from "../context";

export async function boardHash(ctx: RequestContext, userId: number, sessionId: string, docHash: string): Promise<string> {
  if (docHash.startsWith("course:") || docHash.startsWith("u")) return docHash;
  const row = await ctx.db.select({ checked: documents.pdfStored }).from(documents)
    .where(and(eq(documents.id, sessionId), eq(documents.userId, userId))).get();
  return row?.checked ? docHash : `u${userId}:${docHash}`;
}
