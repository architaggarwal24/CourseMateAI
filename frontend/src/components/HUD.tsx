"use client";

import { useHUDStore } from "@/hooks/useHUD";

export default function HUD() {
  const level = useHUDStore((s) => s.level);
  const coins = useHUDStore((s) => s.coins);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);
  const guestMode = useHUDStore((s) => s.guestMode);

  const pct = Math.min((xpInto / Math.max(xpToNext, 1)) * 100, 100);

  return (
    <div className="px-4 py-3 border-b border-border-subtle space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">
          Level {level}
          {guestMode && (
            <span className="ml-2 text-xs text-text-muted font-normal">(Guest)</span>
          )}
        </span>
        <span className="text-xs text-accent-gold">{coins} 🪙</span>
      </div>

      <div className="relative h-2 bg-bg-card rounded-full overflow-hidden border border-border-subtle">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-blue to-accent-purple rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-[10px] text-text-muted">
        <span>{xpInto}/{xpToNext} XP</span>
      </div>
    </div>
  );
}