import { describe, expect, it } from "vitest";
import { fill, formatCount, formatInr, untilText } from "./plans";

describe("plan helpers", () => {
  it("fills a meter: ok, near at 80%, full at 100%, and nothing allowed", () => {
    expect(fill(10, 100)).toEqual({ share: 0.1, state: "ok" });
    expect(fill(80, 100).state).toBe("near");
    expect(fill(130, 100)).toEqual({ share: 1, state: "full" });
    expect(fill(0, 0)).toEqual({ share: 0, state: "ok" });
    expect(fill(1, 0).state).toBe("full");
  });

  it("formats rupees, and big counts short", () => {
    expect(formatInr(149)).toBe("₹149");
    expect(formatInr(5990)).toBe("₹5,990");
    expect(formatCount(9999)).toBe("9,999");
    expect(formatCount(300_000)).toBe("300K");
    expect(formatCount(3_000_000)).toBe("3M");
  });

  it("says when a limit resets", () => {
    const now = Date.parse("2026-11-04T10:00:00Z");
    expect(untilText("2026-11-04T10:20:00Z", now)).toBe("in 20 min");
    expect(untilText("2026-11-05T00:00:00Z", now)).toBe("in 14 h");
    expect(untilText("2026-12-01T00:00:00Z", now)).toBe("on 1 Dec");
    expect(untilText("2026-11-01T00:00:00Z", now)).toBe("now");
  });
});
