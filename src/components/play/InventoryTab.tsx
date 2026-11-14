"use client";

import { useEffect, useState } from "react";
import { Check, Package, ShoppingBag } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import ItemArt from "@/components/champion/ItemArt";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { Badge, Button, ButtonLink, EmptyState } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { INVENTORY_TABS, isWearable, ownedItems, useHeroStore, type ShopItem } from "@/hooks/useHero";
import { rarityOf } from "@/lib/game/rarity";
import { ROUTES } from "@/lib/routes";
import { INVENTORY_TAB_ICON } from "./icons";
import FilterBar from "./FilterBar";
import ItemCard from "./ItemCard";
import ItemPreview from "./ItemPreview";
import PixelLoader from "./PixelLoader";

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

/** What can be done with an owned item: wear it, use it; an emote is simply yours, on the victory wheel. */
function InventoryActions({ item }: { item: ShopItem }) {
  const toggleEquip = useHeroStore((s) => s.toggleEquip);
  const useItem = useHeroStore((s) => s.useItem);
  const using = useHeroStore((s) => !!s.pending[item.id]);
  const qty = item.quantity ?? 0;
  const isArena = item.effect === "heal_1" || item.effect === "fifty_fifty";
  if (item.category === "emote") return <p className="hero-item__note w-full"><Check size={11} className="inline mr-1" aria-hidden="true" />On your victory wheel</p>;
  if (item.consumable) {
    return (
      <Button variant="primary" size="sm" loading={using} disabled={qty < 1} onClick={() => { void useItem(item); }}>
        {qty < 1 ? "None left" : isArena ? `Queue for Arena${qty > 1 ? ` (×${qty})` : ""}` : `Use${qty > 1 ? ` (×${qty})` : ""}`}
      </Button>
    );
  }
  if (!isWearable(item)) return null;
  const equipped = !!item.equipped;
  return (
    <Button variant={equipped ? "secondary" : "primary"} size="sm" pressed={equipped} onClick={() => { void toggleEquip(item); }}>
      {equipped ? <><Check size={14} aria-hidden="true" />Equipped</> : "Equip"}
    </Button>
  );
}

function InventoryCard({ item }: { item: ShopItem }) {
  const buffs = useHUDStore((s) => s.buffs);
  const setPreview = useHeroStore((s) => s.setPreview);
  const previewed = useHeroStore((s) => s.previewId === item.id);
  const consumable = !!item.consumable;
  return (
    <ItemCard
      item={item}
      equipped={!!item.equipped && !consumable}
      previewed={previewed}
      count={consumable ? item.quantity ?? 0 : undefined}
      onOpen={() => setPreview(item.id)}
      extra={<BuffBadge effect={item.effect} buffs={buffs} />}
    >
      <InventoryActions item={item} />
    </ItemCard>
  );
}

/** The left panel when nothing is open: the champion, what it wears (each opens its preview) and the totals. */
function InventoryChampion({ owned }: { owned: number }) {
  const shop = useHeroStore((s) => s.shop);
  const setPreview = useHeroStore((s) => s.setPreview);
  const buffs = useHUDStore((s) => s.buffs);
  const look = useChampionLook();
  const equippedEntries = Object.entries(shop?.equipped ?? {}).filter(([, id]) => id);
  const activeBuffs = Object.keys(buffs ?? {}).filter((e) => TIMED_EFFECTS.includes(e));
  return (
    <div className="side-panel">
      {activeBuffs.length > 0 && (
        <div>
          <p className="hero-label">Active buffs</p>
          <div className="space-y-1">{activeBuffs.map((e) => <BuffBadge key={e} effect={e} buffs={buffs} />)}</div>
        </div>
      )}
      <p className="hero-label">Your champion</p>
      <div className="hero-stage" data-testid="inventory-avatar">
        <PixelSprite hero={look.hero} pet={look.petId} fidget label={`${look.hero.name}, your champion, in your skins`} className="hero-stage__sprite" />
      </div>
      <p className="hero-label">Currently equipped</p>
      <ul className="side-panel__worn">
        {equippedEntries.map(([slot, id]) => {
          const item = shop?.items.find((i) => i.id === id);
          if (!item) return null;
          return (
            <li key={slot}>
              <button type="button" className="worn-row" onClick={() => setPreview(item.id)} aria-label={`Preview ${SLOT_NAME[slot] ?? slot} ${item.name}`}>
                <ItemArt itemId={item.id} size={32} rarity={rarityOf(item)} />
                <span className="worn-row__text"><span className="worn-row__slot">{SLOT_NAME[slot] ?? slot}</span><span className="worn-row__name">{item.name}</span></span>
              </button>
            </li>
          );
        })}
        {equippedEntries.length === 0 && <li className="text-xs text-fg-muted">Nothing equipped yet</li>}
      </ul>
      <dl className="side-panel__totals">
        <div><dt>Items</dt><dd className="pixel-font">{owned}</dd></div>
        <div><dt>Equipped</dt><dd className="pixel-font text-ink-gold">{equippedEntries.length}</dd></div>
      </dl>
    </div>
  );
}

const SLOT_NAME: Record<string, string> = { headgear: "Head piece", armor: "Outfit", weapon: "Weapon finish", pet: "Pet", title: "Title" };

export default function InventoryTab() {
  const shop = useHeroStore((s) => s.shop);
  const loading = useHeroStore((s) => s.loading);
  const previewId = useHeroStore((s) => s.previewId);
  const setPreview = useHeroStore((s) => s.setPreview);
  const [tab, setTab] = useState<string>(INVENTORY_TABS[0].id);
  useEffect(() => () => setPreview(null), [setPreview]);

  if (loading || !shop) return <PixelLoader label="Opening your bag" />;

  const owned = ownedItems(shop);
  const current = INVENTORY_TABS.find((t) => t.id === tab) ?? INVENTORY_TABS[0];
  const items = owned.filter(current.match);
  const open = previewId ? shop.items.find((i) => i.id === previewId && i.owned) : undefined;

  return (
    <div className="hero-split hero-split--fixed">
      <aside className="hero-split__side" aria-label="Inventory preview">
        {open ? (
          <ItemPreview item={open} status={open.consumable && (open.quantity ?? 0) > 0 && <Badge>×{open.quantity}</Badge>}>
            <InventoryActions item={open} />
          </ItemPreview>
        ) : <InventoryChampion owned={owned.length} />}
      </aside>

      <section className="hero-split__main" aria-label="Your items">
        <div className="collection-head">
          <FilterBar label="Inventory categories" size="lg" value={tab} onChange={setTab}
            options={INVENTORY_TABS.map((t) => {
              const I = INVENTORY_TAB_ICON[t.id];
              return { id: t.id, label: t.name, icon: I ? <I size={15} aria-hidden="true" /> : undefined, count: owned.filter(t.match).length };
            })} />
          <p className="m-0 text-sm text-fg-muted" data-testid="inventory-count">{owned.length} items owned</p>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={<Package size={48} />}
            title="Nothing here yet"
            description="Visit the shop to pick some up."
            action={<ButtonLink href={ROUTES.heroShop} variant="primary"><ShoppingBag size={16} aria-hidden="true" />Visit shop</ButtonLink>}
          />
        ) : (
          <ul className="hero-grid" aria-label={current.name}>{items.map((i) => <InventoryCard key={i.id} item={i} />)}</ul>
        )}
      </section>
    </div>
  );
}
