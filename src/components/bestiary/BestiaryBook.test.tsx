import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ fetchBestiary: vi.fn(), fetchBestiaryPage: vi.fn() }));
vi.mock("@/lib/arena/api", () => api);

import { useHUDStore } from "@/hooks/useHUD";
import { useChampion } from "@/hooks/useChampion";
import BestiaryBook, { STACK_GAP, TURN_MS, leafPose, leafProgress, leaves, seedOf, spreads, tornEdge } from "./BestiaryBook";
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
    fireEvent.click(screen.getByRole("button", { name: /^Oni, page \d+/ }));
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

// Stage B3: worn pages and curled turns
describe("the book's paper and its turns", () => {
  it("each page has its own ragged outline, the same every time; the spine edge stays straight", () => {
    const a = tornEdge(seedOf("art-minotaur"), "right");
    expect(a).toMatch(/^polygon\(/);
    expect(tornEdge(seedOf("art-minotaur"), "right")).toBe(a);
    expect(tornEdge(seedOf("art-cyclops"), "right")).not.toBe(a);
    const xs = (poly: string) => poly.slice(8, -1).split(", ").map((pt) => parseFloat(pt));
    // a right page: its left (spine) side is straight at 0%
    expect(xs(tornEdge(seedOf("x"), "right")).filter((x) => x < 2).every((x) => x === 0 || x < 2)).toBe(true);
  });

  it("a leaf bends most halfway over, and lies flat at either end", () => {
    const flat = leafPose(0), mid = leafPose(0.5), done = leafPose(1);
    expect(flat[0].angle).toBeCloseTo(0);
    expect(done[0].angle).toBeCloseTo(-180);
    expect(Math.abs(mid[1].angle)).toBeGreaterThan(Math.abs(leafPose(0.15)[1].angle));
    expect(done[3].angle).toBeCloseTo(0);
  });

  it("a stack of leaves turns together, each a little behind the one before; back, the last one lifts first", () => {
    const at = (ms: number, n: number, fwd = true) => leafProgress(ms / (TURN_MS + (n - 1) * STACK_GAP), n, fwd);
    expect(at(0, 4)).toEqual([0, 0, 0, 0]);
    const mid = at(TURN_MS / 2, 4);
    expect(mid[0]).toBeGreaterThan(mid[1]);
    expect(mid[1]).toBeGreaterThan(mid[3]);
    expect(at(TURN_MS + 3 * STACK_GAP, 4)).toEqual([1, 1, 1, 1]);
    const back = leafProgress(0.3, 4, false);
    expect(back[3]).toBeLessThan(back[0]);                                       // the top of the left stack is already moving
  });
});

// Round 7: the Scholar's desk - living pages, the side panels, the unlock rituals.
describe("the Scholar's desk", () => {
  beforeEach(() => localStorage.clear());
  const STATS = { attacks: ["Labyrinth Charge", "Horn Gore", "Axe Cleave"], special: "Endless Labyrinth", hp_scale: 1.15, time_scale: 0.93 };

  it("a creature page is alive: a stat block, fight notes, a Hunt button, and the sketch can be provoked", async () => {
    api.fetchBestiary.mockResolvedValue({ ...DATA, creatures: [{ ...DATA.creatures[0], stats: STATS }, ...DATA.creatures.slice(1)] });
    render(<BestiaryBook />);
    await screen.findByText(/pages written in full/);
    key("ArrowRight"); key("ArrowRight");
    expect(screen.getByText(/\+15% HP · −7% time per question/)).toBeTruthy();
    expect(screen.getByText(/Labyrinth Charge, Horn Gore, Axe Cleave/)).toBeTruthy();
    const notes = screen.getByRole("list", { name: "Fight notes" });
    expect(notes.textContent).toContain("Beaten 2 of 3 fights (67%).");
    expect(notes.textContent).toContain("3 more victories for the silver seal");
    expect(screen.getByRole("link", { name: "Hunt it again" }).getAttribute("href")).toBe("/arena?hunt=minotaur");
    const sketch = screen.getByRole("button", { name: "Provoke the Minotaur" });
    fireEvent.click(sketch);
    expect(sketch.getAttribute("data-anim")).toBe("attack");
  });

  it("the tier map turns to a tier; the hunt record adds up the book and names the next quarry", async () => {
    render(<BestiaryBook />);
    await screen.findByText(/pages written in full/);
    const map = screen.getByRole("navigation", { name: "The road through the book" });
    expect(map.textContent).toContain("you are here");
    expect(map.textContent).toMatch(/Beat 1 more creature of tier I to break this seal/);
    fireEvent.click(screen.getByRole("button", { name: /^Tier III: sealed/ }));
    expect(screen.getByText("? ? ?")).toBeTruthy();                              // hydra's sealed page
    const ledger = screen.getByRole("region", { name: "Hunt record" });
    expect(ledger.textContent).toMatch(/Hunts3/);
    expect(ledger.textContent).toMatch(/Victories2/);
    expect(ledger.textContent).toContain("1:15 · Minotaur");
    expect(screen.getByText("Seals: 0 gold, 0 silver, 1 bronze")).toBeTruthy();
    expect(ledger.textContent).toContain("Next quarry");
    expect(within(ledger).getByRole("link", { name: "Hunt" }).getAttribute("href")).toBe("/arena?hunt=oni");
  });

  it("the first visit replays nothing; a page written since shows as fresh ink, and opening it plays (and ends) its ritual", async () => {
    const first = render(<BestiaryBook />);
    await screen.findByText(/pages written in full/);
    expect(screen.queryByText("Fresh ink")).toBeNull();
    expect(JSON.parse(localStorage.getItem("cmai_tome_seen_v1")!)).toEqual({ written: ["minotaur"], tiers: [1] });
    first.unmount();

    api.fetchBestiary.mockResolvedValue({ ...DATA, creatures: [DATA.creatures[0], { ...DATA.creatures[1], defeated: true, mastery: "bronze" }, DATA.creatures[2]] });
    render(<BestiaryBook />);
    const fresh = await screen.findByRole("button", { name: "Oni written in full" });
    fireEvent.click(fresh);
    await waitFor(() => expect(screen.queryByText("Fresh ink")).toBeNull());       // reduced motion: the ritual ends at once
    expect(JSON.parse(localStorage.getItem("cmai_tome_seen_v1")!).written).toEqual(["minotaur", "oni"]);
    expect(screen.getByText("The Oni's page is written in full.")).toBeTruthy();
  });
});
