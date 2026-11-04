"use client";

import { useEffect, useRef } from "react";
import { useChampion } from "@/hooks/useChampion";
import { toCanvas } from "@/lib/pixel/canvas";
import { itemIcon } from "@/lib/pixel/icons";
import { cn } from "@/lib/utils";
import "./champion.css";

/**
 * An item's pixel icon (shop cards, inventory, loadout slots), drawn by the pixel engine so it matches the skin
 * the champion wears. Weapon skins show the player's own champion's weapon. Decorative unless `label` is given.
 */
export default function ItemArt({ itemId, size = 64, rarity, label, className }: {
  itemId: string; size?: number; rarity?: string | null; label?: string; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const heroId = useChampion((s) => s.championId);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.("2d");
    const buf = itemIcon(itemId, { heroId, rarity });
    if (!canvas || !ctx || !buf) return;
    canvas.width = buf.w; canvas.height = buf.h;
    ctx.clearRect(0, 0, buf.w, buf.h);
    ctx.drawImage(toCanvas(buf), 0, 0);
  }, [itemId, heroId, rarity]);
  return (
    <canvas
      ref={ref}
      className={cn("pixel-canvas item-art", className)}
      style={{ width: size, height: size }}
      data-item={itemId}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
