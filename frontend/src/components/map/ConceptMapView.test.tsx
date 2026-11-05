import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import ConceptMapView from "./ConceptMapView";

const concept = (id: string, name: string, importance: number, heat: string, extra = {}) => ({
  id, name, summary: `${name} in one line.`, importance, pages: [{ doc_id: "d1", page: 2 }], docs: ["d1"], heat, seen: heat === "new" ? 0 : 4,
  correct: heat === "strong" ? 4 : heat === "weak" ? 1 : heat === "learning" ? 3 : 0, ...extra,
});
const READY = {
  scope: { id: "d1", kind: "document", name: "biology.pdf" }, status: "ready", stage: null, built: 1, total: 1,
  documents: [{ id: "d1", name: "biology.pdf", status: "ready" }],
  concepts: [concept("atp", "ATP", 3, "strong"), concept("mitochondria", "Mitochondria", 3, "weak"),
             concept("glycolysis", "Glycolysis", 2, "learning"), concept("osmosis", "Osmosis", 1, "new")],
  relations: [{ source: "mitochondria", target: "atp", label: "produce" }, { source: "glycolysis", target: "atp", label: "yields" }],
};
const NONE = { ...READY, status: "none", built: 0, concepts: [], relations: [], documents: [{ id: "d1", name: "biology.pdf", status: "none" }] };
const BUILDING = { ...NONE, status: "building", stage: "Mapping the concepts and how they connect…", documents: [{ id: "d1", name: "biology.pdf", status: "running" }] };

function server(gets: unknown[], opts: { locked?: boolean } = {}) {
  const log = { gets: 0, posts: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
    if (url.pathname !== "/api/v1/concept-map") throw new Error(`unexpected ${url.pathname}`);
    if (opts.locked) {
      return json(403, { error: { code: "feature_locked", message: "The concept map comes with the Sage plan.", action: null,
        details: { feature: "concept_map", tier: "scholar", required_tier: "sage", required_tier_name: "Sage" } } });
    }
    if (method === "POST") { log.posts += 1; return json(200, BUILDING); }
    const body = gets[Math.min(log.gets, gets.length - 1)];
    log.gets += 1;
    return json(200, body);
  }));
  return log;
}

beforeEach(() => Object.values(toasts).forEach((f) => f.mockClear()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("concept map", () => {
  it("is made only when asked, shows the server's progress, then the constellation", async () => {
    const log = server([NONE, BUILDING, READY]);
    render(<ConceptMapView documentId="d1" />);
    const make = await screen.findByRole("button", { name: "Make the concept map" });
    expect(log.posts).toBe(0);                                                   // opening the tab costs nothing
    fireEvent.click(make);
    expect(await screen.findByText("Mapping the concepts and how they connect…")).toBeTruthy();
    expect(log.posts).toBe(1);
    const map = await screen.findByRole("group", { name: "Concept map: 4 concepts" }, { timeout: 8000 });
    expect(within(map).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "ATP. Strong, 4 of 4 right. Linked to Mitochondria, Glycolysis.",
      "Mitochondria. Weak, 1 of 4 right. Linked to ATP.",
      "Glycolysis. Learning, 3 of 4 right. Linked to ATP.",
      "Osmosis. Not tried yet.",
    ]);
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toContain("Not tried yet");
  }, 15000);

  it("while the server makes the map inside the POST, the page polls GET and shows its progress line", async () => {
    let finish!: () => void;
    const log = { gets: 0 };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
      if (method === "POST") { await new Promise<void>((r) => { finish = r; }); return json(200, READY); }
      log.gets += 1;
      return json(200, log.gets === 1 ? NONE : BUILDING);
    }));
    render(<ConceptMapView documentId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Make the concept map" }));
    expect(await screen.findByText("Mapping the concepts and how they connect…", undefined, { timeout: 4000 })).toBeTruthy();
    finish();
    expect(await screen.findByRole("group", { name: "Concept map: 4 concepts" }, { timeout: 4000 })).toBeTruthy();
  }, 15000);

  it("moves between linked stars with the arrow keys and opens a concept's actions", async () => {
    server([READY]);
    render(<ConceptMapView documentId="d1" />);
    const map = await screen.findByRole("group", { name: /Concept map/ });
    const stars = within(map).getAllByRole("button");
    expect(stars.map((s) => s.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);   // one tab stop
    stars[0].focus();
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
      fireEvent.keyDown(document.activeElement!, { key });
      if (document.activeElement !== stars[0]) break;
    }
    const moved = document.activeElement as HTMLElement;
    expect(moved).not.toBe(stars[0]);
    expect(["Mitochondria", "Glycolysis"].some((n) => moved.getAttribute("aria-label")!.startsWith(n))).toBe(true);   // a linked star
    fireEvent.keyDown(moved, { key: "Home" });
    expect(document.activeElement).toBe(stars[0]);

    fireEvent.keyDown(stars[0], { key: "Enter" });
    const panel = screen.getByRole("region", { name: "ATP" });
    expect(panel.textContent).toContain("ATP in one line.");
    expect(panel.textContent).toContain("4 of 4 answers right · explained on p.2");
    expect(within(panel).getByRole("link", { name: "Quick quiz on it" }).getAttribute("href")).toBe("/study?tab=quiz&doc=d1&topic=ATP");
    expect(within(panel).getByRole("link", { name: "Flashcards" }).getAttribute("href")).toBe("/study?tab=flashcards&doc=d1&topic=ATP");
    expect(within(panel).getByRole("link", { name: "Summon its boss" }).getAttribute("href")).toBe("/hero?tab=arena&doc=d1&topic=ATP");
    fireEvent.click(within(panel).getByRole("button", { name: "Mitochondria" }));             // jump along a link
    expect(screen.getByRole("region", { name: "Mitochondria" })).toBeTruthy();
    fireEvent.keyDown(stars[0], { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Mitochondria" })).toBeNull();
  });

  it("has a list view, grouped by how central each concept is", async () => {
    server([READY]);
    render(<ConceptMapView documentId="d1" />);
    await screen.findByRole("group", { name: /Concept map/ });
    fireEvent.click(screen.getByRole("button", { name: "Show as a list" }));
    expect(screen.getByRole("region", { name: "Central" }).textContent).toContain("ATP");
    expect(screen.getByRole("region", { name: "Supporting" }).textContent).toContain("Osmosis");
    fireEvent.click(screen.getByRole("button", { name: /Glycolysis/ }));
    expect(screen.getByRole("region", { name: "Glycolysis" }).textContent).toContain("Learning");
  });

  it("a failed map says so and can be tried again", async () => {
    const log = server([{ ...NONE, status: "failed", documents: [{ id: "d1", name: "biology.pdf", status: "failed", error: "Try a faster model." }] }]);
    render(<ConceptMapView documentId="d1" />);
    expect(await screen.findByText("Try a faster model.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(log.posts).toBe(1));
  });

  it("without the plan, says which plan has it", async () => {
    server([], { locked: true });
    render(<ConceptMapView documentId="d1" />);
    expect(await screen.findByText("The concept map comes with Sage")).toBeTruthy();
  });
});
