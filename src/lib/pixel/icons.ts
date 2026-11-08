/**
 * Item icons for shop and inventory cards, drawn by the pixel engine (same ramps, shading and outline as the
 * champions), so a card shows exactly the skin the champion will wear.
 *
 *   armor    -> the outfit as a tunic in its palette (plate shows as a breastplate and pauldrons)
 *   headgear -> the head piece on its own
 *   weapon   -> the CHAMPION'S weapon in that finish (a katana for Kaien, a staff for Mira...)
 *   pet      -> the pet's first idle frame
 *   potion   -> a flask in its colour;  title -> a medal on a ribbon
 *
 * Every icon is a square buffer (cropped to the art, then centred), so CSS can scale it with nearest neighbour.
 */
import { PixelBuffer } from "./buffer";
import { hex, ramp, shift, type Material } from "./color";
import { heroById } from "./heroes";
import { petFrame } from "./pets";
import { drawHeroHead, drawWeaponAt, HERO_BUILD, type HumanoidLook, type Skeleton } from "./rig";
import { ARMOR_SKINS, HEAD_SKINS, RARITY_GLOW, WEAPON_SKINS, dressed, masteryOwner } from "./skins";

export type ItemKind = "headgear" | "armor" | "weapon" | "pet" | "potion" | "title" | "emote" | "none";

const POTIONS: Record<string, { liquid: string; shape: "round" | "tall" | "big" | "split" | "swirl" }> = {
  potion_health_small: { liquid: "#ef4444", shape: "round" },
  fifty_fifty: { liquid: "#a78bfa", shape: "split" },
  potion_xp_boost: { liquid: "#22c55e", shape: "tall" },
  potion_coin_boost: { liquid: "#facc15", shape: "tall" },
  potion_streak_shield: { liquid: "#38bdf8", shape: "round" },
  potion_xp_boost_2h: { liquid: "#4ade80", shape: "big" },
  potion_quest_reset: { liquid: "#2dd4bf", shape: "swirl" },
};

/** Which slot an item belongs to (shop ids carry their slot as a prefix; potions are listed above). */
export function kindOf(id: string): ItemKind {
  const mastery = /^mastery_[a-z]+_(outfit|head|weapon)$/.exec(id);
  if (mastery) return ({ outfit: "armor", head: "headgear", weapon: "weapon" } as const)[mastery[1] as "outfit" | "head" | "weapon"];
  if (id.startsWith("hat_")) return "headgear";
  if (id.startsWith("armor_")) return "armor";
  if (id.startsWith("weapon_")) return "weapon";
  if (id.startsWith("pet_")) return "pet";
  if (id.startsWith("title_")) return "title";
  if (id in POTIONS || id.startsWith("potion_")) return "potion";
  if (id.startsWith("emote_")) return "emote";
  return "none";
}

const OUTLINE = hex("#0b0a12");
const W = 48;

function armorIcon(b: PixelBuffer, id: string) {
  const p = ARMOR_SKINS[id];
  if (!p) return;
  const main = ramp(p.main, { contrast: 1.15 }), second = ramp(p.second), trim = p.glow ? ramp(p.trim, { emissive: true }) : ramp(p.trim);
  const cx = 24, top = 10;
  // sleeves, then the tunic body over them
  b.capsule(cx - 9, top + 3, cx - 15, top + 17, 3.6, 3, main);
  b.capsule(cx + 9, top + 3, cx + 15, top + 17, 3.6, 3, main);
  b.poly([[cx - 10, top], [cx + 10, top], [cx + 9, top + 20], [cx + 11, top + 28], [cx - 11, top + 28], [cx - 9, top + 20]], main);
  // collar showing the second cloth
  b.poly([[cx - 4, top], [cx + 4, top], [cx, top + 8]], second, { clip: true });
  if (p.metal) {
    const m = ramp(p.metal, { shiny: true });
    b.ellipse(cx, top + 9, 8, 6.5, m, { bias: 0.15 });
    b.ellipse(cx - 10, top + 2, 4.5, 3.6, m, {}, -0.35);
    b.ellipse(cx + 10, top + 2, 4.5, 3.6, m, {}, 0.35);
  }
  b.capsule(cx - 10, top + 19, cx + 10, top + 19, 1.8, 1.8, trim, { smooth: true });
  b.ellipse(cx + 3, top + 19, 1.8, 1.8, trim);
}

/** A plain grey head that shows how a head piece sits (icons only). */
const MANNEQUIN: HumanoidLook = {
  build: HERO_BUILD, scale: 1, skin: ramp("#aab1c9"), eye: ramp("#64748b"), top: ramp("#aab1c9"), topStyle: "bare",
  sleeves: "none", pants: ramp("#aab1c9"), boots: ramp("#aab1c9"), weapon: "none",
};

function headIcon(b: PixelBuffer, id: string) {
  const make = HEAD_SKINS[id];
  if (!make) return;
  const s = 1.9;
  const headC: [number, number] = [22, 26];
  const k = { headC, neck: [headC[0] - 1, headC[1] + HERO_BUILD.headR * s * 0.92] as [number, number], s } as unknown as Skeleton;
  drawHeroHead(b, k, {}, { ...MANNEQUIN, scale: s, headgear: make() });
}

function weaponIcon(b: PixelBuffer, id: string, heroId: string, rarity?: string | null) {
  if (!WEAPON_SKINS[id]) return;
  const hero = dressed(heroById(masteryOwner(id) ?? heroId), { weapon: id }, { weapon: rarity });   // a mastery weapon: its own champion's
  const kind = hero.look.weapon;
  // long weapons from a low hand; short ones nearer the middle
  const long = kind === "spear" || kind === "staff" || kind === "greatsword";
  const hand: [number, number] = long ? [16, 34] : kind === "gauntlets" ? [24, 26] : [17, 33];
  drawWeaponAt(b, hero.look, hand, 135, long ? 0.82 : 1.15);
}

function potionIcon(b: PixelBuffer, id: string) {
  const p = POTIONS[id] ?? { liquid: "#a78bfa", shape: "round" as const };
  const glass = ramp("#c7d2fe", { contrast: 0.8 }), liquid = ramp(p.liquid), cork = ramp("#a16207");
  const cx = 24;
  const [bodyR, bodyH, bodyY] = p.shape === "tall" ? [6.5, 11, 30] : p.shape === "big" ? [10, 9.5, 30] : [8.5, 8.5, 31];
  b.capsule(cx, 12, cx, 19, 2.6, 2.6, glass);
  b.ellipse(cx, bodyY, bodyR, bodyH, glass);
  b.ellipse(cx, bodyY + 2, bodyR - 1.2, bodyH - 2.2, liquid, { clip: true });
  if (p.shape === "split") b.poly([[cx, bodyY - bodyH], [cx + bodyR, bodyY - bodyH], [cx + bodyR, bodyY + bodyH], [cx, bodyY + bodyH]], ramp("#f5f3ff"), { clip: true });
  if (p.shape === "swirl") for (let i = 0; i < 6; i++) { const a = i * 1.1; b.set(Math.round(cx + Math.cos(a) * i * 0.9), Math.round(bodyY + 2 + Math.sin(a) * i * 0.9), liquid.ramp[4]); }
  b.capsule(cx, 9, cx, 12, 2.8, 2.8, cork);
  // the glint
  b.set(cx - Math.round(bodyR * 0.5), bodyY - Math.round(bodyH * 0.45), hex("#ffffff"));
  b.set(cx - Math.round(bodyR * 0.5), bodyY - Math.round(bodyH * 0.45) + 1, hex("#e0e7ff"));
}

const RIBBON: Record<string, string> = { common: "#64748b", rare: "#2563eb", epic: "#7c3aed", legendary: "#e11d48" };

function titleIcon(b: PixelBuffer, rarity?: string | null) {
  const r = RIBBON[rarity ?? "common"] ?? RIBBON.common;
  const ribbonA = ramp(r), ribbonB = ramp(r, { contrast: 1.4 }), gold = ramp("#eab308", { shiny: true });
  b.poly([[17, 6], [23, 6], [27, 24], [21, 24]], ribbonB);
  b.poly([[31, 6], [25, 6], [21, 24], [27, 24]], ribbonA);
  b.ellipse(24, 30, 9, 9, gold);
  b.ellipse(24, 30, 5.2, 5.2, ramp("#facc15", { shiny: true }), { bias: -0.15 });
  b.poly([[24, 25.5], [25.4, 28.6], [28.6, 29], [26.1, 31.2], [26.8, 34.4], [24, 32.8], [21.2, 34.4], [21.9, 31.2], [19.4, 29], [22.6, 28.6]], ramp("#fef3c7"));
}

// ── emotes (Stage A2): a speech bubble with a small glyph, in the emote's colour ──────────────────────────────────
/** 7x7 glyphs, one string per row ("#" = ink). */
const GLYPHS: Record<string, { color: string; rows: string[] }> = {
  emote_gg: { color: "#4ade80", rows: ["###.###", "#...#..", "#.#.#.#", "#.#.#.#", "###.###", ".......", "......."] },
  emote_bow: { color: "#93c5fd", rows: ["..###..", "..###..", "...#...", "######.", "#####..", ".#...#.", "#.....#"] },
  emote_flex: { color: "#facc15", rows: ["...#...", "..###..", "#######", ".#####.", "..###..", ".##.##.", "##...##"] },
  emote_laugh: { color: "#fb923c", rows: [".#####.", "#.#.#.#", "#######", "#.....#", "#.###.#", ".#...#.", "..###.."] },
  emote_taunt: { color: "#f87171", rows: ["...##..", "...##..", "...##..", "...##..", "...##..", ".......", "...##.."] },
  emote_dance: { color: "#c084fc", rows: ["..####.", "..#..#.", "..#..#.", "..#..#.", "###.###", "###.###", "......."] },
  emote_heart: { color: "#f43f5e", rows: [".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."] },
  emote_book: { color: "#fbbf24", rows: ["##...##", "###.###", "###.###", "###.###", "###.###", "##...##", "#.....#"] },
  emote_crown: { color: "#facc15", rows: ["#..#..#", "##.#.##", "#######", "#######", "#######", ".......", "#######"] },
  emote_skull: { color: "#e5e7eb", rows: [".#####.", "#######", "#.###.#", "#######", ".##.##.", ".#####.", ".#.#.#."] },
};
function emoteIcon(b: PixelBuffer, id: string) {
  const g = GLYPHS[id] ?? GLYPHS.emote_gg;
  const paper = ramp("#f8fafc");
  // the bubble, with its tail at the bottom left
  b.ellipse(24, 21, 16, 13, paper, { bias: -0.2 });
  b.poly([[14, 29], [20, 32], [11, 38]], paper);
  const mid = hex(g.color), dark = shift(g.color, -0.2);
  g.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== "#") return;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) b.set(17 + x * 2 + dx, 14 + y * 2 + dy, dy === 0 ? mid : dark);
  }));
}

const cache = new Map<string, PixelBuffer>();

/** Crop to what was drawn and centre it in a square (so CSS scaling keeps the art in the middle). */
function squared(src: PixelBuffer): PixelBuffer {
  const [x, y, w, h] = src.bounds();
  if (!w) return src;
  const side = Math.max(w, h) + 2;
  const out = new PixelBuffer(side, side);
  const ox = Math.floor((side - w) / 2), oy = Math.floor((side - h) / 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = src.px[(y + j) * src.w + (x + i)];
    if (c) out.px[(oy + j) * side + (ox + i)] = c;
  }
  return out;
}

/**
 * The icon for an item (cached). Weapons depend on the champion (they show that champion's weapon) and glow in
 * the weapon's rarity. Unknown ids give null (the card shows its fallback).
 */
export function itemIcon(itemId: string, opts: { heroId?: string; rarity?: string | null } = {}): PixelBuffer | null {
  const kind = kindOf(itemId);
  if (kind === "none") return null;
  const glow = opts.rarity && RARITY_GLOW[opts.rarity] ? opts.rarity : "";
  const key = kind === "weapon" ? `${itemId}:${opts.heroId ?? ""}:${glow}` : kind === "title" ? `${itemId}:${opts.rarity ?? ""}` : itemId;
  const hit = cache.get(key);
  if (hit) return hit;
  let b = new PixelBuffer(W, W);
  if (kind === "armor") armorIcon(b, itemId);
  else if (kind === "headgear") headIcon(b, itemId);
  else if (kind === "weapon") weaponIcon(b, itemId, opts.heroId ?? "kaien", glow || null);
  else if (kind === "potion") potionIcon(b, itemId);
  else if (kind === "title") titleIcon(b, opts.rarity);
  else if (kind === "emote") emoteIcon(b, itemId);
  else if (kind === "pet") {
    const f = petFrame(itemId, 0);
    if (f) b = new PixelBuffer(f.w, f.h), b.blit(f, 0, 0);
  }
  if (kind !== "pet") b.outline(OUTLINE);
  const out = squared(b);
  if (!out.bounds()[2]) return null;
  cache.set(key, out);
  return out;
}
