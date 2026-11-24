// The kinds of file a course can hold, told apart by their name (the server checks the name when an upload begins,
// and only a PDF's bytes are stored; the others arrive as their text, read in the browser by lib/study/convert.ts).
// Shared by the browser and the Worker: what a "page" is called in each, for citations ("Deck.pptx · slide 4").
//   pdf    a page is a page                          "Bio.pdf · p.2"
//   pptx   a page is a slide                         "Cells.pptx · slide 4"
//   docx   a page is a part of about 3,000 letters  "Notes.docx · part 3"
//   xlsx   a page is a sheet (or part of a big one)  "Marks.xlsx · part 2"
//   text   .txt, .md, .csv, in parts like Word       "Summary.md · part 1"
//   image  a photo of a page, read by the AI (OCR)    "Board.jpg · photo"
export type DocFormat = "pdf" | "docx" | "pptx" | "xlsx" | "text" | "image";

const BY_EXTENSION: Record<string, DocFormat> = {
  pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "xlsx", txt: "text", md: "text", markdown: "text", csv: "text",
  jpg: "image", jpeg: "image", png: "image", webp: "image",
};

/** What the file inputs offer. */
export const DOCUMENT_ACCEPT = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp";
/** In words, for buttons and messages. */
export const DOCUMENT_KINDS = "PDF, Word, PowerPoint, Excel, text or photos";

const extension = (name: string) => (/\.([a-z0-9]+)$/i.exec(name.trim())?.[1] ?? "").toLowerCase();

/** The format a file name stands for, or null when a course can't hold it. */
export function formatOf(name: string): DocFormat | null {
  return BY_EXTENSION[extension(name)] ?? null;
}

/** Old Office files and pictures get a way forward instead of a plain "not supported". */
export function unsupportedReason(name: string): string {
  const ext = extension(name);
  if (ext === "doc") return `${name} is an old Word file. Save it as .docx (or PDF) first.`;
  if (ext === "ppt") return `${name} is an old PowerPoint file. Save it as .pptx (or PDF) first.`;
  if (ext === "xls") return `${name} is an old Excel file. Save it as .xlsx (or PDF) first.`;
  if (["heic", "heif", "gif", "bmp", "tif", "tiff"].includes(ext)) return `${name} can't be read: save the photo as JPG or PNG first.`;
  return `${name} can't be added. Use ${DOCUMENT_KINDS}.`;
}

/** Where in a document a passage is, in words ("p.2", "slide 4", "part 3"). */
export function pageWord(name: string, page: number): string {
  switch (formatOf(name)) {
    case "pptx": return `slide ${page}`;
    case "docx": case "xlsx": case "text": return `part ${page}`;
    case "image": return "photo";
    default: return `p.${page}`;
  }
}

/** A passage's place, as citations show it: "Bio.pdf · p.2", "Cells.pptx · slide 4". */
export function pageLabel(name: string, page: number | null | undefined): string {
  if (name && page) return `${name} · ${pageWord(name, page)}`;
  return name || (page ? `p.${page}` : "");
}
