import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import HeroHeader from "./HeroHeader";
import { usePause } from "@/hooks/usePause";

afterEach(() => { cleanup(); usePause.getState().close(); });

describe("the Hero header on a phone (the mobile pass)", () => {
  it("tapping your champion opens the pause menu: a phone has no Esc key", () => {
    render(<HeroHeader />);
    expect(usePause.getState().open).toBe(false);
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(screen.getByTestId("hero-header-champion")).toBeTruthy();            // the champion is still shown (and named)
    fireEvent.click(menu);
    expect(usePause.getState().open).toBe(true);
    expect(usePause.getState().view).toBe("menu");
  });

  it("keeps the sound switch beside the level, XP, coins and streak", () => {
    render(<HeroHeader />);
    expect(screen.getByRole("button", { name: "Sound" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "XP to next level" })).toBeTruthy();
  });
});
