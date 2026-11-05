import { describe, expect, it } from "vitest";
import { formatInterval } from "./review";
import { dueBadge, featureEnabled } from "@/hooks/useReview";

describe("review helpers", () => {
  it("says when a card comes back in a few characters", () => {
    expect([30, 60, 330, 3600 * 5, 86400 * 8, 86400 * 95, 86400 * 400, 86400 * 365 * 12].map(formatInterval))
      .toEqual(["<1m", "1m", "6m", "5h", "8d", "3mo", "1.1y", "12y"]);
  });

  it("the badge counts due cards only when reviewing is on", () => {
    const s = { due: 7, locked: false } as never;
    expect(dueBadge(s)).toBe(7);
    expect(dueBadge({ due: 7, locked: true } as never)).toBe(0);
    expect(dueBadge(null)).toBe(0);
  });

  it("a feature counts as on until the entitlements say otherwise (the server is the real gate)", () => {
    expect(featureEnabled(null, "exam_mode")).toBe(true);
    const ent = { tier: "scholar", tier_name: "Scholar", features: {
      review_queue: { enabled: true, name: "", required_tier: "scholar", required_tier_name: "Scholar" },
      exam_mode: { enabled: false, name: "", required_tier: "sage", required_tier_name: "Sage" } } };
    expect(featureEnabled(ent, "review_queue")).toBe(true);
    expect(featureEnabled(ent, "exam_mode")).toBe(false);
  });
});
