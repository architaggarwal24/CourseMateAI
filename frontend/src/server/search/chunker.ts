// Splitting a page's text into chunks to embed: the same rule as the Python backend (LangChain's
// RecursiveCharacterTextSplitter, 1000 characters with 200 of overlap, per page so a chunk never spans two pages
// and every citation names one page). Paragraphs first, then lines, then words, then characters.

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;
const SEPARATORS = ["\n\n", "\n", " ", ""];

function merge(splits: string[], sep: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let total = 0;
  const sepLen = sep.length;
  for (const s of splits) {
    const len = s.length;
    if (total + len + (current.length ? sepLen : 0) > size && current.length) {
      const doc = current.join(sep).trim();
      if (doc) out.push(doc);
      // keep the tail (up to `overlap` characters) as the start of the next chunk
      while (total > overlap || (total + len + (current.length ? sepLen : 0) > size && total > 0)) {
        total -= current[0].length + (current.length > 1 ? sepLen : 0);
        current = current.slice(1);
      }
    }
    current.push(s);
    total += len + (current.length > 1 ? sepLen : 0);
  }
  const doc = current.join(sep).trim();
  if (doc) out.push(doc);
  return out;
}

function split(text: string, separators: string[], size: number, overlap: number): string[] {
  let sep = separators[separators.length - 1];
  let rest: string[] = [];
  for (let i = 0; i < separators.length; i++) {
    const s = separators[i];
    if (s === "" || text.includes(s)) { sep = s; rest = separators.slice(i + 1); break; }
  }
  const pieces = (sep === "" ? [...text] : text.split(sep)).filter((p) => p !== "");
  const out: string[] = [];
  let good: string[] = [];
  for (const p of pieces) {
    if (p.length < size) { good.push(p); continue; }
    if (good.length) { out.push(...merge(good, sep, size, overlap)); good = []; }
    if (!rest.length) out.push(p);
    else out.push(...split(p, rest, size, overlap));
  }
  if (good.length) out.push(...merge(good, sep, size, overlap));
  return out;
}

/** The chunks of one page's text (empty for a page with no text). */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  return split(clean, SEPARATORS, size, overlap).map((c) => c.trim()).filter(Boolean);
}
