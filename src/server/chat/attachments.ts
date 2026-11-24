// Files attached to one tutor question (Files stage 3; the browser side is lib/chat/attachments.ts). Pictures go to
// a model that can see them; documents and pasted text arrive as their text and are fenced as material (prompt-
// injection guard), like the course passages. Nothing is stored: they are for this question only.
import { HttpError } from "../http";

export const MAX_ATTACHMENTS = 5;
export const MAX_TEXT_CHARS = 40_000;
export const MAX_TOTAL_TEXT_CHARS = 120_000;
/** Base64 of a picture shrunk to 1,600 px is well under 2 MB; this allows for a large PNG kept as it is. */
export const MAX_IMAGE_BASE64 = 4_000_000;
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ImageIn { name: string; mime: string; data: string }
export interface TextIn { name: string; text: string }
export interface Attached { images: ImageIn[]; texts: TextIn[] }

const bad = (message: string) => new HttpError(400, "invalid_input", message, null, { field: "attachments" });
const cleanName = (v: unknown, fallback: string) =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f⟦⟧]/g, "").replace(/[\\/]/g, " ").trim().slice(0, 120) || fallback;

/** The attachments of a chat request, checked; none is an empty set. */
export function readAttachments(raw: unknown): Attached {
  if (raw === undefined || raw === null) return { images: [], texts: [] };
  if (!Array.isArray(raw)) throw bad("Attachments must be a list.");
  if (raw.length > MAX_ATTACHMENTS) throw bad(`A question takes up to ${MAX_ATTACHMENTS} files.`);
  const out: Attached = { images: [], texts: [] };
  let total = 0;
  for (const a of raw) {
    const item = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    if (item.kind === "image") {
      const mime = String(item.mime ?? "");
      const data = typeof item.data === "string" ? item.data : "";
      if (!(IMAGE_MIMES as readonly string[]).includes(mime)) throw bad("Pictures must be JPG, PNG or WebP.");
      if (!data || data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw bad("A picture is too large or unreadable. Attach a smaller one.");
      out.images.push({ name: cleanName(item.name, "Picture"), mime, data });
    } else if (item.kind === "text") {
      const text = typeof item.text === "string" ? item.text : "";
      if (!text.trim()) throw bad("An attached file has no text.");
      if (text.length > MAX_TEXT_CHARS) throw bad(`An attached file is over ${MAX_TEXT_CHARS.toLocaleString("en-IN")} characters.`);
      total += text.length;
      if (total > MAX_TOTAL_TEXT_CHARS) throw bad("The attached files are too long together. Attach fewer.");
      out.texts.push({ name: cleanName(item.name, "Attached text"), text });
    } else {
      throw bad("Attach pictures or documents.");
    }
  }
  return out;
}

export const hasAttachments = (a: Attached) => a.images.length + a.texts.length > 0;
/** For the history log: "notes.docx, photo.jpg". */
export const attachmentNames = (a: Attached) => [...a.texts, ...a.images].map((x) => x.name).join(", ");
