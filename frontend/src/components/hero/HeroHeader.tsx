"use client";

import { Coins, Flame, ShieldPlus, X } from "lucide-react";
import { motion } from "motion/react";
import { HeroFace } from "@/components/avatar";
import { lookFromEquipped } from "@/lib/avatar/look";
import { Button } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { previewEquipped, useHeroStore } from "@/hooks/useHero";

/**
 * Always on top of the Hero area, whatever tab is open: the avatar (with whatever is being tried on), level, XP bar,
 * coins and streak. All of it is read from the two shared stores, so a purchase or a claim changes it the moment
 * it happens. Pixel font only for the short labels and numbers.
 */
export default function HeroHeader() {
  const level = useHUDStore((s) => s.level);
  const coins = useHUDStore((s) => s.coins);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);
  const streakDays = useHUDStore((s) => s.streakDays);
  const streakFreezes = useHUDStore((s) => s.streakFreezes);
  const guestMode = useHUDStore((s) => s.guestMode);

  const shop = useHeroStore((s) => s.shop);
  const previewId = useHeroStore((s) => s.previewId);
  const setPreview = useHeroStore((s) => s.setPreview);

  const pct = Math.min(100, Math.round((xpInto / Math.max(xpToNext, 1)) * 100));
  const previewItem = previewId ? shop?.items.find((i) => i.id === previewId) : undefined;

  return (
    <section aria-label="Hero status" className="hero-header" data-testid="hero-header">
      <div className="hero-header__avatar" data-previewing={!!previewItem} role="img" aria-label={previewItem ? `Your hero, trying on ${previewItem.name}` : "Your hero"}>
        <HeroFace look={lookFromEquipped(previewEquipped(shop, previewId))} diameter={64} />
      </div>

      <div>
        <motion.div key={level} className="hero-header__level pixel-font" data-testid="hero-level"
          initial={{ scale: 1.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 12 }}>LV {level}</motion.div>
        {guestMode && <div className="text-xs text-fg-muted">Guest</div>}
      </div>

      <div className="hero-header__xp">
        <div className="hero-header__xp-label">
          <span>XP</span>
          <span data-testid="hero-xp">{xpInto.toLocaleString()} / {xpToNext.toLocaleString()}</span>
        </div>
        <div className="hero-header__bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }}><i className="hero-header__shine" aria-hidden="true" /></span>
        </div>
      </div>

      <div className="hero-header__stat hero-header__coins" role="status" aria-label={`${coins} coins`}>
        <motion.span key={coins} className="pixel-font inline-block" data-testid="hero-coins"
          initial={{ scale: 1.35, y: -2 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
          {coins.toLocaleString()}
        </motion.span>
        <Coins size={16} aria-hidden="true" />
      </div>

      <div className="hero-header__stat hero-header__streak" role="group" data-idle={streakDays === 0} aria-label={`${streakDays} day streak`}>
        <Flame size={16} aria-hidden="true" />
        <span className="pixel-font" data-testid="hero-streak">{streakDays}</span>
        <span className="text-xs">day streak</span>
        {streakFreezes > 0 && (
          <span className="text-xs text-ink-blue" title="Streak Shield: used automatically when you miss a day." aria-label={`${streakFreezes} streak shields`}>
            <ShieldPlus size={12} className="inline" aria-hidden="true" /> ×{streakFreezes}
          </span>
        )}
      </div>

      {previewItem && (
        <div className="hero-header__preview">
          <span>Preview: {previewItem.name}</span>
          <Button variant="ghost" size="sm" icon aria-label="Stop previewing" onClick={() => setPreview(null)}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
