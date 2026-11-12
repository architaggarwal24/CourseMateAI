"use client";

import { Suspense, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Coins, Crown, Flame, PanelLeft, ScrollText, Skull, Sparkles, Swords, X, type IconType } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { useChampionLook } from "@/components/champion/useChampionLook";
import SoundToggle from "@/components/fx/SoundToggle";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { useHeroMood } from "@/hooks/useHeroMood";
import { useShortcutLabel } from "@/hooks/useShortcutLabel";
import { toggleSidebar } from "@/lib/sidebar";
import { HERO_MENU, type WorldItem } from "@/lib/worlds";
import { useSidebarCollapsed, useSidebarShortcut } from "./NavSidebar";
import PortalLink from "./PortalLink";
import HeroScene from "./HeroScene";
import InsightMeter from "./InsightMeter";
import { useHeroPrefs } from "@/hooks/useHeroPrefs";
import { sfx } from "@/lib/sound/chip";

const ICON: Record<string, IconType> = { arena: Swords, quests: ScrollText, bestiary: Skull, champion: Crown };

/**
 * The Hero world's side panel (the two worlds, Stage 1): a JRPG pause menu. On top your champion (animated, with its
 * pet and whatever is being tried on), level, XP, coins and streak; then the menu (Arena, Quests, Bestiary, Champion
 * and Champion's own screens under it), a blinking cursor on the item under the mouse or the keyboard (the arrow keys
 * move through the menu); at the bottom the portal back to Study. Collapses to a rail like the Study sidebar (Ctrl+B).
 */
export default function HeroSidebar() {
  return <Suspense fallback={<Panel tab={null} />}><WithQuery /></Suspense>;
}
function WithQuery() {
  return <Panel tab={useSearchParams().get("tab")} />;
}

export function isCurrent(item: WorldItem, pathname: string, tab: string | null): boolean {
  const [path, query] = item.href.split("?");
  if (pathname !== path) return false;
  const want = query ? new URLSearchParams(query).get("tab") : null;
  // Champion itself is its first tab (no ?tab=, or ?tab=champion)
  return want ? tab === want : !tab || tab === "champion" || !HERO_MENU.some((i) => i.children?.some((c) => c.href.endsWith(`tab=${tab}`)));
}

function Panel({ tab }: { tab: string | null }) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();
  const toggleKey = useShortcutLabel(["mod", "B"]);
  useSidebarShortcut();
  const menu = useRef<HTMLElement>(null);
  // menu sounds (Stage 4): a blip as the cursor moves to another item, a select when one is chosen
  const menuSounds = useHeroPrefs((s) => s.menuSounds);
  const lastBlip = useRef<Element | null>(null);
  const itemOf = (t: EventTarget) => (t instanceof Element ? t.closest("a.hside__link") : null);
  const blip = (e: React.SyntheticEvent) => {
    const item = itemOf(e.target);
    if (!item || item === lastBlip.current) return;
    lastBlip.current = item;
    if (menuSounds) sfx("click");
  };
  const select = (e: React.MouseEvent) => { if (menuSounds && itemOf(e.target)) sfx("select"); };

  // the arrow keys walk the menu like a game's (Home / End jump to its ends)
  const onKey = (e: ReactKeyboardEvent) => {
    const links = [...(menu.current?.querySelectorAll<HTMLAnchorElement>("a.hside__link") ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const to = e.key === "ArrowDown" ? (i + 1) % links.length : e.key === "ArrowUp" ? (i - 1 + links.length) % links.length
      : e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    links[to].focus();
  };

  return (
    <aside className="side hside" data-collapsed={collapsed || undefined} data-world="hero">
      <HeroScene />
      <div className="hside__top">
        <HeroStatus collapsed={collapsed} />
        <button type="button" className="side__toggle hside__toggle" onClick={toggleSidebar} aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={`${collapsed ? "Expand" : "Collapse"} sidebar (${toggleKey})`}>
          <PanelLeft size={16} aria-hidden="true" />
        </button>
      </div>

      <nav ref={menu} aria-label="Main" className="hside__menu" onKeyDown={onKey} onMouseOver={blip} onFocus={blip} onClick={select}>
        <ul role="list" className="hside__list">
          {HERO_MENU.map((item) => {
            const Icon = ICON[item.id] ?? Sparkles;
            const current = isCurrent(item, pathname, tab);
            const inside = item.children?.some((c) => isCurrent(c, pathname, tab));
            return (
              <li key={item.id}>
                <Link href={item.href} className="hside__link pixel-font" aria-current={current ? "page" : undefined} data-tip={item.label} data-open={inside || undefined}>
                  <Icon size={16} aria-hidden="true" className="hside__icon" />
                  <span className="side__label">{item.label}</span>
                </Link>
                {item.children && (
                  <ul role="list" className="hside__sub" aria-label={`${item.label} screens`}>
                    {item.children.map((c) => (
                      <li key={c.id}>
                        <Link href={c.href} className="hside__link hside__link--sub" aria-current={isCurrent(c, pathname, tab) ? "page" : undefined} data-tip={c.label}>
                          <span className="side__label">{c.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hside__foot">
        <SoundToggle className="hside__sound" />
        <PortalLink to="study" className="hside__portal" rail />
      </div>
    </aside>
  );
}

/** The champion on top of the panel: animated (it fidgets), and the stats that used to be the Hero header. */
function HeroStatus({ collapsed }: { collapsed: boolean }) {
  const level = useHUDStore((s) => s.level);
  const coins = useHUDStore((s) => s.coins);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);
  const streakDays = useHUDStore((s) => s.streakDays);
  const shop = useHeroStore((s) => s.shop);
  const previewId = useHeroStore((s) => s.previewId);
  const setPreview = useHeroStore((s) => s.setPreview);
  const { hero, petId, petStage } = useChampionLook({ preview: true });
  // the living panel (Stage 3): it cheers good news, flinches at bad, dozes off when you're away; the pet wanders
  const mood = useHeroMood();
  const anim = mood === "cheer" ? "win" : mood === "flinch" ? "hit" : "idle";
  const pct = Math.min(100, Math.round((xpInto / Math.max(xpToNext, 1)) * 100));
  const previewItem = previewId ? shop?.items.find((i) => i.id === previewId) : undefined;
  const petName = petId ? shop?.items.find((i) => i.id === petId)?.name : undefined;
  const who = `Your champion, ${hero.name}${petName ? `, with ${petName}` : ""}${previewItem ? `, trying on ${previewItem.name}` : ""}`;

  return (
    <section className="hside__status" aria-label="Hero status" data-testid="hero-panel" style={{ "--hero-accent": hero.accent } as React.CSSProperties}>
      <div className="hside__stage" data-previewing={!!previewItem || undefined} data-mood={mood} data-champion={hero.id} data-testid="hero-panel-stage">
        <PixelSprite hero={hero} anim={anim} portrait={collapsed} fidget={!collapsed && mood === "idle"} label={who} className="hside__sprite" />
        {!collapsed && petId && <span className="hside__pet" aria-hidden="true"><PixelSprite pet={petId} petStage={petStage} className="hside__pet-sprite" /></span>}
        {mood === "sleep" && <span className="hside__zzz pixel-font" aria-hidden="true">z<span>z</span><span>z</span></span>}
      </div>
      <div className="hside__stats">
        <p className="hside__name pixel-font">{hero.name}</p>
        <p className="hside__level pixel-font" data-testid="hero-panel-level">LV {level}</p>
        <div className="hside__xp">
          <div className="hside__bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
          <span className="hside__xp-num">{xpInto.toLocaleString()} / {xpToNext.toLocaleString()} XP</span>
        </div>
        <p className="hside__chips">
          <span className="hside__chip"><Coins size={13} aria-hidden="true" /><span className="pixel-font" data-testid="hero-panel-coins">{coins.toLocaleString()}</span><span className="sr-only"> coins</span></span>
          <span className="hside__chip" data-idle={streakDays === 0 || undefined}><Flame size={13} aria-hidden="true" /><span className="pixel-font">{streakDays}</span><span className="sr-only"> day streak</span></span>
        </p>
        <InsightMeter compact className="hside__insight" />
        {previewItem && (
          <p className="hside__preview">
            <span>Trying on {previewItem.name}</span>
            <button type="button" className="hside__preview-x" aria-label="Stop previewing" onClick={() => setPreview(null)}><X size={12} aria-hidden="true" /></button>
          </p>
        )}
      </div>
    </section>
  );
}
