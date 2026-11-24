// Word, PowerPoint, Excel and text files, read in the browser (Files stage 2). Only their text goes to the server,
// in the same pages a PDF's text goes in (lib/study/upload.ts), so the Worker never parses them and stays small.
// Office files are zip archives of XML: a small zip reader here (the browser's own DecompressionStream does the
// inflating, so no library) and DOMParser read them.
//   .docx  word/document.xml: paragraphs (headings marked "#"), table rows as "a | b | c"; parts of ~3,000 letters
//   .pptx  ppt/slides/slideN.xml in slide order, each slide one page, with its speaker notes
//   .xlsx  each sheet one page ("Sheet: Marks", then its rows as "a | b | c"); a big sheet is split into parts
//   .txt .md .csv  as written, in parts
// Guards: a file over 50 MB is refused before this; an archive may not inflate past 60 MB (a "zip bomb"), and
// reading stops at MAX_PAGES pages.
import { ApiError } from "@/lib/api/errors";
import { formatOf, type DocFormat } from "./formats";

export const PART_CHARS = 3000;
const MAX_INFLATED = 60 * 1024 * 1024;
const MAX_PAGES = 3000;

export interface ReadText { pageCount: number; pages: { page: number; text: string }[]; textChars: number }

const unreadable = (name: string) =>
  new ApiError(400, { code: "invalid_file", message: `${name} couldn't be read. Open it, save it again, and try once more (or save it as a PDF).`, action: "reupload", details: null });

// ── zip ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Entry { name: string; method: number; compressed: number; size: number; offset: number }

/** The files in a zip archive (from its central directory). */
export function zipEntries(buf: ArrayBuffer): Map<string, Entry> {
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const total = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const names = new TextDecoder();
  const out = new Map<string, Entry>();
  for (let n = 0; n < total && n < 20_000; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = names.decode(new Uint8Array(buf, at + 46, nameLen));
    out.set(name, { name, method, compressed, size, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One file out of the archive, as text. `budget` counts what has been inflated, across the whole archive. */
async function zipText(buf: ArrayBuffer, e: Entry, budget: { left: number }): Promise<string> {
  const view = new DataView(buf);
  if (view.getUint32(e.offset, true) !== 0x04034b50) throw new Error("bad zip entry");
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const data = new Uint8Array(buf, start, e.compressed);
  let bytes: Uint8Array;
  if (e.method === 0) bytes = data;
  else if (e.method === 8) {
    const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } });
    const stream = source.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got += value.byteLength;
      budget.left -= value.byteLength;
      if (budget.left < 0) { await reader.cancel(); throw new Error("archive too large"); }
      chunks.push(value);
    }
    bytes = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  } else throw new Error(`zip method ${e.method}`);
  return new TextDecoder().decode(bytes);
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
/** Elements by their local name, whatever their namespace prefix ("w:p", "a:t" ...). */
const all = (root: Document | Element, local: string) => Array.from(root.getElementsByTagNameNS("*", local));
const tidy = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Text in parts of about PART_CHARS letters, cut between paragraphs (a heading starts a new part when it can). */
export function intoParts(paragraphs: string[], size = PART_CHARS): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const raw of paragraphs) {
    const p = raw.trim();
    if (!p) continue;
    const heading = p.startsWith("#");
    if (cur && (cur.length + p.length + 1 > size || (heading && cur.length > size / 3))) { parts.push(cur); cur = ""; }
    if (p.length > size) {                                   // one huge paragraph: cut into pieces of `size`
      for (let i = 0; i < p.length; i += size) parts.push(p.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur) parts.push(cur);
  return parts;
}

// ── Word ───────────────────────────────────────────────────────────────────────────────────────────────────────
function paragraphText(p: Element): string {
  let out = "";
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.localName === "t") out += c.textContent ?? "";
      else if (c.localName === "tab") out += "\t";
      else if (c.localName === "br" || c.localName === "cr") out += "\n";
      else if (c.localName !== "pPr" && c.localName !== "rPr") walk(c);
    }
  };
  walk(p);
  const styleEl = all(p, "pStyle")[0];
  const style = styleEl ? Array.from(styleEl.attributes).find((a) => a.localName === "val")?.value ?? "" : "";
  return /^(heading|title)/i.test(style) && out.trim() ? `# ${out.trim()}` : out;
}

export function docxParagraphs(documentXml: string): string[] {
  const body = all(xml(documentXml), "body")[0];
  if (!body) return [];
  const out: string[] = [];
  for (const block of Array.from(body.children)) {
    if (block.localName === "p") out.push(paragraphText(block));
    else if (block.localName === "tbl") {
      for (const row of all(block, "tr")) {
        out.push(all(row, "tc").map((cell) => all(cell, "p").map(paragraphText).join(" ").trim()).join(" | "));
      }
    } else if (block.localName === "sdt") {
      for (const p of all(block, "p")) out.push(paragraphText(p));
    }
  }
  return out.map(tidy).filter(Boolean);
}

// ── PowerPoint ─────────────────────────────────────────────────────────────────────────────────────────────────
export function slideText(slideXml: string): string {
  return all(xml(slideXml), "p").map((p) => all(p, "t").map((t) => t.textContent ?? "").join("")).map(tidy).filter(Boolean).join("\n");
}

/** Where a part of the archive points ("../notesSlides/notesSlide3.xml" from ppt/slides/ → ppt/notesSlides/...). */
function resolve(from: string, target: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relTargets(relsXml: string): { type: string; target: string; id: string }[] {
  return all(xml(relsXml), "Relationship").map((r) => ({ type: r.getAttribute("Type") ?? "", target: r.getAttribute("Target") ?? "", id: r.getAttribute("Id") ?? "" }));
}

// ── Excel ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function sharedStrings(stringsXml: string): string[] {
  return all(xml(stringsXml), "si").map((si) => all(si, "t").map((t) => t.textContent ?? "").join(""));
}

export function sheetRows(sheetXml: string, strings: string[]): string[] {
  return all(xml(sheetXml), "row").map((row) => all(row, "c").map((c) => {
    const type = c.getAttribute("t");
    if (type === "inlineStr") return all(c, "t").map((t) => t.textContent ?? "").join("");
    const v = all(c, "v")[0]?.textContent ?? "";
    if (type === "s") return strings[Number(v)] ?? "";
    if (type === "b") return v === "1" ? "TRUE" : v === "0" ? "FALSE" : v;
    return v;
  }).map((x) => x.trim()).join(" | ").replace(/( \| )+$/, "").trim()).filter((r) => r.replace(/[|\s]/g, ""));
}

// ── reading a file ─────────────────────────────────────────────────────────────────────────────────────────────
function pagesOf(texts: string[]): ReadText {
  const pages = texts.slice(0, MAX_PAGES).map((text, i) => ({ page: i + 1, text }));
  return { pageCount: pages.length, pages, textChars: pages.reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0) };
}

async function readOffice(buf: ArrayBuffer, format: Exclude<DocFormat, "pdf" | "text">): Promise<string[]> {
  const entries = zipEntries(buf);
  const budget = { left: MAX_INFLATED };
  const text = async (name: string) => {
    const e = entries.get(name);
    return e ? zipText(buf, e, budget) : null;
  };
  if (format === "docx") {
    const doc = await text("word/document.xml");
    if (doc === null) throw new Error("no document.xml");
    return intoParts(docxParagraphs(doc));
  }
  if (format === "pptx") {
    const slides = [...entries.keys()].map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n)).filter(Boolean)
      .sort((a, b) => Number(a![1]) - Number(b![1])).map((m) => m![0]);
    const out: string[] = [];
    for (const [i, name] of slides.entries()) {
      const body = slideText((await text(name)) ?? "");
      const rels = await text(name.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels");
      const notesTarget = rels ? relTargets(rels).find((r) => r.type.endsWith("/notesSlide")) : undefined;
      const notesXml = notesTarget ? await text(resolve(name, notesTarget.target)) : null;
      const notes = notesXml ? slideText(notesXml).split("\n").filter((l) => !/^\d+$/.test(l)).join("\n") : "";
      out.push([`Slide ${i + 1}`, body, notes ? `Speaker notes: ${notes}` : ""].filter(Boolean).join("\n"));
    }
    return out;
  }
  // xlsx
  const workbook = await text("xl/workbook.xml");
  if (workbook === null) throw new Error("no workbook.xml");
  const rels = relTargets((await text("xl/_rels/workbook.xml.rels")) ?? "");
  const strings = sharedStrings((await text("xl/sharedStrings.xml")) ?? "");
  const out: string[] = [];
  for (const sheet of all(xml(workbook), "sheet")) {
    const name = sheet.getAttribute("name") ?? "Sheet";
    const rid = sheet.getAttribute("r:id") ?? Array.from(sheet.attributes).find((a) => a.localName === "id")?.value ?? "";
    const target = rels.find((r) => r.id === rid)?.target;
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : resolve("xl/workbook.xml", target);
    const rows = sheetRows((await text(path)) ?? "", strings);
    if (!rows.length) continue;
    const parts = intoParts(rows, PART_CHARS * 2);
    parts.forEach((p, i) => out.push(`Sheet: ${name}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}\n${p}`));
  }
  return out;
}

/** A course file that isn't a PDF, as pages of text. Throws an ApiError the upload shows ("invalid_file", "no_text"). */
export async function readOtherDocument(file: File, buf: ArrayBuffer): Promise<ReadText> {
  const format = formatOf(file.name);
  if (!format || format === "pdf") throw unreadable(file.name);
  let texts: string[];
  try {
    texts = format === "text"
      ? intoParts(new TextDecoder().decode(buf).replace(/\r\n?/g, "\n").split(/\n(?=\s*\n)|\n(?=#)/).map((p) => p.trim()))
      : await readOffice(buf, format);
  } catch {
    throw unreadable(file.name);
  }
  const read = pagesOf(texts);
  if (read.textChars < 20) {
    throw new ApiError(400, { code: "no_text", message: `No text was found in ${file.name}.`, action: "reupload", details: null });
  }
  return read;
}
