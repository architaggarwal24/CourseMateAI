import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { json } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn() }) }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import NotesView from "@/components/NotesView";

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
});
