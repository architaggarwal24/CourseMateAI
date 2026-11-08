import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Count how often the markdown is parsed (react-markdown runs remark, KaTeX and highlighting on every render).
const parses = vi.hoisted(() => ({ n: 0 }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => { parses.n += 1; return <p>{children}</p>; } }));

import ChatMarkdown from "./ChatMarkdown";

// Performance pass (Stage P4): while an answer streams, the chat re-renders on every token; each earlier answer was
// parsed again each time (remark + KaTeX + highlight), so a long conversation got slower with every word.
describe("ChatMarkdown re-renders", () => {
  it("an answer whose text has not changed is not parsed again, even with a new onCite function", () => {
    const view = render(<ChatMarkdown citations={2} onCite={() => {}}>Mitochondria make ATP [1].</ChatMarkdown>);
    expect(parses.n).toBe(1);
    view.rerender(<ChatMarkdown citations={2} onCite={() => {}}>Mitochondria make ATP [1].</ChatMarkdown>);
    expect(parses.n).toBe(1);
    view.rerender(<ChatMarkdown citations={2} onCite={() => {}}>Mitochondria make ATP [1]. More</ChatMarkdown>);
    expect(parses.n).toBe(2);
    view.rerender(<ChatMarkdown citations={3} onCite={() => {}}>Mitochondria make ATP [1]. More</ChatMarkdown>);
    expect(parses.n).toBe(3);
  });
});
