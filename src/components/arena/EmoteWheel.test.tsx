import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ fetchEmotes: vi.fn() }));
vi.mock("@/lib/arena/api", () => api);

import { HEROES } from "@/lib/pixel/heroes";
import { comboCallout } from "./BattleScreen";
import EmoteWheel from "./EmoteWheel";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

// Stage A2: a wheel of victory emotes after a win; the announcer's calls.
describe("the emote wheel", () => {
  it("owned emotes play (a bubble over the champion); locked ones say how to get them", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    api.fetchEmotes.mockResolvedValue({ emotes: [
      { id: "emote_gg", name: "GG", owned: true, how: "Free" },
      { id: "emote_laugh", name: "Laugh", owned: true, how: "Shop · 150 coins" },
      { id: "emote_crown", name: "Crown", owned: false, how: "Defeat 10 bosses" },
    ] });
    render(<EmoteWheel hero={HEROES[0]} />);
    const wheel = screen.getByRole("list", { name: "Emotes" });
    await waitFor(() => expect(within(wheel).getAllByRole("button")).toHaveLength(3));
    const crown = within(wheel).getByRole("button", { name: "Crown, locked: Defeat 10 bosses" }) as HTMLButtonElement;
    expect(crown.disabled).toBe(true);
    fireEvent.click(within(wheel).getByRole("button", { name: "Laugh" }));
    expect(screen.getByRole("status").textContent).toBe("HA HA HA!");
  });
});

describe("the announcer", () => {
  it("calls combos, banes and weak spots; stays quiet on an ordinary hit", () => {
    expect(comboCallout(1)).toBeUndefined();
    expect(comboCallout(3)).toBe("COMBO x3!");
    expect(comboCallout(4)).toBeUndefined();
    expect(comboCallout(5)).toBe("COMBO x5!");
    expect(comboCallout(9)).toBe("RAMPAGE x9!");
    expect(comboCallout(12)).toBe("UNSTOPPABLE x12!");
    expect(comboCallout(2, true)).toBe("BANE!");
    expect(comboCallout(1, false, true)).toBe("WEAK SPOT!");
  });
});
