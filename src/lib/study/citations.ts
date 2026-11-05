// Page-linked citations in chat answers (backend services/context_service.py `citation`).
import type { components } from "@/lib/api/generated/schema";

export type Citation = components["schemas"]["Citation"];

export const CITE_HREF = "#cite-";

/**
 * Turn the answer's [n] markers into links the markdown renderer shows as citation buttons - only numbers the
 * answer actually has a passage for, never inside code, and never a real markdown link like [text](url).
 */
export function linkCitations(markdown: string, count: number): string {
  if (!count) return markdown;
  return markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => {
    if (i % 2 === 1) return part;                                   // code: left exactly as it is
    return part.replace(/\[(\d{1,2})\](?!\()/g, (m, d) => {
      const n = Number(d);
      return n >= 1 && n <= count ? `[\\[${n}\\]](${CITE_HREF}${n})` : m;
    });
  }).join("");
}

export function citationNumber(href: string | undefined): number | null {
  if (!href?.startsWith(CITE_HREF)) return null;
  const n = Number(href.slice(CITE_HREF.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** "biology.pdf, page 4" for screen readers and titles. */
export function citationText(c: Citation): string {
  return [c.doc_name, c.page ? `page ${c.page}` : null].filter(Boolean).join(", ") || `source ${c.n}`;
}

/** The citations an answer refers to, in the order they are first cited (all of them when it cites none). */
export function citedFirst(markdown: string, citations: Citation[]): Citation[] {
  const order: number[] = [];
  for (const m of markdown.matchAll(/\[(\d{1,2})\](?!\()/g)) {
    const n = Number(m[1]);
    if (!order.includes(n) && citations.some((c) => c.n === n)) order.push(n);
  }
  if (!order.length) return citations;
  return [...order.map((n) => citations.find((c) => c.n === n)!), ...citations.filter((c) => !order.includes(c.n))];
}
