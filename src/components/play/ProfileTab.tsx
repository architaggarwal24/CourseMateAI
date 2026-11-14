"use client";

import { useEffect } from "react";
import { Settings, Swords, UserCircle, Zap } from "@/components/ui/icons";
import GearChips from "@/components/champion/GearChips";
import { ButtonLink } from "@/components/ui";
import { PREF_LABELS, Switch } from "@/components/shell/PauseMenu";
import { WEAR_SLOTS, useHeroStore, type ShopItem } from "@/hooks/useHero";
import { useHeroPrefs } from "@/hooks/useHeroPrefs";
import { studyBonuses } from "@/lib/game/bonuses";
import { totalGear } from "@/lib/game/gear";
import { ROUTES } from "@/lib/routes";
import { useSound } from "@/lib/sound/chip";
import AdventurerCard from "./AdventurerCard";
import PixelLoader from "./PixelLoader";

/** What the worn items add to study rewards: one line per stat, from the best item; weaker ones are named, not added. */
function StudyBonuses({ worn }: { worn: ShopItem[] }) {
  const { stats } = studyBonuses(worn);
  return (
    <section className="profile-box" aria-labelledby="pf-study">
      <h2 id="pf-study" className="hero-label"><Zap size={12} aria-hidden="true" />Study bonuses</h2>
      {stats.length === 0 ? (
        <p className="profile-box__empty">Nothing you wear adds to study rewards yet. Some head pieces, outfits, pets and titles do.</p>
      ) : (
        <ul className="pf-bonuses" aria-label="Study bonuses">
          {stats.map((s) => (
            <li key={s.key}>
              <span className="hero-bonus"><span>{s.label}</span><strong className="pixel-font">{s.value}</strong></span>
              <span className="pf-bonuses__from">from {s.from}</span>
              {s.others.length > 0 && <span className="pf-bonuses__others">Not counted: {s.others.map((o) => `${o.name} ${o.value}`).join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="profile-box__note">Only your best item for each stat counts, so two XP items don&apos;t add up. Wear one that gives something else.</p>
    </section>
  );
}

/** The Hero world's switches, kept in this browser: sound, arena music, and the world's own (cursor, scanlines ...). */
function HeroSettings() {
  const sound = useSound();
  const prefs = useHeroPrefs();
  useEffect(() => { sound.load(); prefs.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [
    { key: "sound", label: "Sound", hint: "Every sound in the Hero world", on: sound.on, set: (on: boolean) => sound.setOn(on) },
    { key: "music", label: "Arena music", hint: "Chiptune during fights", on: sound.on && sound.music, set: (on: boolean) => { if (on && !sound.on) sound.setOn(true); sound.setMusic(on); } },
    ...PREF_LABELS.map((p) => ({ key: p.key, label: p.label, hint: p.hint, on: prefs[p.key], set: (on: boolean) => prefs.set({ [p.key]: on }) })),
  ];
  return (
    <section className="profile-box profile-box--settings" aria-labelledby="pf-settings">
      <h2 id="pf-settings" className="hero-label"><Settings size={12} aria-hidden="true" />Hero settings</h2>
      <div className="pf-settings">
        {rows.map((r) => (
          <div key={r.key} className="pause__row">
            <span><span className="block text-fg">{r.label}</span><span className="pause__row-hint">{r.hint}</span></span>
            <Switch checked={r.on} onChange={r.set} label={r.label} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Your hero's profile (/adventurer, from the button beside the sound switch): the Adventurer card to keep or share,
 * what your gear gives you in the arena and for study, and the Hero world's settings. These used to sit at the
 * bottom of the Champion tab.
 */
export default function ProfileTab() {
  const shop = useHeroStore((s) => s.shop);
  const loading = useHeroStore((s) => s.loading);
  if (loading || !shop) return <PixelLoader label="Opening your profile" />;
  const worn = WEAR_SLOTS.map((slot) => shop.items.find((i) => i.id === shop.equipped?.[slot])).filter((i): i is ShopItem => !!i);
  const totals = totalGear(worn as never);
  const hasGear = Object.values(totals).some(Boolean);
  return (
    <div className="profile" data-testid="hero-profile">
      <header className="profile__head">
        <h1 className="collection-title__name"><UserCircle size={20} aria-hidden="true" />Hero profile</h1>
        <p className="collection-title__desc">Your card, what your gear gives you, and how the Hero world behaves.</p>
      </header>
      <div className="profile__grid">
        <div className="profile__card"><AdventurerCard /></div>
        <div className="profile__side">
          <section className="profile-box" aria-labelledby="pf-arena" data-testid="arena-gear">
            <h2 id="pf-arena" className="hero-label"><Swords size={12} aria-hidden="true" />In the arena</h2>
            {hasGear ? <GearChips stats={totals} /> : <p className="profile-box__empty">Wear an outfit, head piece, weapon finish or pet to get an edge in battle.</p>}
            <p className="profile-box__note">Arena effects of everything you wear add up.</p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink size="sm" href={ROUTES.heroInventory}>Change gear</ButtonLink>
              <ButtonLink size="sm" variant="ghost" href={ROUTES.heroShop}>Shop</ButtonLink>
            </div>
          </section>
          <StudyBonuses worn={worn} />
        </div>
        <HeroSettings />
      </div>
    </div>
  );
}
