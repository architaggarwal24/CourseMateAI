// Victory emotes and taunt lines (Stage A2). The server says which emotes a player has (GET /emotes); this says how
// each one is acted out: the champion's pose, the bubble over it, and how it moves.
import type { AnimName } from "@/lib/pixel/heroes";

export interface EmoteDef { name: string; anim: AnimName; bubble: string; motion: "hop" | "sway" | "pulse" | "bounce" | "none"; sparkle?: boolean }

export const EMOTES: Record<string, EmoteDef> = {
  emote_gg: { name: "GG", anim: "win", bubble: "GG!", motion: "bounce" },
  emote_bow: { name: "Bow", anim: "guard", bubble: "Well fought.", motion: "none" },
  emote_flex: { name: "Flex", anim: "cast", bubble: "Too easy!", motion: "pulse", sparkle: true },
  emote_laugh: { name: "Laugh", anim: "win", bubble: "HA HA HA!", motion: "hop" },
  emote_taunt: { name: "Come At Me", anim: "attack", bubble: "Next!", motion: "bounce" },
  emote_dance: { name: "Victory Dance", anim: "dash", bubble: "♪ ♪ ♪", motion: "sway", sparkle: true },
  emote_heart: { name: "Heart", anim: "win", bubble: "♥", motion: "pulse" },
  emote_book: { name: "Lore Nod", anim: "cast", bubble: "Noted.", motion: "none" },
  emote_crown: { name: "Crown", anim: "win", bubble: "Bow before me.", motion: "pulse", sparkle: true },
  emote_skull: { name: "Skull", anim: "attack", bubble: "Nightmare? Easy.", motion: "bounce" },
};
export const EMOTE_ORDER = Object.keys(EMOTES);

/** What each champion shouts when taunting a boss. */
export const TAUNT_LINES: Record<string, string[]> = {
  kaien: ["Is that all the ninth page has?", "Draw. I'll wait."],
  asha: ["Come closer. My spear is lonely.", "The wall holds. Try harder."],
  brak: ["Hit me! I dare you!", "My grandma swings harder."],
  mira: ["I've read scarier footnotes.", "Your weakness is on page one."],
  vex: ["Over here. No, here.", "You blinked. I didn't."],
  thorne: ["My shield is bored.", "Strike. It changes nothing."],
};
export const tauntLine = (champion: string, seed = 0) => {
  const lines = TAUNT_LINES[champion] ?? TAUNT_LINES.kaien;
  return lines[Math.abs(seed) % lines.length];
};
