"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, ShoppingBag, Eye, Check, Sparkles, Swords } from "lucide-react";
import { HeroFigure } from "@/components/avatar";
import { lookFromEquipped } from "@/lib/avatar/look";
import { Badge, Button, EmptyState } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { previewEquipped, useHeroStore, type ShopItem, type ShopState } from "@/hooks/useHero";
import { CategoryIcon } from "./icons";
import ItemCard, { Price } from "./ItemCard";

// Shop categories come from the API (GET /shop -> category_status, in display order); nothing about them is
// duplicated here. A category's tab opens at the level of its cheapest paid item.
type ShopCategory = { id: string; name: string; icon: string; desc: string; unlockLevel: number };

export function shopCategories(shop: ShopState | null): ShopCategory[] {
  const items = shop?.items ?? [];
  return Object.entries(shop?.category_status ?? {}).map(([id, c]: [string, any]) => {
    const paidLevels = items.filter((i) => i.category === id && i.price > 0).map((i) => i.level_required);
    return {
      id,
      name: c.name ?? id,
      icon: c.icon ?? "",
      desc: c.description ?? "",
      unlockLevel: paidLevels.length ? Math.min(...paidLevels) : (c.unlock_level ?? 5),
    };
  });
}

function LockedNotice({ title, level, need }: { title: string; level: number; need: number }) {
  return (
    <EmptyState
      icon={<Lock size={48} />}
      title={title}
      description={`Reach Level ${need} to unlock it. You are Level ${level}.`}
    />
  );
}

/** Everything that can be bought and then worn or used. */
function ShopItemCard({ item }: { item: ShopItem }) {
  const purchase = useHeroStore((s) => s.purchase);
  const toggleEquip = useHeroStore((s) => s.toggleEquip);
  const useItem = useHeroStore((s) => s.useItem);
  const togglePreview = useHeroStore((s) => s.togglePreview);
  const previewId = useHeroStore((s) => s.previewId);
  const busy = useHeroStore((s) => !!s.pending[item.id]);

  const locked = !!item.locked;
  const owned = !!item.owned;
  const equipped = !!item.equipped;
  const previewed = previewId === item.id;
  const qty = item.quantity ?? 0;
  const canAfford = !locked && !(owned && !item.consumable) && !!item.can_afford;
  const wearable = !item.consumable;
  const canPreview = wearable && !equipped;

  const previewButton = wearable && (
    <Button
      size="sm" icon pressed={previewed}
      aria-label={previewed ? `Stop previewing ${item.name}` : `Try on ${item.name}`}
      onClick={() => togglePreview(item.id)}
    >
      <Eye size={14} aria-hidden="true" />
    </Button>
  );

  return (
    <ItemCard
      item={item}
      equipped={equipped}
      previewed={previewed}
      locked={locked}
      count={item.consumable ? qty : undefined}
      onPreview={canPreview ? () => togglePreview(item.id) : undefined}
      meta={
        <>
          <Price amount={item.price} muted={locked} />
          {!locked && item.consumable && <Badge tone="epic">Consumable</Badge>}
        </>
      }
    >
      {locked ? (
        <p className="hero-item__note w-full"><Lock size={11} className="inline mr-1" aria-hidden="true" />Reach Level {item.level_required} to unlock</p>
      ) : !owned || (item.consumable && qty === 0) ? (
        <>
          {previewButton}
          <Button variant="primary" size="sm" disabled={!canAfford} loading={busy} onClick={() => { void purchase(item); }}>
            <ShoppingBag size={14} aria-hidden="true" />{canAfford ? "Buy" : "Can't afford"}
          </Button>
        </>
      ) : owned && !item.consumable ? (
        <>
          {!equipped && previewButton}
          <Button variant={equipped ? "secondary" : "primary"} size="sm" pressed={equipped} onClick={() => { void toggleEquip(item); }}>
            {equipped ? <><Check size={14} aria-hidden="true" />Equipped</> : "Equip"}
          </Button>
        </>
      ) : (
        <Button variant="primary" size="sm" loading={busy} onClick={() => { void useItem(item); }}><Sparkles size={14} aria-hidden="true" />Activate</Button>
      )}
    </ItemCard>
  );
}

/** Arena-only potions: used mid-battle, so they can be stacked up to a cap (never "equipped" or "activated" here). */
function ArenaPotionCard({ item }: { item: ShopItem }) {
  const purchase = useHeroStore((s) => s.purchase);
  const busy = useHeroStore((s) => !!s.pending[item.id]);
  const coins = useHUDStore((s) => s.coins);

  const locked = !!item.locked;
  const qty = item.quantity ?? 0;
  const totalAvail = item.total_available ?? qty;
  const maxStack = item.max_stack ?? null;
  const atMax = item.at_max ?? (maxStack !== null && totalAvail >= maxStack);
  const canBuy = !locked && !atMax && !!item.can_afford;

  return (
    <ItemCard
      item={item}
      locked={locked}
      meta={
        <>
          <Price amount={item.price} muted={locked} />
          {!locked && maxStack && <Badge tone={atMax ? "reward" : "neutral"}>{totalAvail}/{maxStack}</Badge>}
        </>
      }
    >
      {locked ? (
        <p className="hero-item__note w-full">Reach Level {item.level_required}</p>
      ) : atMax ? (
        <p className="hero-item__note w-full">Max stack — use one first</p>
      ) : (
        <Button variant="primary" size="sm" disabled={!canBuy} loading={busy} onClick={() => { void purchase(item); }}>
          <ShoppingBag size={14} aria-hidden="true" />
          {canBuy ? (totalAvail > 0 ? `Buy more (${totalAvail} owned)` : "Buy") : coins < item.price ? "Can't afford" : "Can't buy"}
        </Button>
      )}
    </ItemCard>
  );
}

function PotionSection({ items }: { items: ShopItem[] }) {
  const regular = items.filter((i) => !i.arena_only);
  const arenaOnly = items.filter((i) => i.arena_only);
  return (
    <div className="space-y-8">
      {regular.length > 0 && <ul className="hero-grid">{regular.map((i) => <ShopItemCard key={i.id} item={i} />)}</ul>}
      {arenaOnly.length > 0 && (
        <section aria-labelledby="battle-forge">
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-line">
            <Badge tone="danger" id="battle-forge"><Swords size={12} aria-hidden="true" />Battle Forge</Badge>
            <p className="text-xs text-fg-muted m-0">Arena only. Consumed mid-battle, so stock up before you fight.</p>
          </div>
          <ul className="hero-grid">{arenaOnly.map((i) => <ArenaPotionCard key={i.id} item={i} />)}</ul>
        </section>
      )}
    </div>
  );
}

export default function ShopTab() {
  const level = useHUDStore((s) => s.level);
  const shop = useHeroStore((s) => s.shop);
  const loading = useHeroStore((s) => s.loading);
  const previewId = useHeroStore((s) => s.previewId);
  const setPreview = useHeroStore((s) => s.setPreview);

  const [selected, setSelected] = useState("headgear");

  // A try-on belongs to the category it was started in.
  useEffect(() => { setPreview(null); }, [selected, setPreview]);

  // Open on the first category the hero has reached - once, not on every silent reload.
  const picked = useRef(false);
  useEffect(() => {
    if (!shop || picked.current) return;
    picked.current = true;
    const first = shopCategories(shop).find((c) => level >= c.unlockLevel);
    if (first) setSelected(first.id);
  }, [shop, level]);

  if (loading || !shop) return <p role="status" className="p-6 text-fg-muted">Loading shop…</p>;
  if (!shop.shop_unlocked) return <LockedNotice title="Shop locked" level={level} need={5} />;

  const categories = shopCategories(shop);
  const cat = categories.find((c) => c.id === selected) ?? { id: selected, name: selected, icon: "", desc: "", unlockLevel: 5 };
  const catLocked = level < cat.unlockLevel;
  const inCategory = shop.items.filter((i) => i.category === selected);

  return (
    <div className="hero-split">
      <aside className="hero-split__side" aria-label="Shop sidebar">
        <p className="hero-label">Try it on</p>
        <div className="hero-stage" data-testid="shop-preview">
          <HeroFigure look={lookFromEquipped(previewEquipped(shop, previewId))} size="min(100%, 13rem)" animate title="Your hero, trying on the previewed item" />
        </div>
        {previewId && (
          <p className="text-sm text-ink-purple mt-2" data-testid="shop-preview-name">
            Preview: {shop.items.find((i) => i.id === previewId)?.name}
          </p>
        )}

        <p className="hero-label mt-5">Categories</p>
        <div className="space-y-2" role="group" aria-label="Shop categories">
          {categories.map((c) => {
            const isLocked = level < c.unlockLevel;
            const total = shop.items.filter((i) => i.category === c.id);
            return (
              <button key={c.id} type="button" className="hero-cat" aria-pressed={selected === c.id} data-locked={isLocked || undefined} onClick={() => setSelected(c.id)}>
                <span className="hero-cat__icon"><CategoryIcon id={c.id} /></span>
                <span>
                  <span className="hero-cat__name">{c.name}{isLocked && <Lock size={10} className="inline ml-1.5" aria-label="locked" />}</span>
                  <span className="hero-cat__hint">{isLocked ? `Unlocks at Lv ${c.unlockLevel}` : `${total.filter((i) => i.owned).length}/${total.length} owned`}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="hero-split__main" aria-labelledby="shop-category">
        {catLocked ? (
          <LockedNotice title={`${cat.name} locked`} level={level} need={cat.unlockLevel} />
        ) : (
          <>
            <div className="mb-5 pb-4 border-b border-line">
              <h2 id="shop-category" className="m-0 text-xl font-bold text-fg inline-flex items-center gap-2"><CategoryIcon id={cat.id} size={22} />{cat.name}</h2>
              <p className="m-0 mt-1 text-sm text-fg-muted">{cat.desc}</p>
              <p className="m-0 mt-2 text-xs text-fg-muted"><Eye size={12} className="inline mr-1" aria-hidden="true" />Press the eye to preview an item on your hero.</p>
            </div>
            {inCategory.length === 0 ? (
              <p className="py-12 text-center text-fg-muted">No items in this category yet</p>
            ) : selected === "potion" ? (
              <PotionSection items={inCategory} />
            ) : (
              <ul className="hero-grid">{inCategory.map((i) => <ShopItemCard key={i.id} item={i} />)}</ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
