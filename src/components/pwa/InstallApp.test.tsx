import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import InstallApp from "./InstallApp";
import { startPwa, usePwa } from "@/lib/pwa";

afterEach(() => { cleanup(); usePwa.setState({ prompt: null, installed: false }); });

describe("install the app", () => {
  it("offers the browser's install prompt once it arrives, and says when it's installed", async () => {
    startPwa();
    render(<InstallApp />);
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    const prompt = vi.fn(async () => {});
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);                                   // the app decides when to ask
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Install app" })); });
    expect(prompt).toHaveBeenCalled();
    expect(screen.getByText("CourseMateAI is installed on this device.")).toBeTruthy();
  });
});
