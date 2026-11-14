"use client";

import type { ReactNode } from "react";
import { Lock } from "@/components/ui/icons";
import { Badge } from "@/components/ui";
import GearChips from "@/components/champion/GearChips";
import ItemArt from "@/components/champion/ItemArt";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/game/rarity";
import { cn } from "@/lib/utils";
import type { ShopItem } from "@/hooks/useHero";

export interface ItemCardProps {
  item: ShopItem;
  equipped?: boolean;
  /** This item is the one in the preview panel. */
  previewed?: boolean;
  locked?: boolean;
  /** How many the hero holds (consumables); shown as "x3" when above 1. */
  count?: number;
  /** Clicking the card (its picture and name) opens it in the preview panel. */
  onOpen?: () => void;
  /** Between the description and the actions: price, stack info ... */
  meta?: ReactNode;
  /** Extra lines under the description (an active-buff timer ...). */
  extra?: ReactNode;
  /** The action buttons. */
  children?: ReactNode;
}

/**
 * One item as a compact tile, drawn the same in the shop and the inventory: rarity border and label from the rarity
 * tokens (lib/game/rarity.ts), state in words as well as colour. The picture and name are one button that opens
 * the item in the preview panel, where the full description, stats and bonuses are; the tile keeps two lines.
 */
export default function ItemCard({ item, equipped, previewed, locked, count, onOpen, meta, extra, children }: ItemCardProps) {
  const rarity = rarityOf(item);
  const face = (
    <>
      <span className="hero-item__sprite"><ItemArt itemId={item.id} size={72} rarity={rarity} /></span>
      <span className="hero-item__name">{item.name}</span>
    </>
  );
  return (
    <li className={cn("hero-item", rarityClass(rarity), equipped && "hero-item--equipped", previewed && "hero-item--preview", locked && "hero-item--locked")}
      data-rarity={rarity} data-item-id={item.id}>
      <div className="hero-item__top">
        <Badge tone={rarity}>{RARITY_LABEL[rarity]}</Badge>
        {equipped && <Badge tone="success">Equipped</Badge>}
        {locked && <Badge><Lock size={10} aria-hidden="true" />Lv {item.level_required}</Badge>}
        {!!count && count > 1 && <Badge>×{count}</Badge>}
      </div>
      {onOpen ? (
        <button type="button" className="hero-item__open" onClick={onOpen} aria-pressed={!!previewed} aria-label={`Preview ${item.name}`}>{face}</button>
      ) : (
        <div className="hero-item__open">{face}</div>
      )}
      <p className="hero-item__desc">{item.description}</p>
      <GearChips stats={item.battle} className="hero-item__gear" />
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
