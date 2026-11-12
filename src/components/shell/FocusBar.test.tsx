import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const toasts = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: { ...toasts, error: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() } }));
const amb = vi.hoisted(() => ({ played: [] as string[], stopped: 0 }));
vi.mock("@/lib/sound/ambient", async (orig) => ({ ...(await orig<typeof import("@/lib/sound/ambient")>()), ambient: { play: (k: string) => amb.played.push(k), stop: () => { amb.stopped++; }, current: "off" } }));

import FocusBar from "./FocusBar";
import AccentSwitch from "@/components/account/AccentSwitch";
import { useFocusMode } from "@/hooks/useFocusMode";
import { BREAK_MS, FOCUS_MS } from "@/lib/game/focus";
import { readAccent, THEME_SCRIPT } from "@/lib/theme";

beforeEach(() => {
  vi.useFakeTimers();
  useFocusMode.setState({ on: false, phase: "focus", endsAt: null, pausedLeft: null, sessions: 0, sound: "off" });
  amb.played = []; amb.stopped = 0; toasts.success.mockReset(); toasts.info.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, counted: true, capped: false, sessions_today: 1, xp: 10, insight: 20 }), { status: 200 })));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete document.documentElement.dataset.accent; });

describe("Study's focus mode (two worlds, Stage 6)", () => {
  it("25 minutes of focus count a session (Insight for the Hero world), then 5 of rest, then focus again", async () => {
    act(() => { useFocusMode.getState().start(); });
    render(<FocusBar />);
    expect(screen.getByRole("timer").textContent).toBe("25:00");
    await act(async () => { vi.advanceTimersByTime(FOCUS_MS + 600); });
    expect(useFocusMode.getState()).toMatchObject({ phase: "break", sessions: 1 });
    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/focus-session$/);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(toasts.success.mock.calls[0][0]).toMatch(/\+20 Insight/);
    expect(screen.getByRole("region", { name: "Focus mode" }).textContent).toContain("Rest");
    await act(async () => { vi.advanceTimersByTime(BREAK_MS + 600); });
    expect(useFocusMode.getState().phase).toBe("focus");
  });

  it("the clock pauses and resumes; the ambient sound is yours to pick; Esc or Leave ends it (and the sound)", () => {
    act(() => { useFocusMode.getState().start(); });
    render(<FocusBar />);
    fireEvent.click(screen.getByRole("button", { name: "Pause the clock" }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("timer").textContent).toBe("25:00");
    fireEvent.click(screen.getByRole("button", { name: "Resume the clock" }));
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByRole("timer").textContent).toBe("23:59");
    fireEvent.click(screen.getByRole("radio", { name: "Rain" }));
    expect(amb.played).toEqual(["rain"]);
    expect(screen.getByRole("radio", { name: "Rain" }).getAttribute("aria-checked")).toBe("true");
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(useFocusMode.getState().on).toBe(false);
    expect(amb.stopped).toBe(1);
  });
});

describe("Study's own accent colour (two worlds, Stage 6)", () => {
  it("applies at once, is remembered, and is set before the first paint", () => {
    render(<AccentSwitch />);
    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    expect(document.documentElement.dataset.accent).toBe("teal");
    expect(readAccent()).toBe("teal");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Teal" }), { key: "ArrowRight" });
    expect(document.documentElement.dataset.accent).toBe("plum");
    fireEvent.click(screen.getByRole("radio", { name: "Ink" }));
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(THEME_SCRIPT).toContain("h.dataset.accent=p.accent");
  });
});
