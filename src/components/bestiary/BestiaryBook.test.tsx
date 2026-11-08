import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ fetchBestiary: vi.fn(), fetchBestiaryPage: vi.fn() }));
vi.mock("@/lib/arena/api", () => api);

import { useHUDStore } from "@/hooks/useHUD";
import { useChampion } from "@/hooks/useChampion";
import BestiaryBook, { leaves, spreads } from "./BestiaryBook";
import { LOST_PAGES, PAGES } from "@/lib/bestiary/content";

const entry = (species: string, tier: number, over: Record<string, unknown> = {}) => ({
  species, tier, open: tier === 1, met: false, defeated: false, name: tier === 1 ? species[0].toUpperCase() + species.slice(1) : null,
  origin: tier === 1 ? "Greek" : null, teaser_topic: null, mastery: "none", record: null,
  bane: tier === 1 ? { clue: `The ${species} clue.`, moves: null, found_alone: false, uses: 0 } : null, ...over,
});
const DATA = {
  tiers: [{ tier: 1, name: "Beasts of the Wilds", open: true, beaten: 1, total: 2, opens_next_at: 2 }, { tier: 2, name: "Tricksters and Hunters", open: false, beaten: 0, total: 0, opens_next_at: 2 },
    { tier: 3, name: "Ancient Horrors", open: false, beaten: 0, total: 1, opens_next_at: 2 }],
  creatures: [
    entry("minotaur", 1, { defeated: true, mastery: "bronze", lost_page: true, bane: { clue: "x", moves: ["guard", "heavy"], found_alone: false, uses: 2 },
      record: { fights: 3, wins: 2, losses: 1, flawless_wins: 0, nightmare_wins: 1, best_seconds: 75, best_accuracy: 90, first_win_at: null, last_fought_at: null } }),
    entry("oni", 1),
    entry("hydra", 3, { teaser_topic: "cell biology" }),
  ],
};

beforeEach(() => {
  // reduced motion: pages turn at once (the curl is a CSS transition jsdom doesn't run)
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
  useHUDStore.setState({ guestMode: false });
  useChampion.setState({ championId: "brak" });
  api.fetchBestiary.mockResolvedValue(DATA);
  api.fetchBestiaryPage.mockResolvedValue({ ...DATA.creatures[0], concepts: [{ concept: "Graph traversal", asked: 6, right: 5 }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); useHUDStore.setState({ guestMode: true }); });

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

// Stage B2: the Bestiary as a book (one page at a time here: jsdom has no wide screen, and no motion).
describe("the Bestiary book", () => {
  it("reads title, contents, then each creature's sketch and words, then the end", () => {
    const l = leaves(DATA.creatures);
    expect(l.map((x) => x.kind)).toEqual(["title", "contents", "art", "text", "art", "text", "art", "text", "end"]);
    expect(spreads(l)).toHaveLength(5);
    expect(spreads(l)[1]).toEqual([{ kind: "art", species: "minotaur" }, { kind: "text", species: "minotaur" }]);
  });

  it("the arrow keys turn the pages; a creature's page has its lore, record, bane, concepts and your champion's note", async () => {
    render(<BestiaryBook />);
    expect((await screen.findByText(/pages written in full/)).textContent).toBe("1 of 3 pages written in full");
    key("ArrowRight");                                                            // contents
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeTruthy();
    key("ArrowRight");                                                            // the Minotaur's sketch
    expect(screen.getByText(PAGES.minotaur.epithet)).toBeTruthy();
    expect(screen.getByText("Bronze seal")).toBeTruthy();
    expect(screen.getByText("1:15")).toBeTruthy();
    key("ArrowRight");                                                            // its words
    expect(screen.getByText(/Guard, then Heavy/)).toBeTruthy();
    expect(screen.getByText(PAGES.minotaur.notes.brak, { exact: false })).toBeTruthy();
    expect(screen.getByText(/Elder Minotaur/)).toBeTruthy();                       // met on nightmare
    expect(screen.getByRole("complementary", { name: "Lost page" }).textContent).toContain(LOST_PAGES.minotaur.slice(0, 40)); // a Hunt found it
    expect(await screen.findByText("Graph traversal")).toBeTruthy();
    key("ArrowLeft");
    expect(screen.getByText(PAGES.minotaur.epithet)).toBeTruthy();
  });

  it("an unbeaten creature shows its bane's clue; a sealed one is a silhouette with its teaser and how to break the seal", async () => {
    render(<BestiaryBook />);
    await screen.findByText(/pages written/);
    key("ArrowRight");
    fireEvent.click(screen.getByRole("button", { name: "Oni, page" }));
    key("ArrowRight");
    expect(screen.getByText(/The oni clue/)).toBeTruthy();
    expect(screen.getByText(/One page is missing/)).toBeTruthy();
    key("ArrowRight");
    expect(screen.getByText("? ? ?")).toBeTruthy();
    expect(screen.getByText("cell biology")).toBeTruthy();
    expect(screen.getByText(/Beat 2 creatures of tier/)).toBeTruthy();
    key("ArrowRight");
    expect(screen.getByText("This page is sealed.")).toBeTruthy();
    expect(api.fetchBestiaryPage).toHaveBeenCalledTimes(0);                       // only beaten creatures are asked about
  });

  it("dragging the page left past a third turns it; a short drag does not", async () => {
    render(<BestiaryBook />);
    await screen.findByText(/pages written/);
    const book = document.querySelector(".tome-book") as HTMLElement;
    Object.defineProperty(book, "clientWidth", { value: 300 });
    fireEvent.pointerDown(book, { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(book, { clientX: 220, pointerId: 1 });
    fireEvent.pointerUp(book, { pointerId: 1 });
    await waitFor(() => expect(screen.getByText(/pages written/)).toBeTruthy());
    fireEvent.pointerDown(book, { clientX: 280, pointerId: 2 });
    fireEvent.pointerMove(book, { clientX: 100, pointerId: 2 });
    fireEvent.pointerUp(book, { pointerId: 2 });
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Contents" })).toBeTruthy());
  });

  it("every creature has its words", () => {
    for (const s of ["minotaur", "cyclops", "oni", "kitsune", "naga", "rakshasa", "sphinx", "fenrir", "hydra", "kraken", "ammit", "simurgh", "jormungandr"]) {
      const p = PAGES[s];
      expect(p?.lore.length, s).toBeGreaterThan(120);
      expect(Object.keys(p.notes).sort(), s).toEqual(["asha", "brak", "kaien", "mira", "thorne", "vex"]);
    }
  });
});
