"use client";

import { useState, useEffect } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { toast } from "sonner";
import { Package, Check, ShoppingBag } from "lucide-react";
import AvatarDisplay from "@/components/AvatarDisplay";
import HomeButton from "@/components/HomeButton";
import PixelSprite from "@/components/PixelSprite";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const TABS = [
  { id: "equipment", name: "Equipment", icon: "⚔️" },
  { id: "pets", name: "Pets", icon: "🐱" },
  { id: "consumables", name: "Consumables", icon: "🧪" },
  { id: "titles", name: "Titles", icon: "🏆" },
];

// Only shown for timed buffs (XP boost, coin boost) — not arena consumables
function BuffBadge({ effect, buffs }: { effect: string | null; buffs: Record<string, any> }) {
  const [remaining, setRemaining] = useState(0);
  const ARENA_EFFECTS = new Set(["heal_1", "fifty_fifty", "hint_charges"]);

  useEffect(() => {
    if (!effect || !buffs[effect] || ARENA_EFFECTS.has(effect)) return;
    const update = () => {
      const now = Date.now() / 1000;
      setRemaining(Math.max(0, Math.floor(buffs[effect].expires_at - now)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [effect, buffs]);

  if (!effect || !buffs[effect]) return null;
  if (ARENA_EFFECTS.has(effect)) return null; // arena consumables never show here

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="text-xs text-accent-purple font-semibold mt-1">
      ✨ Active — {fmt(remaining)} left
    </div>
  );
}

export default function InventoryPage() {
  const router = useRouter();
  const guestMode = useHUDStore((s) => s.guestMode);
  const refresh = useHUDStore((s) => s.refresh);
  const hudBuffs = useHUDStore((s) => s.buffs);

  const [activeTab, setActiveTab] = useState("equipment");
  const [shopData, setShopData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [usingItem, setUsingItem] = useState<string | null>(null);

  useEffect(() => { loadInventory(); }, []);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/shop`, { credentials: "include" });
      if (res.ok) setShopData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleToggleEquip = async (item: any) => {
    if (guestMode) { toast.error("Please login"); return; }
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
        await loadInventory(); await refresh();
      } else toast.error(result.reason || "Failed");
    } catch { toast.error("Request failed"); }
  };

  const handleUse = async (item: any) => {
    if (guestMode) { toast.error("Please login"); return; }
    if (usingItem) return;
    setUsingItem(item.id);
    try {
      const res = await fetch(`${API}/items/use`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id }),
      });
      const result = await res.json();
      if (res.ok && result.ok) {
        toast.success(result.message || `${item.name} used!`);
        await loadInventory(); await refresh();
      } else {
        toast.error(result.detail || result.reason || "Could not use item");
      }
    } catch { toast.error("Failed to use item"); }
    setUsingItem(null);
  };

  if (loading || !shopData) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-bg-primary to-bg-secondary">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-accent-purple border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">Loading inventory...</p>
        </div>
      </div>
    );
  }

  const ownedItems = (shopData.items || []).filter((i: any) => i.owned);

  const getItemsForTab = () => {
    switch (activeTab) {
      case "equipment": return ownedItems.filter((i: any) => ["headgear", "armor", "weapon"].includes(i.category));
      case "pets": return ownedItems.filter((i: any) => i.category === "pet");
      case "consumables": return ownedItems.filter((i: any) => ["potion", "special"].includes(i.category) && i.consumable && (i.quantity ?? 0) > 0);
      case "titles": return ownedItems.filter((i: any) => i.category === "title");
      default: return [];
    }
  };

  const tabItems = getItemsForTab();

  return (
    <div className="flex h-screen bg-gradient-to-br from-bg-primary via-bg-secondary to-bg-primary overflow-hidden">
      <div className="w-80 border-r border-border/50 backdrop-blur-xl bg-bg-secondary/80 flex flex-col overflow-y-auto chat-scroll">
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Package size={28} /> Inventory
            </h1>
            <HomeButton />
          </div>
          <p className="text-sm text-text-muted mb-4">{ownedItems.length} items owned</p>
          <button
            onClick={() => router.push("/shop")}
            className="w-full px-4 py-3 rounded-xl bg-accent-gold/10 hover:bg-accent-gold/20 border border-accent-gold/30 text-accent-gold font-medium transition-all flex items-center justify-center gap-2"
          >
            <ShoppingBag size={18} /> Visit Shop
          </button>
        </div>

        {Object.entries(hudBuffs || {}).filter(([e]) =>
          ["xp_boost_1h","xp_boost_2h","coin_boost_1h","streak_freeze"].includes(e)
        ).length > 0 && (
          <div className="px-6 py-4 border-b border-border/50">
            <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Active Buffs</p>
            <div className="space-y-1">
              {Object.entries(hudBuffs)
                .filter(([e]) => ["xp_boost_1h","xp_boost_2h","coin_boost_1h","streak_freeze"].includes(e))
                .map(([effect]) => (
                  <BuffBadge key={effect} effect={effect} buffs={hudBuffs} />
                ))}
            </div>
          </div>
        )}

        <div className="p-8 border-b border-border/50">
          <p className="text-xs text-text-muted mb-4 uppercase tracking-wide text-center">Your Character</p>
          <button onClick={() => router.push("/avatar")} className="w-full hover:opacity-80 transition-opacity">
            <div className="flex justify-center mb-4">
              <AvatarDisplay equipped={shopData.equipped || {}} items={shopData.items || []} size="lg" />
            </div>
          </button>
          <div className="space-y-2">
            <p className="text-xs text-text-muted">Currently Equipped:</p>
              {Object.entries(shopData.equipped || {}).map(([slot, itemId]: any) => {
              const item = shopData.items.find((i: any) => i.id === itemId);
              if (!item) return null;
              return (
                <div key={slot} className="flex items-center gap-2 p-2 bg-bg-primary/50 rounded-lg border border-border/30">
                  <PixelSprite itemId={item.id} size="xs" />
                  <span className="text-xs text-text-secondary truncate">{item.name}</span>
                </div>
              );
            })}
            {Object.keys(shopData.equipped || {}).length === 0 && (
              <p className="text-xs text-text-muted italic">No items equipped</p>
            )}
          </div>
        </div>

        <div className="p-6">
          <p className="text-xs text-text-muted mb-3 uppercase tracking-wide">Collection Stats</p>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-text-secondary">Total Items:</span>
              <span className="text-sm font-bold text-text-primary">{ownedItems.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-text-secondary">Equipped:</span>
              <span className="text-sm font-bold text-accent-gold">
                {Object.keys(shopData.equipped || {}).filter((k) => shopData.equipped[k]).length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex border-b border-border/50 backdrop-blur-xl bg-bg-secondary/80">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-4 font-semibold transition-all ${
                activeTab === tab.id
                  ? "border-b-2 border-accent-gold text-accent-gold bg-accent-gold/5"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <span className="text-xl mr-2">{tab.icon}</span>
              {tab.name}
              <span className="ml-2 text-xs opacity-70">({getItemsForTab().length})</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto chat-scroll p-8">
          {tabItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Package size={64} className="text-text-muted mb-4 opacity-30" />
              <p className="text-text-muted text-lg mb-2">No items in this category</p>
              <p className="text-text-muted text-sm">Visit the shop to purchase items!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {tabItems.map((item: any) => {
                const isEquipped = item.equipped;
                const isConsumable = item.consumable;
                const qty = item.quantity ?? 0;
                const isUsing = usingItem === item.id;
                const ARENA_CONSUMABLE_EFFECTS = new Set(["heal_1", "fifty_fifty"]);
                const isArenaConsumable = ARENA_CONSUMABLE_EFFECTS.has(item.effect);
                // isActive only applies to timed buffs — never blocks arena consumables
                const isActive = !isArenaConsumable && !!(item.effect && hudBuffs && hudBuffs[item.effect]);
                // For arena consumables count badge: inv qty (buff charges shown separately in arena)
                const arenaBuffCount = 0; // buff charges tracked in arena only

                return (
                  <div
                    key={item.id}
                    className={`relative p-4 rounded-2xl border transition-all backdrop-blur-sm ${
                      isArenaConsumable && arenaBuffCount > 0
                        ? "border-red-500/50 bg-red-500/5"
                        : isActive
                        ? "border-accent-purple bg-accent-purple/10 shadow-lg shadow-accent-purple/20"
                        : isEquipped
                        ? "border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20"
                        : "border-accent-blue bg-accent-blue/5"
                    }`}
                  >
                    {isEquipped && !isConsumable && (
                      <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-green-500">
                        <Check size={14} className="text-white" />
                      </div>
                    )}
                    {isConsumable && qty > 0 && (
                      <div className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-white text-xs font-bold ${
                        isArenaConsumable ? "bg-red-600" : "bg-accent-purple"
                      }`}>
                        ×{qty}
                      </div>
                    )}

                    <div className="flex justify-center mb-3">
                      <div className="p-3 bg-gradient-to-br from-bg-primary/50 to-bg-secondary/50 rounded-xl border border-border/20">
                        <PixelSprite itemId={item.id} size="md" />
                      </div>
                    </div>

                    <div className="mb-3">
                      <h3 className="text-sm font-bold text-text-primary mb-1">{item.name}</h3>
                      <p className="text-xs text-text-muted">{item.description}</p>
                      {isConsumable && <p className="text-xs text-accent-purple mt-1">✨ Consumable</p>}
                      {isActive && <BuffBadge effect={item.effect} buffs={hudBuffs} />}
                    </div>

                    {!isConsumable && (
                      <button
                        onClick={() => handleToggleEquip(item)}
                        className={`w-full py-2 rounded-lg font-semibold text-sm transition-all ${
                          isEquipped
                            ? "bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/30"
                            : "bg-accent-blue hover:bg-accent-blue/90 text-white"
                        }`}
                      >
                        {isEquipped ? <span className="flex items-center justify-center gap-2"><Check size={14} /> Equipped</span> : "Equip"}
                      </button>
                    )}

                    {isConsumable && (
                      <button
                        onClick={() => handleUse(item)}
                        disabled={isUsing || qty < 1}
                        className={`w-full py-2 rounded-lg font-semibold text-sm transition-all ${
                          qty < 1
                            ? "bg-bg-card text-text-muted cursor-not-allowed border border-border"
                            : isArenaConsumable
                            ? "bg-red-600/80 hover:bg-red-600 text-white"
                            : "bg-accent-purple hover:bg-accent-purple/90 text-white"
                        }`}
                      >
                        {isUsing
                          ? "Using..."
                          : qty < 1
                          ? "None left"
                          : isArenaConsumable
                          ? `Queue for Arena${qty > 1 ? ` (×${qty})` : ""}`
                          : `Use${qty > 1 ? ` (×${qty})` : ""}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}