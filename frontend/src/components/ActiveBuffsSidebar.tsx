"use client";

import { useEffect, useState } from "react";
import { useHUDStore } from "@/hooks/useHUD";

// Only timed buffs belong in the sidebar — arena consumables (heals, veils)
// are shown exclusively in the arena HTML page and the shop/inventory pages.
const TIMED_BUFF_LABELS: Record<string, { icon: string; text: string; color: string }> = {
  xp_boost_1h:        { icon: "⚗️",  text: "Sage's Elixir  +50% XP",   color: "text-ink-purple" },
  xp_boost_2h:        { icon: "🌟",  text: "Grand Elixir  +100% XP",  color: "text-ink-purple" },
  coin_boost_1h:      { icon: "💰",  text: "Midas Tonic  +50% Coins", color: "text-ink-gold"   },
  streak_freeze:      { icon: "🧊",  text: "Streak Shield Active",     color: "text-ink-blue"   },
  reset_daily_quests: { icon: "⏳",  text: "Quests Reset",             color: "text-fg-muted"    },
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
  const pulseClass = isUrgent ? "animate-pulse" : "";

  return (
    <div className={`buff ${label.color} ${pulseClass}`} data-urgency={isUrgent ? "urgent" : isWarning ? "warning" : undefined}>
      <span>{label.icon} {label.text}</span>
      <span className="buff__time pixel-font">{fmt(remaining)}</span>
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
    <div className="buffs">
      <p className="buffs__label">Active Buffs</p>
      {timedEntries.map(([effect, data]) => (
        <TimedBuffRow key={effect} effect={effect} data={data} />
      ))}
    </div>
  );
}