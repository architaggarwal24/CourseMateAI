import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import Meter, { meterTone } from "./Meter";
import Button from "./Button";
import Card from "./Card";
import { useFeedback } from "./useFeedback";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Meter (redesign Stage 2: one meter for every Study bar)", () => {
  it("is a labelled progressbar with its range, and the fill is a share of the track", () => {
    render(<Meter label="Quiz progress" value={3} max={12} valueText="Question 3 of 12" />);
    const bar = screen.getByRole("progressbar", { name: "Quiz progress" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("12");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuetext")).toBe("Question 3 of 12");
    expect((bar.firstElementChild as HTMLElement).style.getPropertyValue("--meter")).toBe("0.25");
  });

  it("clamps out-of-range values, and a zero range never divides by zero", () => {
    const { rerender } = render(<Meter label="m" value={15} max={10} />);
    const bar = () => screen.getByRole("progressbar");
    expect(bar().getAttribute("aria-valuenow")).toBe("10");
    expect((bar().firstElementChild as HTMLElement).style.getPropertyValue("--meter")).toBe("1");
    rerender(<Meter label="m" value={-3} max={10} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    rerender(<Meter label="m" value={0} max={0} />);
    expect(bar().getAttribute("aria-valuemax")).toBe("1");
    expect((bar().firstElementChild as HTMLElement).style.getPropertyValue("--meter")).toBe("0");
  });

  it("carries a tone and a size for the stylesheet, and can be named by another element", () => {
    render(<><span id="lbl">Usage</span><Meter labelledBy="lbl" value={1} tone="warning" size="sm" className="extra" /></>);
    const bar = screen.getByRole("progressbar", { name: "Usage" });
    expect(bar.className).toContain("ui-meter");
    expect(bar.className).toContain("extra");
    expect(bar.dataset.tone).toBe("warning");
    expect(bar.dataset.size).toBe("sm");
  });

  it("meterTone: accent until 80%, warning from 80%, danger when full", () => {
    expect(meterTone(0.5)).toBe("accent");
    expect(meterTone(0.8)).toBe("warning");
    expect(meterTone(1)).toBe("danger");
    expect(meterTone(1.4)).toBe("danger");
  });
});

describe("Button feedback (confirm states)", () => {
  it("shows a check after it worked and a cross when it failed, keeping its label", () => {
    const { rerender } = render(<Button feedback="success">Copy</Button>);
    const btn = screen.getByRole("button", { name: "Copy" });
    expect(btn.dataset.feedback).toBe("success");
    expect(btn.querySelector(".ui-btn__mark")).not.toBeNull();
    rerender(<Button feedback="error">Copy</Button>);
    expect(btn.dataset.feedback).toBe("error");
    rerender(<Button>Copy</Button>);
    expect(btn.dataset.feedback).toBeUndefined();
    expect(btn.querySelector(".ui-btn__mark")).toBeNull();
  });

  it("the mark is decorative (the label stays the accessible name)", () => {
    render(<Button feedback="success">Save</Button>);
    expect(screen.getByRole("button").querySelector(".ui-btn__mark")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("useFeedback", () => {
  it("flashes a state and clears it after a moment; a new flash restarts the clock", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedback(1000));
    expect(result.current.feedback).toBeUndefined();
    act(() => result.current.flash("success"));
    expect(result.current.feedback).toBe("success");
    act(() => { vi.advanceTimersByTime(600); });
    act(() => result.current.flash("error"));
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.feedback).toBe("error");
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.feedback).toBeUndefined();
  });

  it("stops its timer when the component goes away", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useFeedback(1000));
    act(() => result.current.flash("success"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Card depth", () => {
  it("lit lays the one light layer on; raised floats", () => {
    render(<Card lit raised data-testid="c">x</Card>);
    const card = screen.getByTestId("c");
    expect(card.className).toContain("lit");
    expect(card.className).toContain("ui-card--raised");
  });
});
