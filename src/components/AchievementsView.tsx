"use client";

import { useState, useEffect } from "react";
import { Trophy, Lock, Star, Zap, Flame, Swords, TrendingUp, Shield } from "lucide-react";
import { fetchAchievements } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { Badge } from "@/components/ui";
import { RARITIES, RARITY_LABEL, isRarity, rarityClass, type Rarity } from "@/lib/rarity";

// An achievement's tier is its rarity: colours come from the rarity tokens (lib/rarity.ts), never from here.
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
  const [tierFilter, setTierFilter] = useState<string>("all");

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

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-10 h-10 border-4 border-ink-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-canvas overflow-hidden">
      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-line-subtle bg-sunken/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-gold/10 border border-ink-gold/20">
              <Trophy size={20} className="text-ink-gold" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-fg">Achievements</h2>
              <p className="text-xs text-fg-muted">
                {guestMode ? "Log in to track your achievements" : `${unlockedCount} of ${achievements.length} unlocked`}
              </p>
            </div>
          </div>
          {!guestMode && achievements.length > 0 && (
            <div className="text-right">
              <div className="text-2xl font-black text-ink-gold">{Math.round((unlockedCount / achievements.length) * 100)}%</div>
              <div className="text-xs text-fg-muted">complete</div>
            </div>
          )}
        </div>

        {/* Overall progress bar */}
        {!guestMode && achievements.length > 0 && (
          <div className="h-2 bg-panel rounded-full overflow-hidden border border-line-subtle mb-4">
            <div
              className="h-full bg-accent-gold transition-all duration-700 rounded-full"
              style={{ width: `${(unlockedCount / achievements.length) * 100}%` }}
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Status filter */}
          {(["all", "unlocked", "locked"] as const).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all capitalize ${
                filter === f
                  ? "bg-accent-gold/20 text-ink-gold border-ink-gold/40"
                  : "bg-panel text-fg-muted border-line hover:border-ink-gold/30 hover:text-fg"
              }`}
            >
              {f}
            </button>
          ))}
          <div className="w-px bg-line mx-1" />
          {/* Tier filter */}
          {tiers.map((t) => (
            <button
              key={t}
              aria-pressed={tierFilter === t}
              onClick={() => setTierFilter(t)}
              className={`${t === "all" ? "" : rarityClass(t)} min-h-11 md:min-h-0 px-3 py-1 rounded-lg text-xs font-semibold border transition-all capitalize ${
                tierFilter === t
                  ? t === "all" ? "bg-accent-gold/20 text-ink-gold border-ink-gold/40" : "bg-panel border-[color:var(--rarity)] text-[color:var(--rarity)]"
                  : "bg-panel text-fg-muted border-line hover:border-line-subtle hover:text-fg"
              }`}
            >
              {t === "all" ? "All Tiers" : RARITY_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Achievement Grid ── */}
      <div className="flex-1 overflow-y-auto px-5 py-5" role="region" aria-label="Achievements" tabIndex={0}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-fg-muted">
            <Trophy size={40} className="mb-3 opacity-20" />
            <p className="text-sm">No achievements match this filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((a) => {
              const isUnlocked = !!unlocked[a.achievement_id];
              const tier = tierOf(a.tier);
              const statValue = progress[a.unlock_type] ?? 0;
              const threshold = parseInt(a.unlock_threshold) || 1;
              const pct = Math.min(100, Math.round((statValue / threshold) * 100));
              const statLabel = STAT_LABEL[a.unlock_type] ?? a.unlock_type;

              return (
                <div
                  key={a.achievement_id}
                  className={`${rarityClass(tier)} relative rounded-xl border p-4 transition-all duration-200 bg-panel ${
                    isUnlocked ? "border-[color:var(--rarity)]" : "border-line-subtle"
                  }`}
                >
                  {/* Tier ribbon */}
                  <Badge tone={tier} className="absolute top-3 right-3">{RARITY_LABEL[tier]}</Badge>

                  <div className="flex items-start gap-3">
                    {/* Icon circle */}
                    <div
                      className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${isUnlocked ? "" : "bg-sunken"}`}
                      style={isUnlocked ? { background: "var(--rarity)", color: "var(--color-surface)" } : undefined}
                    >
                      {isUnlocked
                        ? <AchievementIcon type={a.unlock_type} unlocked={true} />
                        : <Lock size={20} className="text-fg-muted" role="img" aria-label="Locked" />
                      }
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0 pr-16">
                      <h3 className={`text-sm font-bold leading-tight mb-0.5 ${isUnlocked ? "text-fg" : "text-fg-muted"}`}>
                        {a.name}
                      </h3>
                      <p className="text-xs text-fg-muted leading-snug">{a.description}</p>
                    </div>
                  </div>

                  {/* Progress (locked only, when stats available) */}
                  {!isUnlocked && !guestMode && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-fg-muted mb-1">
                        <span>{statValue} / {threshold} {statLabel}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: "var(--rarity)" }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Unlocked footer */}
                  {isUnlocked && (
                    <div className="mt-3 pt-3 border-t border-line-subtle/50 flex items-center justify-between">
                      <span className="text-xs text-fg-muted">
                        Unlocked {relativeDate(unlocked[a.achievement_id])}
                      </span>
                      <div className="flex items-center gap-2 text-xs">
                        {parseInt(a.reward_xp) > 0 && (
                          <span className="text-ink-purple font-semibold">+{a.reward_xp} XP</span>
                        )}
                        {parseInt(a.reward_coins) > 0 && (
                          <span className="text-ink-gold font-semibold">+{a.reward_coins} 🪙</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Locked reward preview */}
                  {!isUnlocked && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                      <span>Reward:</span>
                      {parseInt(a.reward_xp) > 0 && <span>+{a.reward_xp} XP</span>}
                      {parseInt(a.reward_coins) > 0 && <span>+{a.reward_coins} 🪙</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}