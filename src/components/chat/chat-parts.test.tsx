import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ChatMarkdown from "./ChatMarkdown";
import NotFoundCard, { rephraseSuggestion } from "./NotFoundCard";
import SourceChips from "./SourceChips";

afterEach(cleanup);

const ANSWER = [
  "# Cell energy",
  "## ATP",
  "ATP is the **energy currency** of the cell.",
  "",
  "- glycolysis",
  "- the Krebs cycle",
  "",
  "```python",
  "print('atp')",
  "```",
  "",
  "| Stage | Yield |",
  "| --- | --- |",
  "| Glycolysis | 2 ATP |",
  "",
  "<script>window.hacked = true</script><b>raw</b>",
].join("\n");

describe("ChatMarkdown", () => {
  it("renders headings, emphasis, lists, code and tables", () => {
    const { container } = render(<ChatMarkdown>{ANSWER}</ChatMarkdown>);
    expect(screen.getByRole("heading", { level: 1, name: "Cell energy" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "ATP" })).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("energy currency");
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["glycolysis", "the Krebs cycle"]);
    expect(container.querySelector("pre code")?.textContent).toContain("print(");
    const table = container.querySelector(".chat-table table");           // wrapped so a wide table scrolls, not the page
    expect(table).toBeTruthy();
    expect(within(table as HTMLElement).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Stage", "Yield"]);
    expect(within(table as HTMLElement).getByRole("cell", { name: "2 ATP" })).toBeTruthy();
  });

  it("does not turn raw HTML in an answer into elements", () => {
    const { container } = render(<ChatMarkdown>{ANSWER}</ChatMarkdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("opens links in a new tab without handing over the opener", () => {
    render(<ChatMarkdown>{"[the source](https://example.com/a)"}</ChatMarkdown>);
    const link = screen.getByRole("link", { name: "the source" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps a reading width of at most 72 characters", () => {
    const { container } = render(<ChatMarkdown>{"hello"}</ChatMarkdown>);
    expect((container.firstElementChild as HTMLElement).className).toContain("max-w-[72ch]");
  });
});

describe("SourceChips", () => {
  it("shows one chip per source as 'file · p.N', without duplicates", () => {
    render(<SourceChips sources={["bio.pdf · p.4", "bio.pdf · p.9", "bio.pdf · p.4"]} />);
    const chips = within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual(["bio.pdf · p.4", "bio.pdf · p.9"]);
  });

  it("renders nothing when there are no sources", () => {
    const { container, rerender } = render(<SourceChips sources={[]} />);
    expect(container.firstChild).toBeNull();
    rerender(<SourceChips sources={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("NotFoundCard", () => {
  it("is a calm note that says the document doesn't cover the question", () => {
    render(<NotFoundCard question="What is quantum gravity?" onAsk={vi.fn()} />);
    const card = screen.getByTestId("not-found");
    expect(within(card).getByRole("heading", { name: "I couldn't find that in your document" })).toBeTruthy();
    expect(card.textContent).toContain("What is quantum gravity?");
    expect(card.querySelector(".ui-card--danger, [role=alert]")).toBeNull();      // not an error
  });

  it("suggests a rephrasing and asks it when clicked", () => {
    const onAsk = vi.fn();
    render(<NotFoundCard question="What is quantum gravity?" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "What does the document say about quantum gravity?" }));
    expect(onAsk).toHaveBeenCalledWith("What does the document say about quantum gravity?");
    fireEvent.click(screen.getByRole("button", { name: "Summarize the key concepts" }));
    expect(onAsk).toHaveBeenLastCalledWith("Summarize the key concepts");
  });

  it("builds the rephrasing from the topic", () => {
    expect(rephraseSuggestion("What is the Krebs cycle?")).toBe("What does the document say about Krebs cycle?");
    expect(rephraseSuggestion("Explain photosynthesis")).toBe("What does the document say about photosynthesis?");
    expect(rephraseSuggestion("   ")).toBeNull();
    expect(rephraseSuggestion("word ".repeat(20))).toBeNull();
  });
});
