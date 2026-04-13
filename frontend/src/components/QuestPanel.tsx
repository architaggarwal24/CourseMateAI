"use client";

import { useState, useEffect } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { claimQuest } from "@/lib/api";
import { toast } from "sonner";
import { CheckCircle2, Circle, Sparkles } from "lucide-react";

export default function QuestPanel() {
  const quests = useHUDStore((s) => s.quests);
  const userId = useHUDStore((s) => s.userId);
  const refresh = useHUDStore((s) => s.refresh);
  const guestMode = useHUDStore((s) => s.guestMode);

  const [claimingQuests, setClaimingQuests] = useState<Set<string>>(new Set());
  // Track locally claimed quests so UI updates instantly without waiting for backend refresh
  const [localClaimed, setLocalClaimed] = useState<Set<string>>(new Set());

  // Auto-refresh quests every 5s so completed quests appear quickly without manual page refresh
  useEffect(() => {
    if (guestMode) return;
    const interval = setInterval(() => { refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, [guestMode, refresh]);

  const handleClaim = async (questType: string) => {
    if (guestMode) {
      toast.error("Please login to claim rewards");
      return;
    }
    if (claimingQuests.has(questType) || localClaimed.has(questType)) return;

    setClaimingQuests((prev) => new Set(prev).add(questType));
    const result = await claimQuest(userId, questType);
    setClaimingQuests((prev) => { const n = new Set(prev); n.delete(questType); return n; });

    if (result?.ok) {
      setLocalClaimed((prev) => new Set(prev).add(questType));
      toast.success(`🎉 Claimed! +${result.xp_gained} XP | +${result.coins_gained} 🪙`, { icon: "✅", duration: 3000 });
      await refresh();
    } else if (result?.reason === "Already claimed") {
      // Race condition: backend already committed the claim, treat as success
      setLocalClaimed((prev) => new Set(prev).add(questType));
      await refresh();
    } else {
      toast.error(result?.reason || "Failed to claim quest");
    }
  };

  if (!quests || quests.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-text-muted italic">No quests today</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {quests.map((q: any, idx: number) => {
        const progress = q.current_count || 0;
        const target = q.target_count || 1;
        const completed = q.completed === 1 || q.completed === true;
        const claimed = q.claimed === 1 || q.claimed === true || localClaimed.has(q.quest_type);
        const pct = Math.min((progress / target) * 100, 100);
        const isClaiming = claimingQuests.has(q.quest_type);

        return (
          <div
            key={idx}
            className={`p-3 rounded-lg border transition-all ${
              completed && !claimed
                ? "border-accent-gold/50 bg-accent-gold/5"
                : claimed
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-border bg-bg-card"
            }`}
          >
            <div className="flex items-start gap-2 mb-2">
              {completed ? (
                <CheckCircle2 size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
              ) : (
                <Circle size={16} className="text-text-muted mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{q.description}</p>
                <p className="text-xs text-text-muted">
                  {progress}/{target} · {q.reward_xp} XP, {q.reward_coins} Coins
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="relative h-1.5 bg-bg-primary rounded-full overflow-hidden mb-2 ml-6">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-blue to-accent-purple rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            {completed && !claimed && !isClaiming && (
              <button
                onClick={() => handleClaim(q.quest_type)}
                className="w-full mt-1 py-1.5 bg-accent-gold text-black rounded text-xs font-semibold hover:bg-accent-gold/90 transition-all flex items-center justify-center gap-1"
              >
                <Sparkles size={12} />
                Claim Reward
              </button>
            )}

            {isClaiming && (
              <div className="w-full mt-1 py-1.5 bg-accent-gold/50 text-black rounded text-xs font-semibold text-center">
                Claiming...
              </div>
            )}

            {claimed && (
              <div className="w-full mt-1 py-1.5 bg-green-500/10 text-green-500 rounded text-xs font-semibold text-center border border-green-500/30 flex items-center justify-center gap-1">
                <CheckCircle2 size={12} />
                Claimed
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}