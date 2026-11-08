// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SoundToggle from "./SoundToggle";
import { __resetSound, useSound } from "@/lib/sound/chip";

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove("reduce-animations"); __resetSound(); });

describe("SoundToggle", () => {
  it("turns all sound off and on, and remembers it", () => {
    render(<SoundToggle />);
    const btn = screen.getByRole("button", { name: "Sound" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(localStorage.getItem("cmai_sound")!).on).toBe(false);
  });

  it("starts off under reduced motion", () => {
    document.documentElement.classList.add("reduce-animations");
    render(<SoundToggle />);
    expect(screen.getByRole("button", { name: "Sound" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the music switch: off turns only the music off; on while all sound is off turns both on", () => {
    render(<SoundToggle kind="music" />);
    const btn = screen.getByRole("button", { name: "Music" });
    fireEvent.click(btn);
    expect(useSound.getState()).toMatchObject({ on: true, music: false });
    useSound.getState().setOn(false);
    fireEvent.click(btn);
    expect(useSound.getState()).toMatchObject({ on: true, music: true });
  });
});
