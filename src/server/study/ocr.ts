// Scanned pages and photos read by the AI (Files stage 4). A scanned PDF (no text layer) or a photo of a textbook page
// becomes a course document like any other: the browser renders each page to a JPEG (lib/study/upload.ts) and sends it
// here one page at a time; a model that can see writes out its text, and the text is indexed like a PDF page.
//   caps    pages a day per plan (OCR_PAGES_DAY in ocr-limits.ts), taken one at a time before the model is asked (atomically, like
//           the AI calls), given back when no model managed it; the owner has none
//   money   each page is an AI call through ai/run.ts, so the budgets and the spend cap hold (a picture's worst case
//           counts IMAGE_TOKENS); OCR pages don't use the plan's AI calls
//   model   the "small" job: the cheapest model that can see (the free Workers AI one can't, so it's skipped)
import type { CurrentUser, RequestContext } from "../context";
import { HttpError } from "../http";
import { generate } from "../ai/run";
import { tierFor } from "../account/plans";
import { releaseOcrPage, reserveOcrPage } from "./ocr-limits";
import { IMAGE_MIMES, MAX_IMAGE_BASE64 } from "../chat/attachments";
import { addPages, ownedDocument } from "./documents";
import type { SearchDeps } from "../search";

export const NO_TEXT_MARK = "NO_TEXT";
const OCR_PROMPT = `You turn a photo or scan of a study page into text. Write out ALL readable text on the page exactly as written,
in reading order: headings on their own lines, lists as lists, table rows with cells separated by " | ", equations
as plain text (or LaTeX). Add nothing of your own: no comments, no summary, no translation. If the page has no
readable text, reply with exactly: ${NO_TEXT_MARK}`;

/** POST /documents/{id}/ocr {page, mime, data, done}: read one page image and index its text. */
export async function ocrPage(ctx: RequestContext, deps: SearchDeps, user: CurrentUser, id: string, body: Record<string, unknown>) {
  const row = await ownedDocument(ctx, user, id);
  if (row.status !== "reading" && row.status !== "indexing") {
    throw new HttpError(409, "upload_state", "This upload isn't in progress. Upload the file again.", "reupload");
  }
  const page = Number(body.page);
  if (!Number.isInteger(page) || page < 1 || page > row.pages) throw new HttpError(400, "invalid_input", "A page number is out of range.");
  const mime = String(body.mime ?? "");
  const data = typeof body.data === "string" ? body.data : "";
  if (!(IMAGE_MIMES as readonly string[]).includes(mime) || !data || data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new HttpError(400, "invalid_input", "That page image is too large or unreadable.", null, { field: "data" });
  }
  const caller = { id: user.id, owner: user.owner, admin: user.admin, tier: await tierFor(ctx.db, user) };
  const reserved = await reserveOcrPage(ctx.db, caller);
  let text: string;
  try {
    const answer = await generate(ctx, caller, "small", [
      { role: "system", content: OCR_PROMPT },
      { role: "user", content: `Page ${page} of "${row.filename}". Write out its text.`, images: [{ mime, data }] },
    ], { maxOutputTokens: 2048, temperature: 0, timeoutMs: 60_000 }, { countCall: false });
    text = answer.text.trim() === NO_TEXT_MARK ? "" : answer.text.trim();
  } catch (e) {
    if (reserved) await releaseOcrPage(ctx.db, user.id).catch(() => {});     // not read: the page isn't spent
    throw e;
  }
  return addPages(ctx, deps, user, id, { pages: [{ page, text }], done: body.done === true });
}
