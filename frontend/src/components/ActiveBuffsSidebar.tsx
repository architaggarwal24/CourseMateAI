"use client";

import { useEffect, useState } from "react";
import { useHUDStore } from "@/hooks/useHUD";

// Only timed buffs belong in the sidebar — arena consumables (heals, veils)
// are shown exclusively in the arena HTML page and the shop/inventory pages.
const TIMED_BUFF_LABELS: Record<string, { icon: string; text: string; color: string }> = {
  xp_boost_1h:        { icon: "⚗️",  text: "Sage's Elixir  +50% XP",   color: "text-accent-purple" },
  xp_boost_2h:        { icon: "🌟",  text: "Grand Elixir  +100% XP",  color: "text-accent-purple" },
  coin_boost_1h:      { icon: "💰",  text: "Midas Tonic  +50% Coins", color: "text-accent-gold"   },
  streak_freeze:      { icon: "🧊",  text: "Streak Shield Active",     color: "text-accent-blue"   },
  reset_daily_quests: { icon: "⏳",  text: "Quests Reset",             color: "text-text-muted"    },
};

// Arena consumables — never shown in sidebar, only inside the arena
const ARENA_ONLY_EFFECTS = new Set(["heal_1", "fifty_fifty", "hint_charges"]);

function fmt(s: number) {
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function TimedBuffRow({ effect, data }: { effect: string; data: any }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const now = Date.now() / 1000;
      setRemaining(Math.max(0, Math.floor((data.expires_at || 0) - now)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [data.expires_at]);

  const label = TIMED_BUFF_LABELS[effect];
  if (!label) return null;

  const isUrgent   = remaining <= 60;
  const isWarning  = remaining <= 300;
  const timerColor = isUrgent ? "text-red-400" : isWarning ? "text-amber-400" : "opacity-80";
  const pulseClass = isUrgent ? "animate-pulse" : "";

  return (
    <div className={`flex items-center justify-between text-[10px] ${label.color} px-2 py-1.5 rounded bg-bg-primary border border-border-subtle ${pulseClass}`}>
      <span>{label.icon} {label.text}</span>
      <span className={`font-mono tabular-nums ${timerColor}`}>{fmt(remaining)}</span>
    </div>
  );
}

export default function ActiveBuffsSidebar() {
  const buffs = useHUDStore((s) => s.buffs);

  // Only show timed buffs with a real timer — never arena consumables
  const timedEntries = Object.entries(buffs || {}).filter(
    ([effect]) => !ARENA_ONLY_EFFECTS.has(effect) && effect in TIMED_BUFF_LABELS
  );

  if (timedEntries.length === 0) return null;

  return (
    <div className="space-y-1 pt-1">
      <p className="text-[10px] text-text-muted uppercase tracking-wide px-1">Active Buffs</p>
      {timedEntries.map(([effect, data]) => (
        <TimedBuffRow key={effect} effect={effect} data={data} />
      ))}
    </div>
  );
}