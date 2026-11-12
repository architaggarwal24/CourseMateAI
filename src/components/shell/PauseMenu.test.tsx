import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/arena", useSearchParams: () => new URLSearchParams("") }));

import PauseMenu, { CONTROLS } from "./PauseMenu";
import { usePause } from "@/hooks/usePause";
import { usePortal } from "@/hooks/usePortal";

beforeEach(() => { vi.useFakeTimers(); usePause.setState({ open: false, view: "menu" }); usePortal.setState({ phase: "idle", to: null, href: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const esc = (target: Window | Element = window) => act(() => { fireEvent.keyDown(target, { key: "Escape" }); vi.advanceTimersByTime(1); });

describe("the pause menu (two worlds, Stage 3)", () => {
  it("Esc opens it: Resume, Options, Controls, Return to Study", () => {
    render(<PauseMenu />);
    esc();
    const dialog = screen.getByRole("dialog", { name: "Paused" });
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["Resume", "Options", "Controls", "Return to Study"]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Resume" }));
    expect(usePause.getState().open).toBe(false);
  });

  it("an Esc that a screen used for itself (Continue's give up) or typed in a field doesn't open it", () => {
    render(<><input aria-label="topic" /><PauseMenu /></>);
    const used = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", used);
    esc();
    window.removeEventListener("keydown", used);
    expect(usePause.getState().open).toBe(false);
    esc(screen.getByLabelText("topic"));
    expect(usePause.getState().open).toBe(false);
  });

  it("Controls lists every key; Options holds the sound switches; Return to Study goes through the portal", () => {
    render(<PauseMenu />);
    act(() => { usePause.getState().show("controls"); });
    const dialog = screen.getByRole("dialog", { name: "Controls" });
    for (const g of CONTROLS) expect(within(dialog).getByRole("region", { name: g.group })).toBeTruthy();
    expect(dialog.textContent).toContain("Pause menu");
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(within(screen.getByRole("dialog", { name: "Options" })).getByRole("button", { name: "Sound" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to Study" }));
    expect(usePause.getState().open).toBe(false);
    expect(usePortal.getState()).toMatchObject({ phase: "cover", to: "study", href: "/today" });
  });
});
