import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import { Roster } from "@/components/arena/pixel/Roster";
import { useChampion, type ChampionProgress } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import ChampionCeremony, { joinedBecause } from "./ChampionCeremony";

const kit = { passive: { name: "Reach", text: "Jab hits harder." }, ultimate: { name: "Dawn Wall", text: "Blows are halved." } };
const entry = (unlock: Partial<NonNullable<ChampionProgress["unlock"]>>): ChampionProgress => ({
  xp: 0, level: 1, level_xp: 0, next_level_xp: 100, battles: 0, wins: 0, mastery: [], kit,
  unlock: { unlocked: true, celebrated: true, source: null, how: "Free", have: 1, need: 1, reward: { xp: 0, coins: 0 }, ...unlock },
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Object.values(toasts).forEach((f) => f.mockReset());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useChampion.getState().reset(); });

// Stage C1: champions who haven't joined are silhouettes; one who just joined gets a ceremony with a reward.
describe("the roster's locks", () => {
  it("a locked champion says what brings them, how far along that is, and can't be picked", async () => {
    useChampion.setState({
      championId: "kaien", signedIn: false,
      progress: {
        kaien: entry({}),
        asha: entry({ unlocked: false, how: "Beat every creature in Bestiary tier I", have: 2, need: 4 }),
        thorne: entry({ unlocked: false, how: "Reach level 25", have: 7, need: 25 }),
      },
    });
    render(<Roster />);
    const asha = screen.getByRole("radio", { name: /Asha/ });
    expect(asha.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(asha.getAttribute("aria-describedby")!)!.textContent).toMatch(/Locked\. Beat every creature in Bestiary tier I\s*2 of 4/);
    fireEvent.click(asha);
    expect(toasts.info).toHaveBeenCalledWith(expect.stringContaining("Asha hasn't joined you yet"));
    expect(screen.getByRole("radio", { name: /Kaien/ }).getAttribute("aria-checked")).toBe("true");
    // the arrows pass over the locked ones: Kaien -> Brak (unknown lock: open)
    act(() => { screen.getByRole("radio", { name: /Kaien/ }).focus(); });
    fireEvent.keyDown(screen.getByRole("radio", { name: /Kaien/ }), { key: "ArrowRight" });
    await waitFor(() => expect(useChampion.getState().championId).toBe("brak"));
  });
});

describe("the unlock ceremony", () => {
  it("says why the champion joined", () => {
    expect(joinedBecause("tier2")).toBe("You finished Bestiary tier II.");
    expect(joinedBecause("level")).toBe("You reached level 25.");
  });

  it("shows the new champion, their kit and reward; Fight as picks them and the ceremony is gone", async () => {
    useHUDStore.setState({ refresh: vi.fn(async () => {}) } as never);
    useChampion.setState({
      championId: "kaien", signedIn: false,
      progress: { kaien: entry({}), asha: entry({ celebrated: false, source: "tier1", reward: { xp: 150, coins: 100 } }) },
    });
    render(<ChampionCeremony />);
    const dialog = await screen.findByRole("dialog", { name: "Asha joins you" });
    expect(dialog.textContent).toContain("You finished Bestiary tier I.");
    expect(dialog.textContent).toContain("Passive · Reach");
    expect(screen.getByLabelText("Reward: 150 XP and 100 coins")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fight as Asha" }));
    await waitFor(() => expect(useChampion.getState().championId).toBe("asha"));
    expect(useChampion.getState().progress.asha.unlock!.celebrated).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
