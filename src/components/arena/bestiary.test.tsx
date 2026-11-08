import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ fetchBestiary: vi.fn() }));
vi.mock("@/lib/arena/api", async (orig) => ({ ...(await orig<typeof import("@/lib/arena/api")>()), fetchBestiary: api.fetchBestiary }));

import { useHUDStore } from "@/hooks/useHUD";
import { Bestiary } from "./pixel/Bestiary";
import BaneHud from "./BaneHud";

afterEach(() => { cleanup(); vi.clearAllMocks(); useHUDStore.setState({ guestMode: true }); });

const entry = (species: string, tier: number, over: Record<string, unknown> = {}) => ({
  species, tier, open: tier === 1, met: false, defeated: false, name: tier === 1 ? species : null, origin: tier === 1 ? "Greek" : null,
  teaser_topic: null, mastery: "none", record: null, bane: tier === 1 ? { clue: `clue ${species}`, moves: null, found_alone: false, uses: 0 } : null, ...over,
});

// Stage B1: the Bestiary by tier; sealed tiers are silhouettes; a beaten creature shows its bane.
describe("Bestiary", () => {
  it("shows tiers, silhouettes for sealed creatures with a teaser, and the bane of a beaten one", async () => {
    useHUDStore.setState({ guestMode: false });
    api.fetchBestiary.mockResolvedValue({
      tiers: [{ tier: 1, name: "Beasts of the Wilds", open: true, beaten: 1, total: 2, opens_next_at: 2 }, { tier: 3, name: "Ancient Horrors", open: false, beaten: 0, total: 1, opens_next_at: 2 }],
      creatures: [
        entry("minotaur", 1, { defeated: true, mastery: "bronze", record: { fights: 3, wins: 2, losses: 1, flawless_wins: 0, nightmare_wins: 0, best_seconds: 90, best_accuracy: 91, first_win_at: null, last_fought_at: null },
          bane: { clue: "c", moves: ["guard", "heavy"], found_alone: false, uses: 1 } }),
        entry("oni", 1),
        entry("hydra", 3, { teaser_topic: "cell biology" }),
      ],
    });
    render(<Bestiary />);
    expect(await screen.findByText("Guard > Heavy")).toBeTruthy();
    expect(screen.getByText(/2 wins of 3 · best 91%/)).toBeTruthy();
    expect(screen.getByText(/beat 2 to open tier III/)).toBeTruthy();
    const locked = screen.getByLabelText("A locked creature");
    expect(within(locked).getByText("???")).toBeTruthy();
    expect(within(locked).getByText("cell biology")).toBeTruthy();
    expect(screen.getByText(/clue oni/)).toBeTruthy();
  });

  it("a visitor sees the fallback and nothing is asked", () => {
    render(<Bestiary />);
    expect(api.fetchBestiary).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("A locked creature").length).toBe(9);
  });
});

describe("BaneHud", () => {
  it("shows the clue until the bane is known, then the steps with the landed ones marked", () => {
    const { rerender, container } = render(<BaneHud bane={{ known: false, clue: "Stand firm.", moves: null, progress: 0 }} />);
    expect(screen.getByText(/Stand firm/)).toBeTruthy();
    rerender(<BaneHud bane={{ known: true, clue: "x", moves: ["guard", "heavy"], progress: 1 }} />);
    expect(screen.getByLabelText("Bane: Guard, then Heavy. 1 of 2 landed.")).toBeTruthy();
    expect(container.querySelectorAll("[data-done]")).toHaveLength(1);
  });
});
