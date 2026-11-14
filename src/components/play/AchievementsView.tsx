"use client";

import { useState, useEffect } from "react";
import { Coins, Trophy, Lock, Star, Zap, Flame, Swords, TrendingUp, Shield } from "@/components/ui/icons";
import { fetchAchievements } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { Badge } from "@/components/ui";
import FilterBar from "./FilterBar";
import PixelLoader from "./PixelLoader";
import { RARITIES, RARITY_LABEL, isRarity, rarityClass, type Rarity } from "@/lib/game/rarity";

// An achievement's tier is its rarity: colours come from the rarity tokens (lib/game/rarity.ts), never from here.
const tierOf = (tier: unknown): Rarity => (isRarity(tier) ? tier : "common");

// ── Achievement icon by unlock_type ────────────────────────────────────────
function AchievementIcon({ type, unlocked }: { type: string; unlocked: boolean }) {
  const cls = `w-8 h-8 ${unlocked ? "" : "text-fg-muted"}`;
  if (type.includes("quiz"))          return <Star className={cls} />;
  if (type.includes("streak"))        return <Flame className={cls} />;
  if (type.includes("boss"))          return <Swords className={cls} />;
  if (type.includes("level"))         return <TrendingUp className={cls} />;
  if (type.includes("accuracy"))      return <Zap className={cls} />;
  if (type.includes("nightmare"))     return <Shield className={cls} />;
  return <Trophy className={cls} />;
}

// ── Progress bar helpers ───────────────────────────────────────────────────
const STAT_LABEL: Record<string, string> = {
  total_quizzes_completed:   "quizzes",
  streak_days:               "day streak",
  total_bosses_defeated:     "bosses defeated",
  current_level:             "level",
  best_quiz_accuracy:        "% accuracy",
  nightmare_bosses_defeated: "nightmare clears",
};

function relativeDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

// ── Main component ─────────────────────────────────────────────────────────
export default function AchievementsView() {
  const guestMode = useHUDStore((s) => s.guestMode);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [unlocked, setUnlocked] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [tierFilter, setTierFilter] = useState<"all" | Rarity>("all");

  useEffect(() => {
    fetchAchievements()
      .then((d) => {
        setAchievements(d?.achievements ?? []);
        setUnlocked(d?.unlocked ?? {});
        setProgress(d?.progress ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tiers = ["all", ...RARITIES] as const;
  const unlockedCount = achievements.filter((a) => unlocked[a.achievement_id]).length;

  const filtered = achievements.filter((a) => {
    const isUnlocked = !!unlocked[a.achievement_id];
    if (filter === "unlocked" && !isUnlocked) return false;
    if (filter === "locked"   && isUnlocked)  return false;
    if (tierFilter !== "all"  && a.tier !== tierFilter) return false;
    return true;
  });

  if (loading) return <PixelLoader label="Opening the trophy case" />;

  const count = (pred: (a: any) => boolean) => achievements.filter(pred).length;
  const pctDone = achievements.length ? Math.round((unlockedCount / achievements.length) * 100) : 0;

  return (
    <div className="ach">
      <header className="ach__head">
        <div className="ach__title">
          <Trophy size={22} aria-hidden="true" className="ach__trophy" />
          <div>
            <h2 className="collection-title__name">Achievements</h2>
            <p className="collection-title__desc">{guestMode ? "Log in to track your achievements" : `${unlockedCount} of ${achievements.length} unlocked`}</p>
          </div>
          {!guestMode && achievements.length > 0 && <p className="ach__pct pixel-font">{pctDone}%<span>complete</span></p>}
        </div>
        {!guestMode && achievements.length > 0 && (
          <div className="px-meter" role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctDone}>
            <span style={{ width: `${pctDone}%` }} />
          </div>
        )}
        <div className="ach__filters">
          <FilterBar label="Show" value={filter} onChange={setFilter} options={[
            { id: "all", label: "All", count: achievements.length },
            { id: "unlocked", label: "Unlocked", count: unlockedCount },
            { id: "locked", label: "Locked", count: achievements.length - unlockedCount },
          ]} />
          <FilterBar label="Tier" value={tierFilter} onChange={setTierFilter} options={tiers.map((t) => ({
            id: t, label: t === "all" ? "Every tier" : RARITY_LABEL[t],
            icon: t === "all" ? undefined : <span className={`ach__dot ${rarityClass(t)}`} aria-hidden="true" />,
            count: t === "all" ? undefined : count((a) => tierOf(a.tier) === t),
          }))} />
        </div>
      </header>

      <div className="ach__body" role="region" aria-label="Achievements" tabIndex={0}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-fg-muted">
            <Trophy size={40} className="mb-3 opacity-20" />
            <p className="text-sm">No achievements match this filter</p>
          </div>
        ) : (
          <ul className="ach__grid">
            {filtered.map((a) => {
              const isUnlocked = !!unlocked[a.achievement_id];
              const tier = tierOf(a.tier);
              const statValue = progress[a.unlock_type] ?? 0;
              const threshold = parseInt(a.unlock_threshold) || 1;
              const pct = Math.min(100, Math.round((statValue / threshold) * 100));
              const statLabel = STAT_LABEL[a.unlock_type] ?? a.unlock_type;
              return (
                <li key={a.achievement_id} className={`ach-card ${rarityClass(tier)}`} data-unlocked={isUnlocked || undefined}>
                  <div className="ach-card__top">
                    <span className="ach-card__icon">
                      {isUnlocked ? <AchievementIcon type={a.unlock_type} unlocked={true} /> : <Lock size={20} role="img" aria-label="Locked" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="ach-card__name">{a.name}</h3>
                      <p className="ach-card__desc">{a.description}</p>
                    </div>
                    <Badge tone={tier}>{RARITY_LABEL[tier]}</Badge>
                  </div>
                  {!isUnlocked && !guestMode && (
                    <div className="ach-card__progress">
                      <span className="ach-card__line"><span>{statValue} / {threshold} {statLabel}</span><span>{pct}%</span></span>
                      <span className="px-meter px-meter--thin" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                    </div>
                  )}
                  <div className="ach-card__foot">
                    <span>{isUnlocked ? `Unlocked ${relativeDate(unlocked[a.achievement_id])}` : "Reward"}</span>
                    <span className="ach-card__reward">
                      {parseInt(a.reward_xp) > 0 && <span className="text-ink-purple">+{a.reward_xp} XP</span>}
                      {parseInt(a.reward_coins) > 0 && <span className="text-ink-gold inline-flex items-center gap-1">+{a.reward_coins}<Coins size={12} aria-label="coins" /></span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
