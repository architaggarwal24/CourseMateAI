// Files attached to one tutor question (Files stage 3), like attaching to a Claude message: pictures, documents
// and long pasted text, shown as cards above the chat box and sent with the next question only. Nothing here is saved
// to the course; "Add to course" under the answer does that for documents, on purpose.
//   pictures   shrunk in the browser to at most 1,600 px (JPEG) before sending: cheaper, faster, still readable
//   documents  PDF, Word, PowerPoint, Excel, text: read in the browser (lib/study/upload.ts) and sent as their text
//   pasted     text pasted into the chat box past PASTE_CARD_CHARS becomes a "Pasted text" card
// Limits: MAX_ATTACHMENTS a question, MAX_ATTACHMENT_BYTES a file; a document's text is cut at MAX_TEXT_CHARS.
import { formatOf, unsupportedReason } from "@/lib/study/formats";
import { shrinkImage } from "@/lib/study/images";
export { setImageShrinkForTests } from "@/lib/study/images";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40_000;
export const PASTE_CARD_CHARS = 1500;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** What the chat's file picker offers. */
export const ATTACH_ACCEPT = "image/jpeg,image/png,image/webp,.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv";

export interface ImageAttachment { id: string; kind: "image"; name: string; mime: string; data: string; preview: string; file: File }
export interface TextAttachment { id: string; kind: "text"; name: string; text: string; cut: boolean; file: File; pasted?: boolean }
export type Attachment = ImageAttachment | TextAttachment;

/** What goes to the server with the question (no previews, no File objects). */
export type AttachmentPayload = { kind: "image"; name: string; mime: string; data: string } | { kind: "text"; name: string; text: string };

export class AttachmentError extends Error {}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

export const isImage = (file: File) => (IMAGE_TYPES as readonly string[]).includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);

/** A document's pages as one text, with page markers, cut at MAX_TEXT_CHARS. */
export async function documentText(file: File): Promise<{ text: string; cut: boolean }> {
  const { readDocument } = await import("@/lib/study/upload");
  const read = await readDocument(file);
  if (read.ocr?.length && read.textChars < 20) {
    throw new AttachmentError(`${file.name} is a scan with no text layer. Attach a photo of the page instead, or add it to a course to have it read.`);
  }
  const word = formatOf(file.name) === "pptx" ? "Slide" : formatOf(file.name) === "pdf" ? "Page" : "Part";
  const full = read.pages.map((p) => (read.pages.length > 1 && !p.text.startsWith("Slide ") ? `[${word} ${p.page}]\n${p.text}` : p.text)).join("\n\n");
  return full.length > MAX_TEXT_CHARS ? { text: full.slice(0, MAX_TEXT_CHARS), cut: true } : { text: full, cut: false };
}

/** One picked, dropped or pasted file, ready to attach. Throws AttachmentError with a message for the student. */
export async function prepareFile(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`${file.name} is over 10 MB. Attach a smaller file.`);
  if (isImage(file)) {
    try {
      return { id: newId(), kind: "image", name: file.name || "Picture", file, ...(await shrinkImage(file)) };
    } catch (e) {
      throw e instanceof AttachmentError ? e : new AttachmentError(`${file.name || "That picture"} couldn't be read as a picture.`);
    }
  }
  if (!formatOf(file.name)) {
    throw new AttachmentError(file.type.startsWith("image/") || /\.(gif|heic|heif|bmp|tiff?)$/i.test(file.name)
      ? `${file.name} can't be attached: use a JPG, PNG or WebP picture.` : unsupportedReason(file.name));
  }
  let read: { text: string; cut: boolean };
  try {
    read = await documentText(file);
  } catch (e) {
    throw new AttachmentError((e as Error)?.message || `${file.name} couldn't be read.`);
  }
  return { id: newId(), kind: "text", name: file.name, text: read.text, cut: read.cut, file };
}

/** prepareFile without throwing: the card, or what to tell the student (our own words; never a raw error). */
export async function tryPrepareFile(file: File): Promise<{ ok: true; item: Attachment } | { ok: false; message: string }> {
  try {
    return { ok: true, item: await prepareFile(file) };
  } catch (e) {
    return { ok: false, message: e instanceof AttachmentError ? e.message : `${file.name} couldn't be attached.` };
  }
}

/** Long text pasted into the chat box, as a card ("Pasted text 2"). */
export function pastedText(text: string, n: number): TextAttachment {
  const name = n > 1 ? `Pasted text ${n}` : "Pasted text";
  const cut = text.length > MAX_TEXT_CHARS;
  const body = cut ? text.slice(0, MAX_TEXT_CHARS) : text;
  return { id: newId(), kind: "text", name, text: body, cut, pasted: true, file: new File([body], `${name}.txt`, { type: "text/plain" }) };
}

export function toPayload(items: Attachment[]): AttachmentPayload[] {
  return items.map((a) => (a.kind === "image" ? { kind: "image", name: a.name, mime: a.mime, data: a.data } : { kind: "text", name: a.name, text: a.text }));
}
