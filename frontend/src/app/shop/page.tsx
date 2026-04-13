"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { toast } from "sonner";
import { ShoppingBag, Lock, Check, ChevronRight, Package, Eye, X } from "lucide-react";
import AvatarDisplay from "@/components/AvatarDisplay";
import HomeButton from "@/components/HomeButton";
import PixelSprite from "@/components/PixelSprite";
import { useRouter } from "next/navigation";
import ActiveBuffsSidebar from "@/components/ActiveBuffsSidebar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const CATEGORY_UNLOCK_LEVELS: Record<string, number> = {
  armor:    5,
  potion:   5,
  headgear: 7,
  weapon:   10,
  pet:      20,
  title:    30,
};

const CATEGORIES = [
  { id: "headgear", name: "Headgear",       icon: "🎩", desc: "Hats, crowns & headwear — some grant Arena hint charges or XP bonuses" },
  { id: "armor",    name: "Armor & Outfits", icon: "🛡️", desc: "Outfits — expensive ones grant permanent XP & coin bonuses" },
  { id: "weapon",   name: "Weapons",         icon: "⚔️", desc: "Weapons — mid-tier+ boost XP from answer combos" },
  { id: "pet",      name: "Pets",            icon: "🐾", desc: "Companions — grant passive XP/coin bonuses & auto streak freezes" },
  { id: "potion",   name: "Potions",         icon: "🧪", desc: "Consumables — Arena heals, XP boosts, streak shields & quest resets" },
  { id: "title",    name: "Titles",          icon: "🏆", desc: "Prestige titles — rare ones grant small stat bonuses" },
];

// ── Potion Shop Section: splits items into regular + arena-only ──────────────
const ARENA_ONLY_IDS = new Set(["potion_health_small", "fifty_fifty"]);

function PotionCard({ item, coins, onPurchase, onUse }: {
  item: any; coins: number;
  onPurchase: (id: string, price: number, name: string) => void;
  onUse: (id: string, name: string) => void;
}) {
  const isItemLocked = item.locked;
  const isOwned      = item.owned;
  const qty          = item.quantity ?? 0;          // inventory qty (unactivated)
  const buffCount    = item.buff_count ?? 0;         // activated charges in buff slot
  const totalAvail   = item.total_available ?? qty;  // combined total
  const maxStack     = item.max_stack ?? null;
  // Use at_max from backend which counts both inv + buff toward the stack cap
  const atMax        = item.at_max ?? (maxStack !== null && totalAvail >= maxStack);
  const canBuy       = !isItemLocked && !atMax && item.can_afford;
  const stackInfo    = maxStack !== null ? `${totalAvail}/${maxStack}` : null;

  return (
    <div className={`relative p-4 rounded-2xl border transition-all backdrop-blur-sm ${
      isItemLocked
        ? "border-border/40 bg-bg-card/20"
        : atMax
          ? "border-accent-gold/40 bg-accent-gold/5"
          : isOwned && qty > 0
            ? "border-accent-blue bg-accent-blue/5"
            : "border-border/50 bg-bg-card/50 hover:border-accent-gold/50 hover:shadow-lg"
    }`}>
      {isItemLocked && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-primary/90 border border-border/40">
          <span className="text-xs text-text-muted font-semibold">Lv {item.level_required}</span>
        </div>
      )}
      {stackInfo && !isItemLocked && (
        <div className={`absolute top-3 right-3 px-2 py-1 rounded-lg text-xs font-bold ${
          atMax ? "bg-accent-gold/20 text-accent-gold border border-accent-gold/40" : "bg-bg-primary border border-border/40 text-text-muted"
        }`}>
          {stackInfo}
        </div>
      )}

      <div className="flex justify-center mb-3">
        <div className="p-3 bg-gradient-to-br from-bg-primary/50 to-bg-secondary/50 rounded-xl border border-border/20">
          <PixelSprite itemId={item.id} size="md" />
        </div>
      </div>

      <h3 className={`text-sm font-bold mb-1 ${isItemLocked ? "text-text-muted" : "text-text-primary"}`}>
        {item.name}
      </h3>
      <p className="text-xs text-text-muted mb-2">{item.description}</p>

      <div className="flex items-center justify-between text-xs mb-3">
        <span className={`font-bold ${isItemLocked ? "text-text-muted" : "text-accent-gold"}`}>
          {item.price} 🪙
        </span>
        {!isItemLocked && maxStack && (
          <span className="px-2 py-0.5 bg-accent-purple/20 text-accent-purple rounded-full text-[10px]">
            Stack up to {maxStack}
          </span>
        )}
      </div>

      {isItemLocked ? (
        <div className="w-full py-2 rounded-lg text-xs text-center text-text-muted border border-border/30 bg-bg-primary/30">
          Reach Level {item.level_required}
        </div>
      ) : atMax ? (
        <div className="w-full py-2 rounded-lg text-xs text-center text-accent-gold border border-accent-gold/30 bg-accent-gold/10">
          Max stack — use one first
        </div>
      ) : (
        <button
          onClick={() => onPurchase(item.id, item.price, item.name)}
          disabled={!canBuy}
          className={`w-full py-2 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            canBuy
              ? "bg-accent-gold hover:bg-accent-gold/90 text-black"
              : "bg-bg-primary text-text-muted border border-border cursor-not-allowed"
          }`}
        >
          <ShoppingBag size={14} />
          {canBuy ? (totalAvail > 0 ? `Buy More (${totalAvail} owned)` : "Buy") : coins < item.price ? "Can\'t Afford" : "Can\'t Buy"}
        </button>
      )}
    </div>
  );
}

function PotionShopSection({ items, coins, onPurchase, onUse }: {
  items: any[]; coins: number;
  onPurchase: (id: string, price: number, name: string) => void;
  onUse: (id: string, name: string) => void;
}) {
  const regular    = items.filter((i: any) => !ARENA_ONLY_IDS.has(i.id));
  const arenaOnly  = items.filter((i: any) =>  ARENA_ONLY_IDS.has(i.id));

  return (
    <div className="space-y-8">
      {/* Regular potions */}
      {regular.length > 0 && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {regular.map((item: any) => {
              const isItemLocked = item.locked;
              const isOwned      = item.owned;
              const isEquipped   = item.equipped;
              const qty          = item.quantity ?? 0;
              const canAfford    = !isItemLocked && !(isOwned && !item.consumable) && item.can_afford;

              return (
                <div key={item.id} className={`relative p-4 rounded-2xl border transition-all backdrop-blur-sm ${
                  isItemLocked ? "border-border/40 bg-bg-card/20"
                    : isOwned && qty > 0 ? "border-accent-blue bg-accent-blue/5"
                    : "border-border/50 bg-bg-card/50 hover:border-accent-gold/50 hover:shadow-lg"
                }`}>
                  {isItemLocked && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-primary/90 border border-border/40">
                      <Lock size={10} className="text-text-muted" />
                      <span className="text-xs text-text-muted font-semibold">Lv {item.level_required}</span>
                    </div>
                  )}
                  <div className="flex justify-center mb-3">
                    <div className={`p-3 bg-gradient-to-br from-bg-primary/50 to-bg-secondary/50 rounded-xl border border-border/20 ${isItemLocked ? "opacity-40 grayscale" : ""}`}>
                      <PixelSprite itemId={item.id} size="md" />
                    </div>
                  </div>
                  <h3 className={`text-sm font-bold mb-1 ${isItemLocked ? "text-text-muted" : "text-text-primary"}`}>{item.name}</h3>
                  <p className="text-xs text-text-muted mb-2">{item.description}</p>
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className={`font-bold ${isItemLocked ? "text-text-muted" : "text-accent-gold"}`}>{item.price} 🪙</span>
                    {!isItemLocked && item.consumable && (
                      <span className="px-2 py-0.5 bg-accent-purple/20 text-accent-purple rounded-full">Consumable</span>
                    )}
                  </div>
                  {isItemLocked ? (
                    <div className="w-full py-2 rounded-lg text-xs text-center text-text-muted border border-border/30 bg-bg-primary/30 flex items-center justify-center gap-1.5">
                      <Lock size={11} />Reach Level {item.level_required}
                    </div>
                  ) : (!isOwned || (item.consumable && qty === 0)) ? (
                    <button
                      onClick={() => onPurchase(item.id, item.price, item.name)}
                      disabled={!canAfford}
                      className={`w-full py-2 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                        canAfford ? "bg-accent-gold hover:bg-accent-gold/90 text-black" : "bg-bg-primary text-text-muted border border-border cursor-not-allowed"
                      }`}
                    >
                      <ShoppingBag size={14} />{canAfford ? "Buy" : "Can\'t Afford"}
                    </button>
                  ) : isOwned && item.consumable && qty > 0 ? (
                    <button
                      onClick={() => onUse(item.id, item.name)}
                      className="w-full py-2 bg-accent-purple hover:bg-accent-purple/90 text-white rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2"
                    >
                      ✨ Activate
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Arena-Only consumables ─────────────────────────────────────────── */}
      {arenaOnly.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/30">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <span className="text-sm">⚔️</span>
              <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Battle Forge — Arena Only</span>
            </div>
            <p className="text-xs text-text-muted">Consumed mid-battle. Stock up before you fight.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {arenaOnly.map((item: any) => (
              <PotionCard key={item.id} item={item} coins={coins} onPurchase={onPurchase} onUse={onUse} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShopPage() {
  const router    = useRouter();
  const coins     = useHUDStore((s) => s.coins);
  const level     = useHUDStore((s) => s.level);
  const guestMode = useHUDStore((s) => s.guestMode);
  const refresh   = useHUDStore((s) => s.refresh);

  const [selectedCategory, setSelectedCategory] = useState("headgear");
  const [shopData, setShopData]   = useState<any>(null);
  const [loading,  setLoading]    = useState(true);
  const [previewItem, setPreviewItem] = useState<any>(null);

  useEffect(() => { loadShop(); }, []);
  useEffect(() => { setPreviewItem(null); }, [selectedCategory]);

  // Set default category only on FIRST load — not on every silent reload
  const hasSetInitialCategory = React.useRef(false);
  useEffect(() => {
    if (!shopData || hasSetInitialCategory.current) return;
    hasSetInitialCategory.current = true;
    const firstUnlocked = CATEGORIES.find(
      (c) => level >= (CATEGORY_UNLOCK_LEVELS[c.id] ?? 99)
    );
    if (firstUnlocked) setSelectedCategory(firstUnlocked.id);
  }, [shopData]);

  const loadShop = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/shop`, { credentials: "include" });
      if (res.ok) setShopData(await res.json());
    } catch (e) { console.error("Shop load error:", e); }
    setLoading(false);
  };

  // Silent reload — no loading spinner flash, used after mutations
  const reloadShopSilently = useCallback(async () => {
    try {
      const res = await fetch(`${API}/shop`, { credentials: "include" });
      if (res.ok) setShopData(await res.json());
    } catch (e) { console.error("Shop silent reload error:", e); }
  }, []);

  const previewEquipped = (() => {
    const base = shopData?.equipped ?? {};
    if (!previewItem) return base;
    return { ...base, [previewItem.category]: previewItem.id };
  })();

  const handlePurchase = async (itemId: string, cost: number, itemName: string) => {
    if (guestMode) { toast.error("Please login to purchase items"); return; }
    if (coins < cost) { toast.error(`Not enough coins! Need ${cost - coins} more 🪙`); return; }
    try {
      const res = await fetch(`${API}/shop/purchase`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "ignored", item_id: itemId }),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(`${itemName} purchased! 🎉`);
        setPreviewItem(null);
        // Silent background reload — no spinner flash
        reloadShopSilently();
        refresh();
      } else {
        toast.error(result.reason || "Purchase failed");
      }
    } catch { toast.error("Purchase failed"); }
  };

  const handleToggleEquip = async (item: any) => {
    if (guestMode) { toast.error("Please login to equip items"); return; }

    // ── OPTIMISTIC UPDATE ─────────────────────────────────────────────────
    // Flip the equipped state locally *immediately* so the UI responds
    // without any spinner or full-page reload.
    setShopData((prev: any) => {
      if (!prev) return prev;
      const newItems = prev.items.map((i: any) => {
        if (i.category !== item.category) return i;
        // In a slot, only one item can be equipped at a time
        return { ...i, equipped: i.id === item.id ? !item.equipped : false };
      });
      const newEquipped = { ...(prev.equipped ?? {}) };
      if (item.equipped) {
        delete newEquipped[item.category];
      } else {
        newEquipped[item.category] = item.id;
      }
      return { ...prev, items: newItems, equipped: newEquipped };
    });

    // ── API CALL ──────────────────────────────────────────────────────────
    const endpoint = item.equipped ? "/shop/unequip" : "/shop/equip";
    const body = item.equipped
      ? { user_id: "ignored", slot: item.category }
      : { user_id: "ignored", item_id: item.id };
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(item.equipped ? `${item.name} unequipped!` : `${item.name} equipped! ⚡`);
        // Sync real state quietly in background (no spinner)
        reloadShopSilently();
        refresh();
      } else {
        // Rollback optimistic update on failure
        toast.error(result.reason || "Failed");
        reloadShopSilently();
      }
    } catch {
      toast.error("Request failed");
      reloadShopSilently();
    }
  };

  const handleTogglePreview = (item: any) => {
    setPreviewItem((prev: any) => prev?.id === item.id ? null : item);
  };

  const handleUseItem = async (itemId: string, itemName: string) => {
    if (guestMode) { toast.error("Please login to use items"); return; }
    try {
      const res = await fetch(`${API}/items/use`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(`${itemName} used! ${result.message || "Effect applied."}`);
        reloadShopSilently();
        refresh();
      } else {
        toast.error(result.detail || result.reason || "Could not use item");
      }
    } catch { toast.error("Request failed"); }
  };

  if (loading || !shopData) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-bg-primary to-bg-secondary">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-accent-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">Loading shop...</p>
        </div>
      </div>
    );
  }

  if (!shopData.shop_unlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-bg-primary to-bg-secondary p-6">
        <div className="bg-bg-card border border-border rounded-2xl p-8 text-center max-w-md backdrop-blur-xl">
          <Lock size={64} className="text-text-muted mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-text-primary mb-2">Shop Locked</h2>
          <p className="text-text-muted mb-4">Reach Level 5 to unlock the shop!</p>
          <div className="inline-block px-4 py-2 rounded-full bg-accent-gold/20 border border-accent-gold/30 text-accent-gold font-semibold mb-6">
            Currently Level {level} • Need Level 5
          </div>
          <div className="mt-4 flex justify-center"><HomeButton /></div>
        </div>
      </div>
    );
  }

  const catMeta      = CATEGORIES.find((c) => c.id === selectedCategory)!;
  const catUnlockLv  = CATEGORY_UNLOCK_LEVELS[selectedCategory] ?? 5;
  const catLocked    = level < catUnlockLv;
  const itemsInCategory = (shopData.items || []).filter(
    (item: any) => item.category === selectedCategory
  );

  return (
    <>
      <div className="flex h-screen bg-gradient-to-br from-bg-primary via-bg-secondary to-bg-primary overflow-hidden">

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <div className="w-80 border-r border-border/50 backdrop-blur-xl bg-bg-secondary/80 overflow-y-auto chat-scroll flex-shrink-0">
          <div className="p-6 flex flex-col gap-0">

            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                <ShoppingBag size={28} />
                Shop
              </h1>
              <HomeButton />
            </div>
            <p className="text-sm text-text-muted mb-4">Equip your character!</p>

            <div className="px-4 py-3 rounded-xl bg-gradient-to-r from-accent-gold/10 to-accent-gold/5 border border-accent-gold/30 mb-5">
              <p className="text-2xl font-bold text-accent-gold">{coins} 🪙</p>
              <p className="text-xs text-text-muted">Your Coins</p>
            </div>

            <p className="text-xs text-text-muted mb-2 uppercase tracking-wide">Your Character</p>

            {previewItem && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent-purple/15 border border-accent-purple/40 mb-2">
                <div className="flex items-center gap-2">
                  <Eye size={13} className="text-accent-purple" />
                  <span className="text-xs text-accent-purple font-semibold">Preview: {previewItem.name}</span>
                </div>
                <button onClick={() => setPreviewItem(null)} className="text-text-muted hover:text-text-primary transition-colors">
                  <X size={13} />
                </button>
              </div>
            )}

            <button
              onClick={() => router.push("/avatar")}
              className="w-full hover:opacity-80 transition-opacity mb-4 flex justify-center"
            >
              <AvatarDisplay equipped={previewEquipped} items={shopData.items || []} size="lg" />
            </button>

            <button
              onClick={() => router.push("/inventory")}
              className="w-full px-4 py-3 rounded-xl bg-accent-purple/10 hover:bg-accent-purple/20 border border-accent-purple/30 text-accent-purple font-medium transition-all flex items-center justify-center gap-2 mb-5"
            >
              <Package size={18} />
              Go to Inventory
            </button>

            <div className="mb-5">
              <ActiveBuffsSidebar />
            </div>

            <p className="text-xs text-text-muted mb-3 uppercase tracking-wide">Categories</p>
            <div className="space-y-2">
              {CATEGORIES.map((cat) => {
                const catLv     = CATEGORY_UNLOCK_LEVELS[cat.id] ?? 5;
                const isLocked  = level < catLv;
                const isActive  = selectedCategory === cat.id;
                const ownedCount = (shopData.items || []).filter(
                  (i: any) => i.category === cat.id && i.owned
                ).length;
                const totalCount = (shopData.items || []).filter(
                  (i: any) => i.category === cat.id
                ).length;

                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      isActive
                        ? "border-accent-gold bg-accent-gold/10 shadow-lg shadow-accent-gold/20"
                        : isLocked
                          ? "border-border/30 bg-bg-card/30 hover:border-border/60"
                          : "border-border/50 hover:border-accent-gold/30 bg-bg-card/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`text-2xl ${isLocked ? "grayscale opacity-50" : ""}`}>{cat.icon}</span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className={`text-sm font-semibold ${
                              isActive ? "text-accent-gold" : isLocked ? "text-text-muted" : "text-text-primary"
                            }`}>{cat.name}</p>
                            {isLocked && <Lock size={10} className="text-text-muted" />}
                          </div>
                          <p className="text-xs text-text-muted">
                            {isLocked ? `Unlocks at Lv ${catLv}` : `${ownedCount}/${totalCount} owned`}
                          </p>
                        </div>
                      </div>
                      {isActive && <ChevronRight size={16} className="text-accent-gold" />}
                    </div>
                  </button>
                );
              })}
            </div>

          </div>
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto chat-scroll">

          {catLocked ? (
            <div className="flex items-center justify-center h-full min-h-screen">
              <div className="bg-bg-card border border-border rounded-2xl p-8 text-center max-w-md w-full mx-4">
                <Lock size={64} className="text-text-muted mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-text-primary mb-2">{catMeta.name} Locked</h2>
                <p className="text-text-muted mb-4">Reach Level {catUnlockLv} to unlock {catMeta.name}!</p>
                <div className="inline-block px-4 py-2 rounded-full bg-accent-gold/20 border border-accent-gold/30 text-accent-gold font-semibold mb-6">
                  Currently Level {level} • Need Level {catUnlockLv}
                </div>
                <div className="flex justify-center"><HomeButton /></div>
              </div>
            </div>
          ) : (
          <div className="p-8">

            <div className="mb-6 pb-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <span className="text-5xl">{catMeta.icon}</span>
                <div>
                  <h2 className="text-3xl font-bold text-text-primary">{catMeta.name}</h2>
                  <p className="text-text-muted">{catMeta.desc}</p>
                </div>
              </div>
              <p className="text-xs text-text-muted mt-3 flex items-center gap-1.5">
                <Eye size={12} />
                Click any item to preview it on your avatar!
              </p>
            </div>

            {itemsInCategory.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-text-muted">No items in this category yet</p>
              </div>
            ) : selectedCategory === "potion" ? (
              <PotionShopSection
                items={itemsInCategory}
                coins={coins}
                onPurchase={handlePurchase}
                onUse={handleUseItem}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {itemsInCategory.map((item: any) => {
                  const isItemLocked = item.locked;
                  const isOwned      = item.owned;
                  const isEquipped   = item.equipped;
                  const isPreviewed  = previewItem?.id === item.id;
                  const qty          = item.quantity ?? 0;
                  const canAfford    = !isItemLocked && !(isOwned && !item.consumable) && item.can_afford;
                  const showPreviewBtn = !isEquipped;

                  return (
                    <div
                      key={item.id}
                      className={`relative p-4 rounded-2xl border transition-all backdrop-blur-sm ${
                        isPreviewed
                          ? "border-accent-purple bg-accent-purple/10 shadow-lg shadow-accent-purple/20"
                          : isEquipped
                            ? "border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20"
                            : isOwned
                              ? "border-accent-blue bg-accent-blue/5"
                              : isItemLocked
                                ? "border-border/40 bg-bg-card/20"
                                : "border-border/50 bg-bg-card/50 hover:border-accent-gold/50 hover:shadow-lg"
                      }`}
                    >
                      {isItemLocked && !isPreviewed && (
                        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-primary/90 backdrop-blur-sm border border-border/40">
                          <Lock size={10} className="text-text-muted" />
                          <span className="text-xs text-text-muted font-semibold">Lv {item.level_required}</span>
                        </div>
                      )}

                      {isEquipped && (
                        <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-green-500">
                          <Check size={14} className="text-white" />
                        </div>
                      )}

                      {isPreviewed && (
                        <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-accent-purple flex items-center gap-1 px-2">
                          <Eye size={11} className="text-white" />
                          <span className="text-white text-xs font-bold">ON</span>
                        </div>
                      )}

                      <button
                        onClick={() => showPreviewBtn && !item.consumable && handleTogglePreview(item)}
                        className={`w-full flex justify-center mb-3 ${showPreviewBtn && !item.consumable ? "cursor-pointer group" : "cursor-default"}`}
                        title={showPreviewBtn && !item.consumable ? `Preview ${item.name}` : ""}
                      >
                        <div className={`p-3 bg-gradient-to-br from-bg-primary/50 to-bg-secondary/50 rounded-xl backdrop-blur-sm border transition-all ${
                          isItemLocked ? "opacity-40 grayscale" : ""
                        } ${isPreviewed ? "border-accent-purple/60" : "border-border/20 group-hover:border-accent-purple/30"}`}>
                          <PixelSprite itemId={item.id} size="md" />
                        </div>
                      </button>

                      <div className="mb-3">
                        <h3 className={`text-sm font-bold mb-1 ${isItemLocked ? "text-text-muted" : "text-text-primary"}`}>
                          {item.name}
                        </h3>
                        <p className="text-xs text-text-muted mb-2">{item.description}</p>
                        <div className="flex items-center justify-between text-xs">
                          <span className={`font-bold ${isItemLocked ? "text-text-muted" : "text-accent-gold"}`}>
                            {item.price} 🪙
                          </span>
                          {isItemLocked && (
                            <span className="px-2 py-0.5 rounded-full bg-border/30 text-text-muted font-semibold">
                              Unlocks Lv {item.level_required}
                            </span>
                          )}
                          {!isItemLocked && item.consumable && (
                            <span className="px-2 py-0.5 bg-accent-purple/20 text-accent-purple rounded-full">
                              Consumable
                            </span>
                          )}
                        </div>
                      </div>

                      {isItemLocked && (
                        <div className="w-full py-2 rounded-lg text-xs text-center text-text-muted border border-border/30 bg-bg-primary/30 flex items-center justify-center gap-1.5">
                          <Lock size={11} />
                          Reach Level {item.level_required} to unlock
                        </div>
                      )}

                      {!isItemLocked && (!isOwned || (item.consumable && qty === 0)) && (
                        <div className="flex gap-2">
                          {!item.consumable && (
                            <button
                              onClick={() => handleTogglePreview(item)}
                              className={`py-2 px-3 rounded-lg text-sm transition-all flex items-center justify-center ${
                                isPreviewed
                                  ? "bg-accent-purple/20 text-accent-purple border border-accent-purple/40"
                                  : "bg-bg-primary/60 text-text-muted hover:text-accent-purple hover:bg-accent-purple/10 border border-border/40"
                              }`}
                              title={isPreviewed ? "Stop preview" : "Try on"}
                            >
                              <Eye size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => handlePurchase(item.id, item.price, item.name)}
                            disabled={!canAfford}
                            className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                              canAfford
                                ? "bg-accent-gold hover:bg-accent-gold/90 text-black"
                                : "bg-bg-primary text-text-muted border border-border cursor-not-allowed"
                            }`}
                          >
                            <ShoppingBag size={14} />
                            {canAfford ? "Buy" : "Can't Afford"}
                          </button>
                        </div>
                      )}

                      {isOwned && !item.consumable && (
                        <div className="flex gap-2">
                          {!isEquipped && (
                            <button
                              onClick={() => handleTogglePreview(item)}
                              className={`py-2 px-3 rounded-lg text-sm transition-all flex items-center justify-center ${
                                isPreviewed
                                  ? "bg-accent-purple/20 text-accent-purple border border-accent-purple/40"
                                  : "bg-bg-primary/60 text-text-muted hover:text-accent-purple hover:bg-accent-purple/10 border border-border/40"
                              }`}
                              title={isPreviewed ? "Stop preview" : "Try on"}
                            >
                              <Eye size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleEquip(item)}
                            className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${
                              isEquipped
                                ? "bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/30"
                                : "bg-accent-blue hover:bg-accent-blue/90 text-white"
                            }`}
                          >
                            {isEquipped
                              ? <span className="flex items-center justify-center gap-2"><Check size={14} /> Equipped</span>
                              : "Equip"
                            }
                          </button>
                        </div>
                      )}

                      {isOwned && item.consumable && qty > 0 && (
                        <button
                          onClick={() => handleUseItem(item.id, item.name)}
                          className="w-full py-2 bg-accent-purple hover:bg-accent-purple/90 text-white rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2"
                        >
                          ✨ Activate
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </>
  );
}