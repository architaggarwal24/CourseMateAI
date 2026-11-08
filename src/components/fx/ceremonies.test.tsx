import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useHUDStore } from "@/hooks/useHUD";
import { announceAchievements, coinRain, useCelebrate } from "@/lib/fx/celebrate";
import AchievementBanner from "./AchievementBanner";
import LevelUpCeremony from "./LevelUpCeremony";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); useCelebrate.setState({ rain: null, banners: [] }); localStorage.clear(); });

// Stage R3: banners for achievements (one at a time), coin showers, the level-up screen.
describe("reward ceremonies", () => {
  it("achievements queue up and drop in one at a time; a tap dismisses one", () => {
    render(<AchievementBanner />);
    act(() => { announceAchievements([{ id: "a", name: "First Steps", description: "Your first quiz" }, { id: "b", name: "Monster Hunter" }]); });
    expect(screen.getByRole("status").textContent).toContain("First Steps");
    expect(screen.getByRole("status").textContent).not.toContain("Monster Hunter");
    fireEvent.click(screen.getByRole("button", { name: /First Steps/ }));
    expect(useCelebrate.getState().banners.map((b) => b.name)).toEqual(["Monster Hunter"]);
  });

  it("a coin shower scales with what was paid (within bounds)", () => {
    coinRain(30);
    expect(useCelebrate.getState().rain?.coins).toBe(10);
    coinRain(10_000);
    expect(useCelebrate.getState().rain?.coins).toBe(60);
  });

  it("the level-up screen: not on a first visit, then once per level gained", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    useHUDStore.setState({ userId: "9", guestMode: false, level: 4, _lastRefresh: 1 });
    render(<LevelUpCeremony />);
    expect(screen.queryByRole("dialog")).toBeNull();                              // first visit: remembered quietly
    expect(localStorage.getItem("cmai_level_seen:9")).toBe("4");
    act(() => { useHUDStore.setState({ level: 6, _lastRefresh: 2 }); });
    expect(screen.getByRole("dialog", { name: "Level up!" })).toBeTruthy();
    expect(screen.getByLabelText("Level 6")).toBeTruthy();
    expect(screen.getByTestId("level-up").textContent).toContain(`+${(5 + 6) * 50} coins`);
    expect(localStorage.getItem("cmai_level_seen:9")).toBe("6");
  });
});
