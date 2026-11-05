import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ThemeSwitch from "./ThemeSwitch";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("ThemeSwitch (Settings -> Appearance)", () => {
  it("offers System, Light and Dark as one choice, and applies a pick at once", () => {
    render(<ThemeSwitch />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: /System/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Light/ }));
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(screen.getByRole("radio", { name: /Light/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(JSON.parse(localStorage.getItem("cmai_appearance")!).theme).toBe("dark");
  });

  it("arrow keys move the choice (one tab stop for the group)", () => {
    render(<ThemeSwitch />);
    const system = screen.getByRole("radio", { name: /System/ });
    expect(system.tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: /Dark/ }).tabIndex).toBe(-1);
    fireEvent.keyDown(system, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /Light/ }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Light/ }));
  });

  it("follows a change made elsewhere (the Ctrl K menu)", async () => {
    const { setThemePref } = await import("@/lib/theme");
    render(<ThemeSwitch />);
    setThemePref("dark");
    expect((await screen.findByRole("radio", { name: /Dark/ })).getAttribute("aria-checked")).toBe("true");
  });
});
