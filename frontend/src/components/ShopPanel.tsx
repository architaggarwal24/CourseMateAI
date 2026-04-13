"use client";

import { useEffect, useState } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { purchaseItem, equipItem } from "@/lib/api";
import { toast } from "sonner";
import { ShoppingBag, Check, Lock, Zap } from "lucide-react";

// Timed buff countdown — arena consumables are never shown here
function BuffTimer({ effect, data }: { effect: string; data: any }) {
  const [remaining, setRemaining] = useState(0);

  const TIMED_LABELS: Record<string, { icon: string; text: string; color: string }> = {
    xp_boost_1h:   { icon: "⚗️", text: "+50% XP",      color: "text-accent-purple" },
    xp_boost_2h:   { icon: "🌟", text: "+100% XP",     color: "text-accent-purple" },
    coin_boost_1h: { icon: "💰", text: "+50% Coins",   color: "text-accent-gold"   },
    streak_freeze: { icon: "🧊", text: "Streak Shield", color: "text-accent-blue"   },
  };

  const label = TIMED_LABELS[effect];

  useEffect(() => {
    if (!label) return;
    const update = () => {
      const now = Date.now() / 1000;
      setRemaining(Math.max(0, Math.floor((data.expires_at || 0) - now)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [effect, data.expires_at]);

  if (!label) return null;

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className={`flex items-center justify-between text-[10px] ${label.color} px-3 py-1.5 rounded bg-bg-primary border border-border-subtle`}>
      <span className="flex items-center gap-1">
        <Zap size={10} />
        {label.icon} {label.text}
      </span>
      <span className="font-mono tabular-nums">{fmt(remaining)}</span>
    </div>
  );
}

export default function ShopPanel() {
  const shop = useHUDStore((s) => s.shop);
  const userId = useHUDStore((s) => s.userId);
  const coins = useHUDStore((s) => s.coins);
  const level = useHUDStore((s) => s.level);
  const refresh = useHUDStore((s) => s.refresh);
  const guestMode = useHUDStore((s) => s.guestMode);
  const buffs = useHUDStore((s) => s.buffs);

  // Only show timed buffs — arena consumables (heals, veils) never appear here
  const TIMED_BUFF_KEYS = new Set(["xp_boost_1h", "xp_boost_2h", "coin_boost_1h", "streak_freeze"]);
  const activeBuffEntries = Object.entries(buffs || {}).filter(([k]) => TIMED_BUFF_KEYS.has(k));

  const handlePurchase = async (itemId: string, cost: number) => {
    if (guestMode) { toast.error("Please login to purchase items"); return; }
    if (coins < cost) { toast.error("Not enough coins!"); return; }
    const result = await purchaseItem(userId, itemId);
    if (result?.ok) { toast.success("Item purchased!"); refresh(); }
    else toast.error(result?.error || "Purchase failed");
  };

  const handleEquip = async (itemId: string) => {
    if (guestMode) { toast.error("Please login to equip items"); return; }
    const result = await equipItem(userId, itemId);
    if (result?.ok) { toast.success("Item equipped!"); refresh(); }
    else toast.error("Failed to equip item");
  };

  if (!shop?.shop_unlocked) {
    return (
      <div className="p-4 text-center space-y-2">
        <Lock size={28} className="mx-auto text-text-muted" />
        <p className="text-sm text-text-muted">Shop unlocks at Level 5</p>
        <p className="text-xs text-text-muted">(Currently Level {level})</p>
      </div>
    );
  }

  const items = shop?.items || [];
  if (items.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-text-muted italic">No items available</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-muted">Your Coins:</p>
        <p className="text-sm font-semibold text-accent-gold">{coins} 🪙</p>
      </div>

      {/* Active buff timers — shown at the top of the shop panel so users
          always know how long their potions have left without opening inventory */}
      {activeBuffEntries.length > 0 && (
        <div className="space-y-1 pb-2 border-b border-border-subtle/50">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Active Buffs</p>
          {activeBuffEntries.map(([effect, data]) => (
            <BuffTimer key={effect} effect={effect} data={data} />
          ))}
        </div>
      )}

      {items.map((item: any, idx: number) => {
        const owned = item.owned || false;
        const equipped = item.equipped || false;
        const canAfford = coins >= item.cost;

        return (
          <div
            key={idx}
            className="p-3 rounded-lg bg-bg-card border border-border hover:border-accent-gold/30 transition-all"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-text-primary">{item.name}</p>
                <p className="text-xs text-text-muted">{item.description}</p>
              </div>
              <span className="text-xs font-semibold text-accent-gold whitespace-nowrap ml-2">
                {item.cost} 🪙
              </span>
            </div>

            {!owned && (
              <button
                onClick={() => handlePurchase(item.id, item.cost)}
                disabled={!canAfford}
                className={`w-full mt-2 py-1.5 rounded text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                  canAfford
                    ? "bg-accent-gold text-black hover:bg-accent-gold/90"
                    : "bg-bg-primary text-text-muted cursor-not-allowed border border-border"
                }`}
              >
                <ShoppingBag size={12} />
                {canAfford ? "Purchase" : "Not Enough Coins"}
              </button>
            )}

            {owned && !equipped && (
              <button
                onClick={() => handleEquip(item.id)}
                className="w-full mt-2 py-1.5 bg-accent-blue text-white rounded text-xs font-semibold hover:bg-accent-blue/90 transition-all"
              >
                Equip
              </button>
            )}

            {equipped && (
              <div className="w-full mt-2 py-1.5 bg-green-500/10 text-green-500 rounded text-xs font-semibold text-center border border-green-500/30 flex items-center justify-center gap-1">
                <Check size={12} /> Equipped
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}