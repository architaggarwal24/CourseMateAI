"use client";

import { useEffect } from "react";
import { Coins, Flame, Sparkles, Trophy } from "@/components/ui/icons";
import ChampionAvatar from "@/components/champion/ChampionAvatar";
import { AnimatedNumber } from "@/components/fx";
import { useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { heroById, fighterLabel } from "@/lib/pixel/heroes";

/** The top of the profile: the pixel champion in a lit ring (with its pet), who they are, and four live stats that count up. */
export default function ProfileHero({ name, handle }: { name: string; handle?: string }) {
  const level = useHUDStore((s) => s.level);
  const xp = useHUDStore((s) => s.xp);
  const coins = useHUDStore((s) => s.coins);
  const streak = useHUDStore((s) => s.streakDays);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);
  const champion = fighterLabel(useChampion((s) => s.championId));

  useEffect(() => {
    void useChampion.getState().load({ signedIn: true });
    if (!useHeroStore.getState().shop) void useHeroStore.getState().loadShop();   // the skins it wears
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
        <span className="profile-hero__ring">
          <ChampionAvatar size={84} withPet label={`Your champion, ${champion.name}, ${champion.title}`} />
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
          <div key={s.label} className="profile-stat" data-tone={s.tone}>
            <dt className="profile-stat__label"><span aria-hidden="true">{s.icon}</span>{s.label}</dt>
            <dd className="profile-stat__value"><AnimatedNumber value={s.value} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
