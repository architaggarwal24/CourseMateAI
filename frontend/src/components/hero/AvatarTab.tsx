"use client";

import { useState } from "react";
import { ChevronDown, Crown, PawPrint, Shield, ShoppingBag, Sparkles, Swords, X, Zap } from "lucide-react";
import { GearChips, HeroFigure, ItemPicture } from "@/components/avatar";
import { lookFromEquipped } from "@/lib/avatar/look";
import { totalGear } from "@/lib/gear";
import { Badge, Button, ButtonLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useHUDStore } from "@/hooks/useHUD";
import { ownedItems, previewEquipped, useHeroStore, type ShopItem } from "@/hooks/useHero";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/rarity";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const SLOTS = [
  { key: "headgear", label: "Headgear", Icon: Crown },
  { key: "armor", label: "Armor", Icon: Shield },
  { key: "weapon", label: "Weapon", Icon: Swords },
  { key: "pet", label: "Pet", Icon: PawPrint },
] as const;

/** The bonuses of everything that is worn. */
export function activeBonuses(shop: { equipped: Record<string, string>; items: ShopItem[] }) {
  const out: { label: string; value: string }[] = [];
  for (const id of Object.values(shop.equipped ?? {})) {
    const b = shop.items.find((i) => i.id === id)?.bonus;
    if (!b) continue;
    if (b.xp_pct) out.push({ label: "XP", value: `+${Math.round(b.xp_pct * 100)}%` });
    if (b.coin_pct) out.push({ label: "Coins", value: `+${Math.round(b.coin_pct * 100)}%` });
    if (b.combo_xp_pct) out.push({ label: "Combo", value: `+${Math.round(b.combo_xp_pct * 100)}%` });
    if (b.arena_hints) out.push({ label: "Hints", value: `+${b.arena_hints}` });
  }
  return out;
}

/** The hero on show, and what it wears slot by slot. Picking an item wears it; hovering or focusing one tries it on. */
export default function AvatarTab() {
  const { user } = useAuth();
  const level = useHUDStore((s) => s.level);
  const shop = useHeroStore((s) => s.shop);
  const loading = useHeroStore((s) => s.loading);
  const previewId = useHeroStore((s) => s.previewId);
  const setPreview = useHeroStore((s) => s.setPreview);
  const equip = useHeroStore((s) => s.equip);
  const unequip = useHeroStore((s) => s.unequip);

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  if (loading || !shop) return <p role="status" className="p-6 text-fg-muted">Summoning hero…</p>;

  const equipped = shop.equipped ?? {};
  const owned = ownedItems(shop).filter((i) => !i.consumable);
  const equippedCount = Object.values(equipped).filter(Boolean).length;
  const bonuses = activeBonuses(shop);
  const worn = ["weapon", "armor", "headgear", "pet"].map((k) => shop.items.find((i) => i.id === (equipped[k] || (k === "armor" ? equipped.outfit_id : ""))));
  const totals = totalGear(worn as never);
  const gearTotals = Object.values(totals).some(Boolean) ? totals : null;

  return (
    <div className="hero-split">
      <aside className="hero-split__side" aria-label="Your hero">
        <div className="hero-stage" data-testid="avatar-stage">
          <HeroFigure look={lookFromEquipped(previewEquipped(shop, previewId))} size="min(100%, 16rem)" animate title="Your hero" />
        </div>
        <div className="mt-4 text-center">
          <Badge tone="reward">LV {level}</Badge>
          <h2 className="m-0 mt-2 text-lg font-bold text-fg">{(user?.username || "Hero").toUpperCase()}</h2>
          <p className="m-0 text-sm text-fg-muted">{equipped.title || "Aspiring Champion"}</p>
          {equippedCount >= 4 && <Badge tone="epic" className="mt-2">Full kit</Badge>}
          {previewId && <p className="m-0 mt-2 text-sm text-ink-purple">Previewing on your hero</p>}
        </div>
      </aside>

      <section className="hero-split__main max-w-3xl" aria-label="Equipment">
        <div className="flex flex-wrap gap-2 mb-5">
          <ButtonLink href={ROUTES.heroForge} variant="primary"><Sparkles size={16} aria-hidden="true" />Hero Forge</ButtonLink>
          <ButtonLink href={ROUTES.heroShop}><ShoppingBag size={16} aria-hidden="true" />Shop</ButtonLink>
          <ButtonLink href={ROUTES.heroInventory}>Inventory</ButtonLink>
        </div>

        <div className="mb-5" data-testid="arena-gear">
          <p className="hero-label">In the arena</p>
          {gearTotals ? <GearChips stats={gearTotals} /> : <p className="m-0 text-sm text-fg-muted">Wear a weapon, armor, headgear or a pet to get an edge in battle.</p>}
        </div>

        {bonuses.length > 0 && (
          <div className="mb-5">
            <p className="hero-label"><Zap size={12} className="inline mr-1" aria-hidden="true" />Study bonuses</p>
            <div className="flex flex-wrap gap-2">
              {bonuses.map((b, i) => (
                <span key={i} className="hero-bonus"><span>{b.label}</span><strong className="pixel-font">{b.value}</strong></span>
              ))}
            </div>
          </div>
        )}

        <p className="hero-label">Equipment ({equippedCount}/4)</p>
        <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2">
          {SLOTS.map(({ key, label, Icon }) => {
            const worn = shop.items.find((i) => i.id === equipped[key]);
            const choices = owned.filter((i) => i.category === key);
            const open = openSlot === key;
            const drawer = `slot-${key}`;
            return (
              <li key={key} className={cn("border border-line rounded-lg bg-panel", worn && rarityClass(rarityOf(worn)))} style={worn ? { borderColor: "var(--rarity)" } : undefined}>
                <button
                  type="button"
                  className="w-full min-h-11 flex items-center gap-3 p-3 text-left bg-transparent text-fg"
                  aria-expanded={open}
                  aria-controls={drawer}
                  onClick={() => setOpenSlot(open ? null : key)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-fg-2 uppercase">{label}</span>
                    <span className="block text-sm font-semibold truncate">{worn ? worn.name : "— empty —"}</span>
                    {worn && <span className="block text-xs" style={{ color: "var(--rarity)" }}>{RARITY_LABEL[rarityOf(worn)]}</span>}
                  </span>
                  {worn && <ItemPicture itemId={worn.id} size={40} />}
                  <ChevronDown size={14} aria-hidden="true" className={open ? "rotate-180" : ""} />
                </button>

                {open && (
                  <div id={drawer} className="p-3 border-t border-line">
                    {worn && (
                      <Button size="sm" className="mb-3" onClick={() => { void unequip(key, worn.name); setOpenSlot(null); }}>
                        <X size={12} aria-hidden="true" />Unequip
                      </Button>
                    )}
                    {choices.length === 0 ? (
                      <div className="text-sm text-fg-muted">
                        <p className="m-0 mb-2">No {label.toLowerCase()} owned</p>
                        <ButtonLink size="sm" href={ROUTES.heroShop}>Visit shop →</ButtonLink>
                      </div>
                    ) : (
                      <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                        {choices.map((item) => {
                          const isWorn = item.id === equipped[key];
                          const r = rarityOf(item);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                className={cn("min-h-11 min-w-11 p-2 rounded-md border-2 bg-canvas flex flex-col items-center gap-1 text-xs text-fg-2", rarityClass(r))}
                                style={{ borderColor: "var(--rarity)" }}
                                aria-pressed={isWorn}
                                aria-label={`${isWorn ? "Unequip" : "Equip"} ${item.name}`}
                                title={item.name}
                                onMouseEnter={() => setPreview(item.id)}
                                onMouseLeave={() => setPreview(null)}
                                onFocus={() => setPreview(item.id)}
                                onBlur={() => setPreview(null)}
                                onClick={() => { void (isWorn ? unequip(key, item.name) : equip(item)); }}
                              >
                                <ItemPicture itemId={item.id} size={40} />
                                <span className="max-w-20 truncate">{item.name}</span>
                                {isWorn && <Badge tone="success">On</Badge>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
