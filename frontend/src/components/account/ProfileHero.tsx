"use client";

import { useEffect, useState } from "react";
import { Coins, Flame, Sparkles, Trophy } from "lucide-react";
import { HeroFace } from "@/components/avatar";
import { AnimatedNumber, TiltCard } from "@/components/fx";
import { useHUDStore } from "@/hooks/useHUD";
import { lookFromEquipped } from "@/lib/avatar/look";
import { rawApi } from "@/lib/api";

/** The top of the profile: the hero's face in a lit ring, who they are, and four live stats that count up. */
export default function ProfileHero({ name, handle }: { name: string; handle?: string }) {
  const level = useHUDStore((s) => s.level);
  const xp = useHUDStore((s) => s.xp);
  const coins = useHUDStore((s) => s.coins);
  const streak = useHUDStore((s) => s.streakDays);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);
  const [equipped, setEquipped] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let alive = true;
    rawApi.GET("/shop").then(({ data, response }) => {
      if (alive && response.ok) setEquipped((data as { equipped?: Record<string, string> } | undefined)?.equipped ?? {});
    }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, []);

  const pct = xpToNext > 0 ? Math.min(100, (xpInto / xpToNext) * 100) : 0;
  const stats = [
    { label: "Level", value: level, icon: <Sparkles size={16} />, tone: "accent" },
    { label: "Total XP", value: xp, icon: <Trophy size={16} />, tone: "reward" },
    { label: "Coins", value: coins, icon: <Coins size={16} />, tone: "reward" },
    { label: "Day streak", value: streak, icon: <Flame size={16} />, tone: "warning" },
  ];

  return (
    <section className="profile-hero" aria-label="Your progress">
      <div className="profile-hero__id">
        <span className="profile-hero__ring" aria-hidden="true">
          {equipped ? <HeroFace look={lookFromEquipped(equipped)} diameter={84} /> : <span className="profile-hero__initial">{name[0]?.toUpperCase()}</span>}
        </span>
        <div className="min-w-0">
          <h2 className="profile-hero__name">{name}</h2>
          {handle && <p className="profile-hero__handle">@{handle}</p>}
          <div className="profile-hero__xp" role="progressbar" aria-label="XP to next level" aria-valuemin={0}
               aria-valuemax={xpToNext} aria-valuenow={xpInto}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="profile-hero__xptext">{xpInto} / {xpToNext} XP to level {level + 1}</p>
        </div>
      </div>
      <dl className="profile-hero__stats">
        {stats.map((s) => (
          <TiltCard key={s.label} className="profile-stat" data-tone={s.tone} max={6}>
            <dt className="profile-stat__label"><span aria-hidden="true">{s.icon}</span>{s.label}</dt>
            <dd className="profile-stat__value"><AnimatedNumber value={s.value} /></dd>
          </TiltCard>
        ))}
      </dl>
    </section>
  );
}
