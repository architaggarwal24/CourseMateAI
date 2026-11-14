"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Coins, Eye, Lock, ShoppingBag, Sparkles, Swords } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { Badge, Button, EmptyState } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { isWearable, useHeroStore, type ShopItem, type ShopState } from "@/hooks/useHero";
import { CategoryIcon } from "./icons";
import { usePurchase } from "./PurchaseFlow";
import FilterBar from "./FilterBar";
import ItemCard, { Price } from "./ItemCard";
import ItemPreview from "./ItemPreview";
import PixelLoader from "./PixelLoader";

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

/** What can be done with a shop item: buy it, wear it, use it; the same buttons on its tile and in the preview. */
function ShopActions({ item }: { item: ShopItem }) {
  const askPurchase = usePurchase((s) => s.ask);
  const toggleEquip = useHeroStore((s) => s.toggleEquip);
  const useItem = useHeroStore((s) => s.useItem);
  const busy = useHeroStore((s) => !!s.pending[item.id]);
  const locked = !!item.locked;
  const owned = !!item.owned;
  const equipped = !!item.equipped;
  const qty = item.quantity ?? 0;
  const canAfford = !locked && !(owned && !item.consumable) && !!item.can_afford;

  if (locked) return <p className="hero-item__note w-full"><Lock size={11} className="inline mr-1" aria-hidden="true" />Reach Level {item.level_required} to unlock</p>;
  if (!owned || (item.consumable && qty === 0)) {
    return (
      <Button variant="primary" size="sm" disabled={!canAfford} loading={busy} onClick={() => askPurchase(item)}>
        <ShoppingBag size={14} aria-hidden="true" />{canAfford ? "Buy" : "Can't afford"}
      </Button>
    );
  }
  if (item.category === "emote") return <p className="hero-item__note w-full"><Check size={11} className="inline mr-1" aria-hidden="true" />On your victory wheel</p>;
  if (isWearable(item)) {
    return (
      <Button variant={equipped ? "secondary" : "primary"} size="sm" pressed={equipped} onClick={() => { void toggleEquip(item); }}>
        {equipped ? <><Check size={14} aria-hidden="true" />Equipped</> : "Equip"}
      </Button>
    );
  }
  return <Button variant="primary" size="sm" loading={busy} onClick={() => { void useItem(item); }}><Sparkles size={14} aria-hidden="true" />Activate</Button>;
}

/** Everything that can be bought and then worn or used. Clicking it opens it in the preview panel. */
function ShopItemCard({ item }: { item: ShopItem }) {
  const setPreview = useHeroStore((s) => s.setPreview);
  const previewed = useHeroStore((s) => s.previewId === item.id);
  return (
    <ItemCard
      item={item}
      equipped={!!item.equipped}
      previewed={previewed}
      locked={!!item.locked}
      count={item.consumable ? item.quantity ?? 0 : undefined}
      onOpen={() => setPreview(item.id)}
      meta={<><Price amount={item.price} muted={!!item.locked} />{!item.locked && item.consumable && <Badge tone="epic">Consumable</Badge>}</>}
    >
      <ShopActions item={item} />
    </ItemCard>
  );
}

/** Arena-only potions: used mid-battle, so they can be stacked up to a cap (never "equipped" or "activated" here). */
function ArenaPotionActions({ item }: { item: ShopItem }) {
  const askPurchase = usePurchase((s) => s.ask);
  const busy = useHeroStore((s) => !!s.pending[item.id]);
  const coins = useHUDStore((s) => s.coins);
  const { locked, totalAvail, atMax } = stack(item);
  const canBuy = !locked && !atMax && !!item.can_afford;
  if (locked) return <p className="hero-item__note w-full">Reach Level {item.level_required}</p>;
  if (atMax) return <p className="hero-item__note w-full">Max stack: use one first</p>;
  return (
    <Button variant="primary" size="sm" disabled={!canBuy} loading={busy} onClick={() => askPurchase(item)}>
      <ShoppingBag size={14} aria-hidden="true" />
      {canBuy ? (totalAvail > 0 ? `Buy more (${totalAvail} owned)` : "Buy") : coins < item.price ? "Can't afford" : "Can't buy"}
    </Button>
  );
}
function stack(item: ShopItem) {
  const totalAvail = item.total_available ?? item.quantity ?? 0;
  const maxStack: number | null = item.max_stack ?? null;
  return { locked: !!item.locked, totalAvail, maxStack, atMax: item.at_max ?? (maxStack !== null && totalAvail >= maxStack) };
}

function ArenaPotionCard({ item }: { item: ShopItem }) {
  const setPreview = useHeroStore((s) => s.setPreview);
  const previewed = useHeroStore((s) => s.previewId === item.id);
  const { locked, totalAvail, maxStack, atMax } = stack(item);
  return (
    <ItemCard item={item} locked={locked} previewed={previewed} onOpen={() => setPreview(item.id)}
      meta={<><Price amount={item.price} muted={locked} />{!locked && maxStack && <Badge tone={atMax ? "reward" : "neutral"}>{totalAvail}/{maxStack}</Badge>}</>}>
      <ArenaPotionActions item={item} />
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
            <p className="text-xs text-fg-muted m-0">Arena only. Used mid-battle, so stock up before you fight.</p>
          </div>
          <ul className="hero-grid">{arenaOnly.map((i) => <ArenaPotionCard key={i.id} item={i} />)}</ul>
        </section>
      )}
    </div>
  );
}

/** The left panel when nothing is open: the champion as it looks now, and how to try things on. */
function ShopChampion() {
  const { hero, petId, petStage } = useChampionLook({ preview: true });
  const coins = useHUDStore((s) => s.coins);
  return (
    <div className="side-panel">
      <p className="hero-label">Your champion</p>
      <div className="hero-stage" data-testid="shop-preview">
        <PixelSprite hero={hero} pet={petId} petStage={petStage} fidget label={`${hero.name}, your champion`} className="hero-stage__sprite" />
      </div>
      <p className="side-panel__hint"><Eye size={14} aria-hidden="true" />Pick any item to see it on {hero.name}, with its stats and bonuses.</p>
      <p className="side-panel__coins"><Coins size={14} aria-hidden="true" /><strong className="pixel-font">{coins.toLocaleString()}</strong> coins to spend</p>
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

  // An open preview belongs to the category it was opened in.
  useEffect(() => { setPreview(null); }, [selected, setPreview]);
  // and closes when you leave the shop
  useEffect(() => () => setPreview(null), [setPreview]);

  // Open on the first category the hero has reached - once, not on every silent reload.
  const picked = useRef(false);
  useEffect(() => {
    if (!shop || picked.current) return;
    picked.current = true;
    const first = shopCategories(shop).find((c) => level >= c.unlockLevel);
    if (first) setSelected(first.id);
  }, [shop, level]);

  if (loading || !shop) return <PixelLoader label="Opening the shop" />;
  if (!shop.shop_unlocked) return <LockedNotice title="Shop locked" level={level} need={5} />;

  const categories = shopCategories(shop);
  const cat = categories.find((c) => c.id === selected) ?? { id: selected, name: selected, icon: "", desc: "", unlockLevel: 5 };
  const catLocked = level < cat.unlockLevel;
  // mastery skins are earned with a champion's levels, never sold (they show in the Champion tab)
  const inCategory = shop.items.filter((i) => i.category === selected && !i.mastery);
  const open = previewId ? shop.items.find((i) => i.id === previewId) : undefined;

  return (
    <div className="hero-split hero-split--fixed">
      <aside className="hero-split__side" aria-label="Shop preview">
        {open ? (
          <ItemPreview item={open} status={!open.owned && <Price amount={open.price} />}>
            {open.arena_only ? <ArenaPotionActions item={open} /> : <ShopActions item={open} />}
          </ItemPreview>
        ) : <ShopChampion />}
      </aside>

      <section className="hero-split__main" aria-labelledby="shop-category">
        <div className="collection-head">
          <FilterBar label="Shop categories" size="lg" value={selected} onChange={setSelected}
            options={categories.map((c) => {
              const all = shop.items.filter((i) => i.category === c.id && !i.mastery);
              return { id: c.id, label: c.name, icon: <CategoryIcon id={c.id} size={15} />, locked: level < c.unlockLevel,
                count: level < c.unlockLevel ? undefined : `${all.filter((i) => i.owned).length}/${all.length}` };
            })} />
        </div>
        {catLocked ? (
          <LockedNotice title={`${cat.name} locked`} level={level} need={cat.unlockLevel} />
        ) : (
          <>
            <div className="collection-title">
              <h2 id="shop-category" className="collection-title__name"><CategoryIcon id={cat.id} size={20} />{cat.name}</h2>
              <p className="collection-title__desc">{cat.desc}</p>
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
