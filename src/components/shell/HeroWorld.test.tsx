import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/arena", useSearchParams: () => new URLSearchParams("") }));
const sound = vi.hoisted(() => ({ played: [] as string[], background: [] as (string | null)[] }));
vi.mock("@/lib/sound/chip", async (orig) => {
  const real = await orig<typeof import("@/lib/sound/chip")>();
  return { ...real, sfx: (n: string) => { sound.played.push(n); }, music: { ...real.music, background: (n: string | null) => { sound.background.push(n); } } };
});

import HeroWorldFx from "./HeroWorldFx";
import HeroScene, { dayTime, weatherOf } from "./HeroScene";
import HeroSidebar from "./HeroSidebar";
import PauseMenu from "./PauseMenu";
import { HERO_PREFS_DEFAULT, useHeroPrefs } from "@/hooks/useHeroPrefs";
import { usePause } from "@/hooks/usePause";
import { useHUDStore } from "@/hooks/useHUD";

beforeEach(() => {
  localStorage.clear();
  useHeroPrefs.setState({ ...HERO_PREFS_DEFAULT, loaded: false });
  sound.played = []; sound.background = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Hero world's switches (two worlds, Stage 4)", () => {
  it("defaults: pixel cursor and menu sounds on, lobby music and scanlines off; saved in this browser; junk ignored", () => {
    useHeroPrefs.getState().load();
    expect(useHeroPrefs.getState()).toMatchObject({ cursor: true, menuSounds: true, lobbyMusic: false, scanlines: false, nudge: true });
    useHeroPrefs.getState().set({ scanlines: true, lobbyMusic: true });
    useHeroPrefs.setState({ ...HERO_PREFS_DEFAULT, loaded: false });
    localStorage.setItem("cmai_hero_prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("cmai_hero_prefs")!), cursor: "yes", bogus: true }));
    useHeroPrefs.getState().load();
    expect(useHeroPrefs.getState()).toMatchObject({ scanlines: true, lobbyMusic: true, cursor: true });
    expect("bogus" in useHeroPrefs.getState()).toBe(false);
  });

  it("the frame takes the switches: cursor and scanlines as attributes; lobby music in the background, gone when you leave", () => {
    localStorage.setItem("cmai_hero_prefs", JSON.stringify({ scanlines: true, lobbyMusic: true }));
    const { unmount } = render(<div className="app-shell"><HeroWorldFx /></div>);
    const shell = document.querySelector(".app-shell")!;
    expect(shell.hasAttribute("data-cursor")).toBe(true);
    expect(shell.hasAttribute("data-scanlines")).toBe(true);
    expect(sound.background.at(-1)).toBe("lobby");
    act(() => { useHeroPrefs.getState().set({ lobbyMusic: false, cursor: false }); });
    expect(sound.background.at(-1)).toBe(null);
    expect(shell.hasAttribute("data-cursor")).toBe(false);
    unmount();
    expect(sound.background.at(-1)).toBe(null);
  });

  it("the pause menu's Options turn them on and off", () => {
    render(<PauseMenu />);
    act(() => { usePause.getState().show("options"); });
    const dialog = screen.getByRole("dialog", { name: "Options" });
    const music = within(dialog).getByRole("button", { name: "Lobby music" });
    expect(music.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(music);
    expect(useHeroPrefs.getState().lobbyMusic).toBe(true);
    for (const n of ["Pixel cursor", "Menu sounds", "CRT scanlines", "Study reminder"]) expect(within(dialog).getByRole("button", { name: n })).toBeTruthy();
  });

  it("menu sounds: a blip as the cursor moves to another item, a select when one is chosen; none when switched off", () => {
    useHUDStore.setState({ level: 3 } as never);
    render(<HeroSidebar />);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    fireEvent.mouseOver(links[1]);
    fireEvent.mouseOver(links[1]);
    fireEvent.mouseOver(links[2]);
    expect(sound.played.filter((n) => n === "click")).toHaveLength(2);
    fireEvent.click(links[2]);
    expect(sound.played).toContain("select");
    act(() => { useHeroPrefs.getState().set({ menuSounds: false }); });
    sound.played = [];
    fireEvent.mouseOver(links[3]);
    expect(sound.played).toEqual([]);
  });
});

describe("the world behind the panel (two worlds, Stage 4)", () => {
  it("follows your clock, and your streak is its weather", () => {
    expect([4, 6, 12, 18, 22].map(dayTime)).toEqual(["night", "dawn", "day", "dusk", "night"]);
    const now = new Date(2026, 10, 12, 15);
    expect(weatherOf(0, now.toISOString(), now)).toBe("rain");
    expect(weatherOf(4, now.toISOString(), now)).toBe("clear");
    expect(weatherOf(4, new Date(2026, 10, 11, 15).toISOString(), now)).toBe("cloudy");
    expect(weatherOf(4, null, now)).toBe("cloudy");
    useHUDStore.setState({ streakDays: 0 } as never);
    render(<HeroScene />);
    expect(screen.getByTestId("hero-scene").getAttribute("data-weather")).toBe("rain");
    expect(screen.getByTestId("hero-scene").getAttribute("aria-hidden")).toBe("true");
  });
});
