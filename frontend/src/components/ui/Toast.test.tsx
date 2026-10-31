import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";


import { ToastHost, toast } from "./Toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { act(() => toast.dismiss()); cleanup(); vi.useRealTimers(); });

describe("Toast", () => {
  it("shows a message, announces errors as alerts, and goes away after its duration", () => {
    render(<ToastHost />);
    act(() => { toast.success("Saved"); toast.error("Broke"); });
    expect(screen.getByRole("status").textContent).toContain("Saved");
    expect(screen.getByRole("alert").textContent).toContain("Broke");
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.getByText("Broke")).toBeTruthy();              // errors stay longer
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText("Broke")).toBeNull();
  });

  it("can be dismissed with its button, and stays while hovered", () => {
    render(<ToastHost />);
    act(() => { toast.info("Hello", { description: "more" }); });
    const el = screen.getByRole("status");
    fireEvent.mouseEnter(el);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByText("Hello")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("is an always-present polite live region; errors inside it are assertive alerts", () => {
    render(<ToastHost />);
    const host = screen.getByRole("region", { name: "Notifications" });
    expect(host.getAttribute("aria-live")).toBe("polite");
    expect(host.getAttribute("aria-relevant")).toContain("additions");
    act(() => { toast.error("Broke"); toast.info("FYI"); });
    expect(within(host).getByRole("alert").textContent).toContain("Broke");
    expect(within(host).getByRole("status").textContent).toContain("FYI");
  });

  it("takes the Play theme when raised while a Play screen is on the page", () => {
    render(<div data-theme="play" />);
    render(<ToastHost />);
    act(() => { toast.info("Loot"); });
    expect(screen.getByRole("status").closest("[data-theme]")?.getAttribute("data-theme")).toBe("play");
  });
});
