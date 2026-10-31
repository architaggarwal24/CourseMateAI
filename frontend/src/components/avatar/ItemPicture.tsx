"use client";
import { Award } from "lucide-react";
import ItemIcon, { kindOf } from "./ItemIcon";

/** An item's picture: its own art, or - for items without any (titles) - a medal. */
export default function ItemPicture({ itemId, size = 64, title }: { itemId: string; size?: number; title?: string }) {
  if (kindOf(itemId) === "none") {
    return <Award size={Math.round(size * 0.7)} strokeWidth={1.5} aria-hidden="true" style={{ color: "var(--color-reward)" }} />;
  }
  return <ItemIcon itemId={itemId} size={size} title={title} />;
}
