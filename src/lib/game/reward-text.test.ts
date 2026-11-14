import { describe, expect, it } from "vitest";
import { rewardText } from "./reward-text";

describe("reward text", () => {
  it("reads as plain words with one separator", () => {
    expect(rewardText(50, 25)).toBe("+50 XP · +25 coins");
    expect(rewardText(1200, 1)).toBe("+1,200 XP · +1 coin");
    expect(rewardText(0, 10)).toBe("+10 coins");
    expect(rewardText(80, null)).toBe("+80 XP");
  });
});
