"use client";

import { useMemo, useRef, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { citationNumber, linkCitations } from "@/lib/study/citations";

// Tables scroll sideways inside the message instead of stretching it; links open in a new tab. (Raw HTML in the
// answer is never rendered: react-markdown escapes it.)
const components: Components = {
  table: ({ node: _node, ...props }: ComponentProps<"table"> & { node?: unknown }) => (
    <div className="chat-table overflow-x-auto"><table {...props} /></div>
  ),
  a: ({ node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

/**
 * An assistant answer as markdown: headings, lists, code, tables, math. Inter 16px / 1.6 at a readable width.
 * With `citations` (how many passages the answer has), its [n] markers become buttons that call `onCite(n)`.
 */
export default function ChatMarkdown({ children, citations = 0, onCite }: {
  children: string; citations?: number; onCite?: (n: number) => void;
}) {
  const citable = !!onCite;
  const text = useMemo(() => (citable ? linkCitations(children, citations) : children), [children, citations, citable]);
  // the renderers must stay the same functions across renders (or the citation buttons are remounted and a focus
  // that should come back to one has nowhere to go): the latest onCite is read through a ref
  const cite = useRef(onCite);
  cite.current = onCite;
  const parts = useMemo<Components>(() => ({
    ...components,
    a: ({ node: _node, href, ...props }: ComponentProps<"a"> & { node?: unknown }) => {
      const n = citationNumber(href);
      if (n !== null && cite.current) {
        return (
          <button type="button" className="cite-mark" onClick={() => cite.current?.(n)} aria-label={`Source ${n}`}>{n}</button>
        );
      }
      return <a href={href} {...props} target="_blank" rel="noopener noreferrer" />;
    },
  }), []);
  return (
    <div className="chat-markdown prose prose-invert prose-base max-w-[72ch] text-fg-2
      prose-p:leading-[1.6] prose-li:leading-[1.6] prose-headings:text-fg prose-headings:font-semibold
      prose-strong:text-fg prose-a:text-ink-blue prose-code:text-fg prose-code:bg-canvas
      prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-canvas prose-pre:border prose-pre:border-line-subtle prose-pre:text-sm
      prose-th:text-fg prose-th:text-left prose-td:align-top prose-table:text-sm prose-hr:border-line-subtle">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} components={parts}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
