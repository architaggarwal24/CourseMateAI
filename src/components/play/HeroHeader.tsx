"use client";

import { Coins, Flame, Pause, ShieldPlus, X } from "@/components/ui/icons";
import { motion } from "motion/react";
import ChampionAvatar from "@/components/champion/ChampionAvatar";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { Button } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import SoundToggle from "@/components/fx/SoundToggle";
import { usePause } from "@/hooks/usePause";

/**
 * Always on top of the Hero area, whatever tab is open: the champion (with its pet and whatever is being tried on), level, XP bar,
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

  const { hero, petId, petStage } = useChampionLook({ preview: true });
  const pct = Math.min(100, Math.round((xpInto / Math.max(xpToNext, 1)) * 100));
  const previewItem = previewId ? shop?.items.find((i) => i.id === previewId) : undefined;
  const petName = petId ? shop?.items.find((i) => i.id === petId)?.name : undefined;
  const who = `Your champion, ${hero.name}${petName ? `, with ${petName}` : ""}${previewItem ? `, trying on ${previewItem.name}` : ""}`;

  return (
    <section aria-label="Hero status" className="hero-header" data-testid="hero-header">
      {/* a phone has no Esc key: tapping your champion opens the pause menu (options, controls, back to Study) */}
      <Button variant="ghost" className="hero-header__menu" onClick={() => usePause.getState().show()} aria-label="Menu" title="Menu: options, controls and the way back to Study">
        <span className="hero-header__avatar" data-previewing={!!previewItem} role="img" aria-label={who} data-testid="hero-header-champion">
          <ChampionAvatar size={60} withPet preview />
        </span>
        <span className="hero-header__menu-glyph" aria-hidden="true"><Pause size={10} /></span>
      </Button>

      <div className="hero-header__lv">
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
          <span style={{ width: `${pct}%` }} />
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
        <span className="text-xs hero-header__streak-label">day streak</span>
        {streakFreezes > 0 && (
          <span className="text-xs text-ink-blue" title="Streak Shield: used automatically when you miss a day." aria-label={`${streakFreezes} streak shields`}>
            <ShieldPlus size={12} className="inline" aria-hidden="true" /> ×{streakFreezes}
          </span>
        )}
      </div>

      <SoundToggle className="hero-header__sound" />

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
