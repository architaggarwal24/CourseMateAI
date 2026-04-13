"use client";

import { useState, useEffect } from "react";
import { Trophy, Lock, Star, Zap, Flame, Swords, TrendingUp, Shield } from "lucide-react";
import { fetchAchievements } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";

// ── Tier config ────────────────────────────────────────────────────────────
const TIER_CONFIG: Record<string, { label: string; color: string; glow: string; badge: string }> = {
  common:    { label: "Common",    color: "from-slate-500   to-slate-600",   glow: "shadow-slate-500/20",   badge: "bg-slate-500/20   text-slate-300   border-slate-500/30"   },
  rare:      { label: "Rare",      color: "from-blue-500    to-cyan-500",    glow: "shadow-blue-500/30",    badge: "bg-blue-500/20    text-blue-300    border-blue-500/30"    },
  epic:      { label: "Epic",      color: "from-purple-500  to-violet-600",  glow: "shadow-purple-500/40",  badge: "bg-purple-500/20  text-purple-300  border-purple-500/30"  },
  legendary: { label: "Legendary", color: "from-yellow-400  to-orange-500",  glow: "shadow-yellow-500/50",  badge: "bg-yellow-500/20  text-yellow-300  border-yellow-500/30"  },
};

// ── Achievement icon by unlock_type ────────────────────────────────────────
function AchievementIcon({ type, unlocked }: { type: string; unlocked: boolean }) {
  const cls = `w-8 h-8 ${unlocked ? "text-white" : "text-text-muted"}`;
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

  const tiers = ["all", "common", "rare", "epic", "legendary"];
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
        <div className="w-10 h-10 border-4 border-accent-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-gold/10 border border-accent-gold/20">
              <Trophy size={20} className="text-accent-gold" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Achievements</h2>
              <p className="text-xs text-text-muted">
                {guestMode ? "Log in to track your achievements" : `${unlockedCount} of ${achievements.length} unlocked`}
              </p>
            </div>
          </div>
          {!guestMode && achievements.length > 0 && (
            <div className="text-right">
              <div className="text-2xl font-black text-accent-gold">{Math.round((unlockedCount / achievements.length) * 100)}%</div>
              <div className="text-[10px] text-text-muted">complete</div>
            </div>
          )}
        </div>

        {/* Overall progress bar */}
        {!guestMode && achievements.length > 0 && (
          <div className="h-2 bg-bg-card rounded-full overflow-hidden border border-border-subtle mb-4">
            <div
              className="h-full bg-gradient-to-r from-accent-gold to-accent-purple transition-all duration-700 rounded-full"
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
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all capitalize ${
                filter === f
                  ? "bg-accent-gold/20 text-accent-gold border-accent-gold/40"
                  : "bg-bg-card text-text-muted border-border hover:border-accent-gold/30 hover:text-text-primary"
              }`}
            >
              {f}
            </button>
          ))}
          <div className="w-px bg-border mx-1" />
          {/* Tier filter */}
          {tiers.map((t) => {
            const tc = TIER_CONFIG[t];
            return (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all capitalize ${
                  tierFilter === t
                    ? tc ? `${tc.badge}` : "bg-accent-gold/20 text-accent-gold border-accent-gold/40"
                    : "bg-bg-card text-text-muted border-border hover:border-border-subtle hover:text-text-primary"
                }`}
              >
                {t === "all" ? "All Tiers" : tc?.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Achievement Grid ── */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted">
            <Trophy size={40} className="mb-3 opacity-20" />
            <p className="text-sm">No achievements match this filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((a) => {
              const isUnlocked = !!unlocked[a.achievement_id];
              const tc = TIER_CONFIG[a.tier] ?? TIER_CONFIG.common;
              const statValue = progress[a.unlock_type] ?? 0;
              const threshold = parseInt(a.unlock_threshold) || 1;
              const pct = Math.min(100, Math.round((statValue / threshold) * 100));
              const statLabel = STAT_LABEL[a.unlock_type] ?? a.unlock_type;

              return (
                <div
                  key={a.achievement_id}
                  className={`relative rounded-xl border p-4 transition-all duration-200 ${
                    isUnlocked
                      ? `bg-bg-card border-border shadow-lg ${tc.glow}`
                      : "bg-bg-card/50 border-border-subtle opacity-60"
                  }`}
                >
                  {/* Tier ribbon */}
                  <div className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${tc.badge}`}>
                    {tc.label}
                  </div>

                  <div className="flex items-start gap-3">
                    {/* Icon circle */}
                    <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${
                      isUnlocked ? tc.color : "from-bg-secondary to-bg-card"
                    } ${isUnlocked ? `shadow-md ${tc.glow}` : ""}`}>
                      {isUnlocked
                        ? <AchievementIcon type={a.unlock_type} unlocked={true} />
                        : <Lock size={20} className="text-text-muted opacity-50" />
                      }
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0 pr-16">
                      <h3 className={`text-sm font-bold leading-tight mb-0.5 ${isUnlocked ? "text-text-primary" : "text-text-muted"}`}>
                        {a.name}
                      </h3>
                      <p className="text-xs text-text-muted leading-snug">{a.description}</p>
                    </div>
                  </div>

                  {/* Progress (locked only, when stats available) */}
                  {!isUnlocked && !guestMode && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] text-text-muted mb-1">
                        <span>{statValue} / {threshold} {statLabel}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-bg-primary rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${tc.color} rounded-full transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Unlocked footer */}
                  {isUnlocked && (
                    <div className="mt-3 pt-3 border-t border-border-subtle/50 flex items-center justify-between">
                      <span className="text-[10px] text-text-muted">
                        Unlocked {relativeDate(unlocked[a.achievement_id])}
                      </span>
                      <div className="flex items-center gap-2 text-[10px]">
                        {parseInt(a.reward_xp) > 0 && (
                          <span className="text-accent-purple font-semibold">+{a.reward_xp} XP</span>
                        )}
                        {parseInt(a.reward_coins) > 0 && (
                          <span className="text-accent-gold font-semibold">+{a.reward_coins} 🪙</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Locked reward preview */}
                  {!isUnlocked && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
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