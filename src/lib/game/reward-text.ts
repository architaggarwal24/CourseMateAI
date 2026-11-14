/** "+50 XP · +25 coins": how a reward reads in a toast or a line (no emoji, one separator, coins in lower case). */
export function rewardText(xp?: number | null, coins?: number | null): string {
  return [xp ? `+${xp.toLocaleString()} XP` : "", coins ? `+${coins.toLocaleString()} ${coins === 1 ? "coin" : "coins"}` : ""].filter(Boolean).join(" · ");
}
