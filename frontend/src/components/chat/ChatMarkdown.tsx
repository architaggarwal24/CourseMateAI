"use client";

import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

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

/** An assistant answer as markdown: headings, lists, code, tables, math. Inter 16px / 1.6 at a readable width. */
export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="chat-markdown prose prose-invert prose-base max-w-[72ch] text-fg-2
      prose-p:leading-[1.6] prose-li:leading-[1.6] prose-headings:text-fg prose-headings:font-semibold
      prose-strong:text-fg prose-a:text-ink-blue prose-code:text-fg prose-code:bg-canvas
      prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-canvas prose-pre:border prose-pre:border-line-subtle prose-pre:text-sm
      prose-th:text-fg prose-th:text-left prose-td:align-top prose-table:text-sm prose-hr:border-line-subtle">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
