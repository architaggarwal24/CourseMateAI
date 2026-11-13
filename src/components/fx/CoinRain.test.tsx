import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import CoinRain from "./CoinRain";
import { useCelebrate } from "@/lib/fx/celebrate";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); useCelebrate.setState({ rain: null }); });

describe("coin rain", () => {
  it("its screen-sized canvas is only in the page while coins fall", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
    const ctx = { clearRect() {}, fillRect() {}, fillStyle: "" };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const { container } = render(<CoinRain />);
    expect(container.querySelector("canvas")).toBeNull();               // nothing to composite at rest
    act(() => { useCelebrate.getState().coinRain(120); });
    expect(container.querySelector("canvas.fx-coin-rain")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });                       // every coin has fallen
    expect(container.querySelector("canvas")).toBeNull();
  });
});
