"use client";
// An item's picture for shop cards, inventory slots and pickers: the same art the hero wears, shown on its own.
import { useId } from "react";
import { cn } from "@/lib/utils";
import { bodyOf, type SkinTone } from "@/lib/avatar/look";
import { Arm, CX, Legs, Shoes, Torso } from "./art/body";
import { outfitOf } from "./art/armor";
import { hatOf } from "./art/headgear";
import { petOf } from "./art/pets";
import { POTIONS, POTION_BOX } from "./art/potions";
import { ArtRoot } from "./art/primitives";
import { weaponOf } from "./art/weapons";

export type ItemKind = "headgear" | "armor" | "weapon" | "pet" | "potion" | "none";

/** Which slot an item id belongs to (ids carry their slot as a prefix). */
export function kindOf(id: string): ItemKind {
  if (id.startsWith("hat_")) return "headgear";
  if (id.startsWith("armor_")) return "armor";
  if (id.startsWith("weapon_")) return "weapon";
  if (id.startsWith("pet_")) return "pet";
  if (id in POTIONS) return "potion";
  return "none";
}

const MANNEQUIN: SkinTone = { id: "mannequin", label: "Mannequin", b: "#cfd5e8", m: "#b3bad3", d: "#9aa2c0", o: "#1c1530" };

export interface ItemIconProps { itemId: string; size?: number; className?: string; title?: string }

export default function ItemIcon({ itemId, size = 56, className, title }: ItemIconProps) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const kind = kindOf(itemId);
  let box: [number, number, number, number] = [0, 0, 100, 100];
  let content: React.ReactNode = null;

  if (kind === "headgear") {
    const hat = hatOf(itemId);
    if (hat) { box = hat.box; content = hat.draw(); }
  } else if (kind === "armor") {
    const b = bodyOf("male_default");
    const o = outfitOf(itemId), ctx = { b, skin: MANNEQUIN };
    box = [30, 122, 140, 156];
    content = (
      <g>
        {o.back?.(ctx)}
        <Legs b={b} skin={MANNEQUIN} />{o.legs?.(ctx)}{!o.hideFeet && <Shoes b={b} color={o.shoes ?? "#f4f1fb"} />}
        <Torso b={b} skin={MANNEQUIN} />{o.torso?.(ctx)}
        {([-1, 1] as const).map((s) => (
          <g key={s} transform={`translate(${CX + s * (b.sw / 2 - 5)} 152)`}><g style={{ transform: `rotate(${-s * 9}deg)` }}><Arm b={b} skin={MANNEQUIN} sleeve={o.sleeve} /></g></g>
        ))}
        {o.front?.(ctx)}
      </g>
    );
  } else if (kind === "weapon") {
    const w = weaponOf(itemId);
    if (w) { box = w.box; content = w.twin ? <g><g transform="translate(-14 0) rotate(-14)">{w.draw()}</g><g transform="translate(14 0) rotate(14)">{w.draw()}</g></g> : w.draw(); }
    if (w?.twin) box = [-60, -110, 120, 150];
  } else if (kind === "pet") {
    const p = petOf(itemId);
    if (p) { box = [-56, -92, 112, 102]; content = <g transform={`scale(${Math.min(1.1, 1.5 / p.scale)})`}>{p.draw()}</g>; }
  } else if (kind === "potion") {
    box = POTION_BOX; content = POTIONS[itemId];
  }

  const [x, y, w, h] = box;
  return (
    <svg viewBox={`${x - 6} ${y - 6} ${w + 12} ${h + 12}`} width={size} height={size} className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ overflow: "visible" }}>
      <ArtRoot id={gid}>{content}</ArtRoot>
    </svg>
  );
}
