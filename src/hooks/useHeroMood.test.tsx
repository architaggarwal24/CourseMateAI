import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AWAKE_THROTTLE_MS, CHEER_MS, SLEEP_AFTER_MS, useHeroMood } from "./useHeroMood";
import { sfx, useSound } from "@/lib/sound/chip";
import Typewriter from "@/components/fx/Typewriter";
import LoreTip, { LORE_TIPS } from "@/components/fx/LoreTip";

function Mood() { return <p data-testid="mood">{useHeroMood()}</p>; }
beforeEach(() => { vi.useFakeTimers(); useSound.setState({ loaded: true, on: false, music: false }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the living panel (two worlds, Stage 3)", () => {
  it("the champion cheers good news and flinches at bad (sound on or off), then settles", () => {
    render(<Mood />);
    expect(screen.getByTestId("mood").textContent).toBe("idle");
    act(() => { sfx("quest"); });
    expect(screen.getByTestId("mood").textContent).toBe("cheer");
    act(() => { vi.advanceTimersByTime(CHEER_MS + 10); });
    expect(screen.getByTestId("mood").textContent).toBe("idle");
    act(() => { sfx("lose"); });
    expect(screen.getByTestId("mood").textContent).toBe("flinch");
  });

  it("left alone for a minute it dozes off; any movement wakes it", () => {
    render(<Mood />);
    act(() => { vi.advanceTimersByTime(SLEEP_AFTER_MS + 10); });
    expect(screen.getByTestId("mood").textContent).toBe("sleep");
    act(() => { fireEvent.keyDown(window, { key: "a" }); });
    expect(screen.getByTestId("mood").textContent).toBe("idle");
  });

  it("a moving mouse is cheap: the panel checks for activity at most once a second, and stays awake", () => {
    render(<Mood />);
    act(() => { vi.advanceTimersByTime(AWAKE_THROTTLE_MS + 10); });
    const timers = vi.spyOn(globalThis, "setTimeout");
    act(() => { for (let i = 0; i < 100; i++) fireEvent.pointerMove(window, { clientX: i }); });
    expect(timers.mock.calls.length).toBeLessThanOrEqual(1);           // 100 moves, one doze reset
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(SLEEP_AFTER_MS / 2); fireEvent.pointerMove(window, { clientX: i }); });
    expect(screen.getByTestId("mood").textContent).toBe("idle");
  });
});

describe("dialogue and loading (two worlds, Stage 3)", () => {
  it("a typewriter types its text out; screen readers get all of it at once", () => {
    const { container } = render(<Typewriter text="A new page was added." cps={100} />);
    expect(container.querySelector(".sr-only")!.textContent).toBe("A new page was added.");
    expect(container.querySelector(".typewriter")!.textContent).toBe("");
    act(() => { vi.advanceTimersByTime(60); });
    expect(container.querySelector(".typewriter")!.textContent!.length).toBeGreaterThan(2);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector(".typewriter")!.textContent).toBe("A new page was added.");
  });

  it("a loading screen shows a tip or a line of lore, and moves on to another", () => {
    render(<LoreTip every={1000} />);
    const first = screen.getByTestId("lore-tip").textContent;
    expect(LORE_TIPS).toContain(first);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("lore-tip").textContent).not.toBe(first);
  });
});
