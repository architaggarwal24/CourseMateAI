"use client";

import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui";
import { GearChips, ItemPicture } from "@/components/avatar";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/rarity";
import { cn } from "@/lib/utils";
import { usePointerVars } from "@/components/fx/usePointerVars";
import type { ShopItem } from "@/hooks/useHero";

export interface ItemCardProps {
  item: ShopItem;
  equipped?: boolean;
  previewed?: boolean;
  locked?: boolean;
  /** How many the hero holds (consumables); shown as "x3" when above 1. */
  count?: number;
  /** Makes the sprite a button (shop: try the item on). */
  onPreview?: () => void;
  /** Between the description and the actions: price, stack info ... */
  meta?: ReactNode;
  /** Extra lines under the description (an active-buff timer ...). */
  extra?: ReactNode;
  /** The action buttons. */
  children?: ReactNode;
}

/**
 * One item, drawn the same in the shop and the inventory: its border and its rarity label come from the rarity
 * tokens (lib/rarity.ts), state is always said in words as well as colour.
 */
export default function ItemCard({ item, equipped, previewed, locked, count, onPreview, meta, extra, children }: ItemCardProps) {
  const rarity = rarityOf(item);
  const sprite = <ItemPicture itemId={item.id} size={88} />;
  const pointer = usePointerVars<HTMLLIElement>();
  return (
    <li ref={pointer} className={cn("hero-item fx-spotlight", rarityClass(rarity), equipped && "hero-item--equipped", previewed && "hero-item--preview", locked && "hero-item--locked")} data-rarity={rarity} data-item-id={item.id}>
      {rarity === "legendary" && <span className="fx-ring" aria-hidden="true" />}
      <div className="hero-item__top">
        <Badge tone={rarity}>{RARITY_LABEL[rarity]}</Badge>
        {equipped && <Badge tone="success">Equipped</Badge>}
        {previewed && <Badge tone="accent">Preview</Badge>}
        {locked && <Badge><Lock size={10} aria-hidden="true" />Lv {item.level_required}</Badge>}
        {!!count && count > 1 && <Badge>×{count}</Badge>}
      </div>

      {onPreview ? (
        <button type="button" className="hero-item__sprite" onClick={onPreview} aria-pressed={!!previewed} aria-label={`${previewed ? "Stop previewing" : "Preview"} ${item.name}`}>
          {sprite}
        </button>
      ) : (
        <div className="hero-item__sprite" aria-hidden="true">{sprite}</div>
      )}

      <h3 className="hero-item__name">{item.name}</h3>
      <p className="hero-item__desc">{item.description}</p>
      <GearChips stats={item.battle} />
      {extra}
      {meta && <div className="hero-item__meta">{meta}</div>}
      {children && <div className="hero-item__actions">{children}</div>}
    </li>
  );
}

/** A price in coins (the label font: it is a number). */
export function Price({ amount, muted }: { amount: number; muted?: boolean }) {
  return <span className="hero-item__price" data-muted={muted || undefined}>{amount > 0 ? <><span className="pixel-font">{amount}</span> coins</> : "Free"}</span>;
}
