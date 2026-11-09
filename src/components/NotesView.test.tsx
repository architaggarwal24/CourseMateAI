import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { json } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => (p: { citation: { n: number; page: number } }) => <div role="dialog" aria-label={`PDF at page ${p.citation.page}`} /> }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import NotesView, { notesMarkdown } from "@/components/NotesView";

const NOTES = "# Cell energy\n\nATP is the **energy currency**.\n\n## Glycolysis\n\n- step one\n- step two\n\n| Stage | Yield |\n| --- | --- |\n| Glycolysis | 2 ATP |\n\n### Details\n\nMore text.";

beforeEach(() => { localStorage.clear(); Object.values(toasts).forEach((f) => f.mockClear()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const generate = async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json(200, { mode: "notes", content: NOTES, sources: [], rewards: null })));
  render(<NotesView documentId="d1" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "cells" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate notes" }));
  await screen.findByRole("heading", { level: 1, name: "Cell energy" });
};

describe("NotesView", () => {
  it("shows the generated notes as readable markdown in a column of at most 72 characters", async () => {
    await generate();
    const canvas = document.querySelector(".notes-canvas") as HTMLElement;
    expect(canvas.querySelector("strong")?.textContent).toBe("energy currency");
    expect(within(canvas).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["step one", "step two"]);
    expect(within(canvas).getByRole("columnheader", { name: "Yield" })).toBeTruthy();
    expect(screen.getByText(/\d+ words/)).toBeTruthy();
  });

  it("the outline lists the headings and jumps to the one picked", async () => {
    await generate();
    fireEvent.click(screen.getByRole("tab", { name: "Outline" }));
    const nav = screen.getByRole("navigation", { name: "Outline" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Cell energy", "Glycolysis", "Details"]);

    const scroller = document.querySelector(".notes-scroll") as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get() { return this.textContent === "Glycolysis" ? 500 : 0; } });
    fireEvent.click(within(nav).getByRole("button", { name: "Glycolysis" }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 476, behavior: "smooth" }));
    expect(screen.getByRole("tab", { name: "Full notes" }).getAttribute("aria-selected")).toBe("true");
    delete (HTMLElement.prototype as any).offsetTop;
  });

  it("offers the notes as Markdown and text downloads, and 'New' goes back to the setup form", async () => {
    await generate();
    expect(screen.getByRole("link", { name: /Markdown/ }).getAttribute("download")).toBe("cells.md");
    expect(screen.getByRole("link", { name: /Text/ }).getAttribute("download")).toBe("cells.txt");
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("button", { name: "Generate notes" })).toBeTruthy();
  });

  it("a failed generation is reported in a toast and the form works again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: { code: "internal", message: "The AI request failed.", action: "retry", details: null } })));
    render(<NotesView documentId="d1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate notes" }));
    await waitFor(() => expect(toasts.apiError).toHaveBeenCalledWith(expect.objectContaining({ code: "internal", message: "The AI request failed." }), { onRetry: expect.any(Function) }));
    expect((screen.getByRole("button", { name: "Generate notes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks for the format picked, links each [n] to its page, and the Markdown file lists the sources", async () => {
    const cites = [
      { n: 1, doc_id: "d1", doc_name: "bio.pdf", page: 4, snippet: "ATP", label: "bio.pdf, page 4" },
      { n: 2, doc_id: "d1", doc_name: "bio.pdf", page: 9, snippet: "glycolysis", label: "bio.pdf, page 9" },
    ];
    const fetchMock = vi.fn(async (..._a: unknown[]) => json(200, { mode: "notes", format: "cornell", content: "# Cell energy\n\nATP is the currency [1].", sources: [], citations: cites, rewards: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotesView documentId="d1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("radio", { name: /Cornell/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate notes" }));
    await screen.findByRole("heading", { level: 1, name: "Cell energy" });

    const req = fetchMock.mock.calls[0][0] as Request;
    expect(await req.clone().json()).toMatchObject({ topic: "cells", format: "cornell", session_id: "d1" });
    fireEvent.click(screen.getByRole("button", { name: "Source 1" }));
    expect(screen.getByRole("dialog", { name: "PDF at page 4" })).toBeTruthy();
    // only the cited passage is listed under the notes and in the file
    expect(within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem")).toHaveLength(1);
    const href = decodeURIComponent(screen.getByRole("link", { name: /Markdown/ }).getAttribute("href")!);
    expect(href).toContain("## Sources\n\n- [1] bio.pdf, page 4");
    expect(href).not.toContain("page 9");
    const saved = Object.keys(localStorage).filter((k) => k.startsWith("cmai_session_")).map((k) => JSON.parse(localStorage.getItem(k)!));
    expect(saved.find((x) => x.notes)).toMatchObject({ format: "cornell", citations: cites });
  });

  it("notes saved before formats (with a detail level) still open", async () => {
    localStorage.setItem("cmai_session_old1", JSON.stringify({ notes: "# Old notes\n\nText.", topic: "old", detail: "Ultra-detailed (Exam Ready)" }));
    render(<NotesView restoreSessionId="old1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Old notes" })).toBeTruthy();
    expect(screen.getByText("old · Exam-ready")).toBeTruthy();
  });

  it("notesMarkdown leaves notes without citations as they are", () => {
    expect(notesMarkdown("# A\n\nB", [])).toBe("# A\n\nB");
  });
});

describe("NotesView memory", () => {
  it("the notes on screen come back after leaving (activeSession), and New starts a fresh History entry", async () => {
    const { activeSession } = await import("@/lib/study/memory");
    await generate();
    const id = activeSession("notes", "d1")!;
    expect(id).toBeTruthy();
    cleanup();
    render(<NotesView documentId="d1" restoreSessionId={id} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Cell energy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(activeSession("notes", "d1")).toBeUndefined();
    expect(localStorage.getItem(`cmai_session_${id}`)).not.toBeNull();     // still in History
  });

  it("keeps the topic typed but not sent", async () => {
    render(<NotesView documentId="d1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "half-typed" } });
    cleanup();
    render(<NotesView documentId="d1" />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("half-typed");
  });
});
