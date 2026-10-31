"use client";

import { useEffect, useState } from "react";
import { Check, Package, ShoppingBag } from "lucide-react";
import { HeroFigure, ItemPicture } from "@/components/avatar";
import { lookFromEquipped } from "@/lib/avatar/look";
import { Button, ButtonLink, EmptyState, Tabs } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { INVENTORY_TABS, ownedItems, useHeroStore, type ShopItem } from "@/hooks/useHero";
import { ROUTES } from "@/lib/routes";
import { INVENTORY_TAB_ICON } from "./icons";
import ItemCard from "./ItemCard";

const ARENA_EFFECTS = new Set(["heal_1", "fifty_fifty", "hint_charges"]);
const TIMED_EFFECTS = ["xp_boost_1h", "xp_boost_2h", "coin_boost_1h", "streak_freeze"];

// Only shown for timed buffs (XP boost, coin boost) — not arena consumables
function BuffBadge({ effect, buffs }: { effect: string | null; buffs: Record<string, any> }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!effect || !buffs[effect] || ARENA_EFFECTS.has(effect)) return;
    const update = () => setRemaining(Math.max(0, Math.floor(buffs[effect].expires_at - Date.now() / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [effect, buffs]);

  if (!effect || !buffs[effect] || ARENA_EFFECTS.has(effect)) return null;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return <div className="text-xs text-ink-purple font-semibold">Active, {m}:{s.toString().padStart(2, "0")} left</div>;
}

function InventoryCard({ item }: { item: ShopItem }) {
  const buffs = useHUDStore((s) => s.buffs);
  const toggleEquip = useHeroStore((s) => s.toggleEquip);
  const useItem = useHeroStore((s) => s.useItem);
  const using = useHeroStore((s) => !!s.pending[item.id]);

  const equipped = !!item.equipped;
  const consumable = !!item.consumable;
  const qty = item.quantity ?? 0;
  const isArena = item.effect === "heal_1" || item.effect === "fifty_fifty";
  // Only timed buffs count as "active"; an arena consumable is never blocked by one.
  const active = !isArena && !!(item.effect && buffs && buffs[item.effect]);

  return (
    <ItemCard
      item={item}
      equipped={equipped && !consumable}
      count={consumable ? qty : undefined}
      extra={
        <>
          {consumable && <p className="m-0 text-xs text-ink-purple">Consumable</p>}
          {active && <BuffBadge effect={item.effect} buffs={buffs} />}
        </>
      }
    >
      {!consumable && (
        <Button variant={equipped ? "secondary" : "primary"} size="sm" pressed={equipped} onClick={() => { void toggleEquip(item); }}>
          {equipped ? <><Check size={14} aria-hidden="true" />Equipped</> : "Equip"}
        </Button>
      )}
      {consumable && (
        <Button variant="primary" size="sm" loading={using} disabled={qty < 1} onClick={() => { void useItem(item); }}>
          {qty < 1 ? "None left" : isArena ? `Queue for Arena${qty > 1 ? ` (×${qty})` : ""}` : `Use${qty > 1 ? ` (×${qty})` : ""}`}
        </Button>
      )}
    </ItemCard>
  );
}

export default function InventoryTab() {
  const shop = useHeroStore((s) => s.shop);
  const loading = useHeroStore((s) => s.loading);
  const buffs = useHUDStore((s) => s.buffs);
  const [tab, setTab] = useState<string>(INVENTORY_TABS[0].id);

  if (loading || !shop) return <p role="status" className="p-6 text-fg-muted">Loading inventory…</p>;

  const owned = ownedItems(shop);
  const equippedEntries = Object.entries(shop.equipped ?? {}).filter(([, id]) => id);
  const activeBuffs = Object.keys(buffs ?? {}).filter((e) => TIMED_EFFECTS.includes(e));

  const panel = (match: (i: ShopItem) => boolean) => {
    const items = owned.filter(match);
    return items.length === 0 ? (
      <EmptyState
        icon={<Package size={48} />}
        title="No items in this category"
        description="Visit the shop to pick some up."
        action={<ButtonLink href={ROUTES.heroShop} variant="primary"><ShoppingBag size={16} aria-hidden="true" />Visit shop</ButtonLink>}
      />
    ) : (
      <ul className="hero-grid mt-4">{items.map((i) => <InventoryCard key={i.id} item={i} />)}</ul>
    );
  };

  return (
    <div className="hero-split">
      <aside className="hero-split__side" aria-label="Inventory sidebar">
        <p className="m-0 mb-4 text-sm text-fg-muted" data-testid="inventory-count">{owned.length} items owned</p>

        {activeBuffs.length > 0 && (
          <div className="mb-5">
            <p className="hero-label">Active buffs</p>
            <div className="space-y-1">{activeBuffs.map((e) => <BuffBadge key={e} effect={e} buffs={buffs} />)}</div>
          </div>
        )}

        <p className="hero-label">Your character</p>
        <div className="hero-stage" data-testid="inventory-avatar">
          <HeroFigure look={lookFromEquipped(shop.equipped)} size="min(100%, 13rem)" animate title="Your hero" />
        </div>

        <p className="hero-label mt-5">Currently equipped</p>
        <ul className="m-0 p-0 space-y-2 list-none">
          {equippedEntries.map(([slot, id]) => {
            const item = shop.items.find((i) => i.id === id);
            if (!item) return null;
            return (
              <li key={slot} className="flex items-center gap-2 p-2 rounded-md border border-line bg-canvas">
                <ItemPicture itemId={item.id} size={32} />
                <span className="text-xs text-fg-2 truncate">{item.name}</span>
              </li>
            );
          })}
          {equippedEntries.length === 0 && <li className="text-xs text-fg-muted italic">No items equipped</li>}
        </ul>

        <p className="hero-label mt-5">Collection</p>
        <dl className="m-0 grid grid-cols-2 gap-1 text-sm">
          <dt className="text-fg-2">Total items</dt><dd className="m-0 text-right pixel-font">{owned.length}</dd>
          <dt className="text-fg-2">Equipped</dt><dd className="m-0 text-right pixel-font text-ink-gold">{equippedEntries.length}</dd>
        </dl>
      </aside>

      <section className="hero-split__main" aria-label="Your items">
        <Tabs
          label="Inventory categories"
          value={tab}
          onChange={setTab}
          tabs={INVENTORY_TABS.map((t) => ({
            id: t.id,
            label: <span className="forge-tab">{(() => { const I = INVENTORY_TAB_ICON[t.id]; return I ? <I size={15} aria-hidden="true" /> : null; })()}{t.name} ({owned.filter(t.match).length})</span>,
            content: panel(t.match),
          }))}
        />
      </section>
    </div>
  );
}
