"use client";

import { useEffect, useState } from "react";
import { useReducedMotionConfig } from "motion/react";
import { ChevronDown, Crown, Lock, PawPrint, Shield, Shirt, ShoppingBag, Sparkles, Swords, AlertTriangle, X, Zap } from "@/components/ui/icons";
import LookEditor from "@/components/champion/LookEditor";
import HeroBuilder from "@/components/champion/HeroBuilder";
import { HERO_FIGHTER_ID } from "@/lib/pixel/appearance";
import { xpPct } from "@/components/arena/pixel/Roster";
import { useChampion, type ChampionProgress } from "@/hooks/useChampion";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { Roster } from "@/components/arena/pixel/Roster";
import GearChips from "@/components/champion/GearChips";
import ItemArt from "@/components/champion/ItemArt";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { Badge, Button, ButtonLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useHUDStore } from "@/hooks/useHUD";
import { ownedItems, useHeroStore, type ShopItem } from "@/hooks/useHero";
import { totalGear } from "@/lib/game/gear";
import type { AnimName } from "@/lib/pixel/heroes";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/game/rarity";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import "@/components/arena/pixel/pixel.css";
import "@/components/champion/champion.css";

/** The skin slots, in the order they are listed. */
export const SKIN_SLOTS = [
  { key: "armor", label: "Outfit", Icon: Shield },
  { key: "headgear", label: "Head piece", Icon: Crown },
  { key: "weapon", label: "Weapon finish", Icon: Swords },
  { key: "pet", label: "Pet", Icon: PawPrint },
] as const;

const ANIMS: ReadonlyArray<{ id: AnimName; label: string }> = [
  { id: "idle", label: "Idle" }, { id: "attack", label: "Attack" }, { id: "win", label: "Win" },
];

/** The study bonuses of everything that is worn. */
export function activeBonuses(shop: { equipped: Record<string, string>; items: ShopItem[] }) {
  const out: { label: string; value: string }[] = [];
  for (const id of Object.values(shop.equipped ?? {})) {
    const b = shop.items.find((i) => i.id === id)?.bonus;
    if (!b) continue;
    if (b.xp_pct) out.push({ label: "XP", value: `+${Math.round(b.xp_pct * 100)}%` });
    if (b.coin_pct) out.push({ label: "Coins", value: `+${Math.round(b.coin_pct * 100)}%` });
    if (b.combo_xp_pct) out.push({ label: "Combo", value: `+${Math.round(b.combo_xp_pct * 100)}%` });
    if (b.arena_hints) out.push({ label: "Hints", value: `+${b.arena_hints}` });
  }
  return out;
}

/** The live preview: the champion in its skins (and the item being tried on), with its pet, in a chosen animation. */
function ChampionStage() {
  const { hero, petId, loadout, petStage } = useChampionLook({ preview: true });
  const shop = useHeroStore((s) => s.shop);
  const [anim, setAnim] = useState<AnimName>("idle");
  const [replay, setReplay] = useState(0);
  const reduced = !!useReducedMotionConfig();
  // an attack plays once: replay it every so often while it is the chosen animation
  useEffect(() => {
    if (anim !== "attack" || reduced) return;
    const t = setInterval(() => setReplay((n) => n + 1), 1600);
    return () => clearInterval(t);
  }, [anim, reduced]);
  const worn = (["armor", "headgear", "weapon"] as const).map((k) => shop?.items.find((i) => i.id === loadout[k])?.name).filter(Boolean);
  const petName = petId ? shop?.items.find((i) => i.id === petId)?.name : null;
  const description = `${hero.name}${worn.length ? `, wearing ${worn.join(", ")}` : ""}${petName ? `, with ${petName}` : ""} (${anim})`;

  return (
    <div className="champ-stage" style={{ "--hero-accent": hero.accent } as React.CSSProperties}>
      <div className="hero-stage w-full" data-testid="champion-stage">
        <PixelSprite key={`${anim}-${replay}`} hero={hero} pet={petId} petStage={petStage} anim={anim} label={description} className="champ-stage__figure" />
      </div>
      <div className="champ-anims" role="radiogroup" aria-label="Preview animation">
        {ANIMS.map((a) => (
          <button
            key={a.id} type="button" role="radio" aria-checked={anim === a.id} className="champ-anims__btn"
            tabIndex={anim === a.id ? 0 : -1}
            onClick={() => setAnim(a.id)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const i = ANIMS.findIndex((x) => x.id === anim);
              const next = ANIMS[(i + d + ANIMS.length) % ANIMS.length];
              setAnim(next.id);
              (e.currentTarget.parentElement?.querySelector(`[data-anim="${next.id}"]`) as HTMLElement | null)?.focus();
            }}
            data-anim={a.id}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The picked champion's kit (passive + ultimate), its level and the three mastery skins its levels unlock. */
function KitAndMastery({ championId, name, shop }: { championId: string; name: string; shop: NonNullable<ReturnType<typeof useHeroStore.getState>["shop"]> }) {
  const p = useChampion((s) => s.progress[championId]);
  if (!p) return null;
  return (
    <div className="champ-kit mb-6" data-testid="champion-kit">
      <div className="champ-kit__head">
        <p className="hero-label m-0">{name}&apos;s kit</p>
        <span className="champ-kit__level">
          <span className="sr-only">{`${name} level ${p.level}${p.next_level_xp ? `, ${p.xp} of ${p.next_level_xp} XP` : ", max level"}`}</span>
          <span className="pixel-font" aria-hidden="true">Lv {p.level}</span>
          <span className="px-hero-card__xp" aria-hidden="true"><span style={{ width: `${xpPct(p)}%` }} /></span>
          <span className="text-xs text-fg-muted" aria-hidden="true">{p.next_level_xp ? `${p.xp}/${p.next_level_xp} XP` : "Max"}</span>
        </span>
      </div>
      <dl className="champ-kit__list">
        <div><dt><Zap size={14} aria-hidden="true" />Passive · {p.kit.passive.name}</dt><dd>{p.kit.passive.text}</dd></div>
        <div><dt><Sparkles size={14} aria-hidden="true" />Ultimate · {p.kit.ultimate.name} <kbd className="kbd">U</kbd></dt><dd>{p.kit.ultimate.text} Charges as you answer right in a fight.</dd></div>
        {p.kit.weakness && <div data-testid="champion-weakness"><dt><AlertTriangle size={14} aria-hidden="true" />Weakness · {p.kit.weakness.name}</dt><dd>{p.kit.weakness.text}</dd></div>}
      </dl>
      {p.mastery_pct !== undefined && (
        <p className="champ-kit__mastery">
          <span className="pixel-font">{p.mastered ? "Mastered" : `${p.mastery_pct}%`}</span>
          <span className="text-sm text-fg-2">{name}&apos;s mastery</span>
          <ButtonLink size="sm" variant="ghost" href={ROUTES.heroMastery} className="ml-auto">See challenges</ButtonLink>
        </p>
      )}
      <p className="hero-label mt-4">Mastery skins · earned in battle with {name}</p>
      <ul className="champ-mastery" aria-label={`${name}'s mastery skins`}>
        {p.mastery.map((m) => {
          const item = shop.items.find((i) => i.id === m.id);
          const have = !!item?.owned;
          return (
            <li key={m.id} className="champ-mastery__item" data-owned={have || undefined}>
              <ItemArt itemId={m.id} size={44} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{item?.name ?? `Mastery skin ${p.mastery.indexOf(m) + 1}`}</span>
                <span className="block text-xs text-fg-muted">
                  {have ? "Unlocked" : <><Lock size={10} className="inline" aria-hidden="true" /> Unlocks at Lv {m.level}</>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {p.signature && <SignatureWeapon name={name} sig={p.signature} shop={shop} />}
    </div>
  );
}

/**
 * The champion's own mastery weapon (Stage C1): worn by that champion it gives a small perk, their own attack and
 * ultimate animations, and a finisher on the KO. Says whether it is earned yet and whether it is worn.
 */
function SignatureWeapon({ name, sig, shop }: { name: string; sig: NonNullable<ChampionProgress["signature"]>; shop: NonNullable<ReturnType<typeof useHeroStore.getState>["shop"]> }) {
  const item = shop.items.find((i) => i.id === sig.weapon);
  const owned = !!item?.owned || sig.owned;
  const worn = shop.equipped?.weapon === sig.weapon;
  const status = worn ? "Worn: active in battle" : owned ? `Wear ${item?.name ?? "it"} as ${name}'s weapon finish to wake it` : "Unlocks at Lv 10";
  return (
    <div className="champ-signature" data-worn={worn || undefined} data-testid="champion-signature">
      <ItemArt itemId={sig.weapon} size={44} />
      <div className="min-w-0">
        <p className="hero-label m-0">Signature weapon · {item?.name ?? "Mastery weapon"}</p>
        <p className="m-0 text-sm"><strong>{sig.perk.name}.</strong> {sig.perk.text}</p>
        <p className="m-0 text-sm text-fg-2">Own attack and ultimate animations, and a finisher: <span className="pixel-font">{sig.finisher}</span>.</p>
        <p className="m-0 text-xs text-fg-muted">{worn ? null : !owned && <Lock size={10} className="inline" aria-hidden="true" />} {status}</p>
      </div>
    </div>
  );
}

/**
 * The Champion tab: pick one of the six champions and the skins it wears, with a live animated preview. Picking a
 * champion or a skin saves it on the account at once; hovering or focusing a skin tries it on.
 */
export default function ChampionTab() {
  const { user } = useAuth();
  const level = useHUDStore((s) => s.level);
  const shop = useHeroStore((s) => s.shop);
  const loading = useHeroStore((s) => s.loading);
  const previewId = useHeroStore((s) => s.previewId);
  const setPreview = useHeroStore((s) => s.setPreview);
  const equip = useHeroStore((s) => s.equip);
  const unequip = useHeroStore((s) => s.unequip);
  const { hero } = useChampionLook();
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const isHero = hero.id === HERO_FIGHTER_ID;

  if (loading || !shop) return <p role="status" className="p-6 text-fg-muted">Summoning your champion…</p>;

  const equipped = shop.equipped ?? {};
  const owned = ownedItems(shop).filter((i) => !i.consumable);
  const skinCount = SKIN_SLOTS.filter((s) => equipped[s.key]).length;
  const bonuses = activeBonuses(shop);
  const worn = SKIN_SLOTS.map((s) => shop.items.find((i) => i.id === equipped[s.key]));
  const totals = totalGear(worn as never);
  const gearTotals = Object.values(totals).some(Boolean) ? totals : null;

  return (
    <div className="hero-split">
      <aside className="hero-split__side" aria-label="Your champion">
        <ChampionStage />
        <div className="mt-4 text-center">
          <Badge tone="reward">LV {level}</Badge>
          <h2 className="m-0 mt-2 text-lg font-bold text-fg">{(user?.username || "Hero").toUpperCase()}</h2>
          <p className="m-0 text-sm text-fg-2"><span className="pixel-font">{isHero ? "Your hero" : hero.name}</span> · {hero.title}</p>
          <p className="m-0 text-sm text-fg-muted">{equipped.title ? shop.items.find((i) => i.id === equipped.title)?.name ?? "" : "Aspiring Champion"}</p>
          {skinCount >= 4 && <Badge tone="epic" className="mt-2">Full kit</Badge>}
          {previewId && <p className="m-0 mt-2 text-sm text-ink-purple" role="status">Previewing {shop.items.find((i) => i.id === previewId)?.name}</p>}
          {isHero && (
            <Button className="mt-3" onClick={() => setEditing(true)} data-testid="customize-look">
              <Shirt size={16} aria-hidden="true" />Change your look
            </Button>
          )}
        </div>
        <LookEditor open={editing} onClose={() => setEditing(false)} />
      </aside>

      <section className="hero-split__main max-w-4xl" aria-label="Champion and skins">
        <div className="mb-6"><Roster /></div>
        {isHero ? <HeroBuilder onEditLook={() => setEditing(true)} /> : <KitAndMastery championId={hero.id} name={hero.name} shop={shop} />}

        <div className="flex flex-wrap gap-2 mb-5">
          <ButtonLink href={ROUTES.heroShop} variant="primary"><ShoppingBag size={16} aria-hidden="true" />Get skins</ButtonLink>
          <ButtonLink href={ROUTES.heroInventory}>Inventory</ButtonLink>
        </div>

        <div className="mb-5" data-testid="arena-gear">
          <p className="hero-label">In the arena</p>
          {gearTotals ? <GearChips stats={gearTotals} /> : <p className="m-0 text-sm text-fg-muted">Wear an outfit, head piece, weapon finish or pet to get an edge in battle.</p>}
        </div>

        {bonuses.length > 0 && (
          <div className="mb-5">
            <p className="hero-label"><Zap size={12} className="inline mr-1" aria-hidden="true" />Study bonuses</p>
            <div className="flex flex-wrap gap-2">
              {bonuses.map((b, i) => (
                <span key={i} className="hero-bonus"><span>{b.label}</span><strong className="pixel-font">{b.value}</strong></span>
              ))}
            </div>
          </div>
        )}

        <p className="hero-label">Skin loadout ({skinCount}/4) · shared by every champion</p>
        <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2">
          {SKIN_SLOTS.map(({ key, label, Icon }) => {
            const on = shop.items.find((i) => i.id === equipped[key]);
            // a mastery skin is only offered to the champion that earned it
            const choices = owned.filter((i) => i.category === key && (!i.mastery || i.mastery.champion === hero.id));
            const open = openSlot === key;
            const drawer = `slot-${key}`;
            return (
              <li key={key} className={cn("border border-line rounded-lg bg-panel", on && rarityClass(rarityOf(on)))} style={on ? { borderColor: "var(--rarity)" } : undefined}>
                <button
                  type="button"
                  className="w-full min-h-11 flex items-center gap-3 p-3 text-left bg-transparent text-fg"
                  aria-expanded={open}
                  aria-controls={drawer}
                  onClick={() => setOpenSlot(open ? null : key)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-fg-2 uppercase">{label}</span>
                    <span className="block text-sm font-semibold truncate">{on ? on.name : "Champion's own"}</span>
                    {on && <span className="block text-xs" style={{ color: "var(--rarity)" }}>{RARITY_LABEL[rarityOf(on)]}</span>}
                  </span>
                  {on && <ItemArt itemId={on.id} size={40} rarity={rarityOf(on)} />}
                  <ChevronDown size={14} aria-hidden="true" className={open ? "rotate-180" : ""} />
                </button>

                {open && (
                  <div id={drawer} className="p-3 border-t border-line">
                    {on && (
                      <Button size="sm" className="mb-3" onClick={() => { void unequip(key, on.name); setOpenSlot(null); }}>
                        <X size={12} aria-hidden="true" />Back to {hero.name}&apos;s own
                      </Button>
                    )}
                    {choices.length === 0 ? (
                      <div className="text-sm text-fg-muted">
                        <p className="m-0 mb-2">No {label.toLowerCase()} skins owned</p>
                        <ButtonLink size="sm" href={ROUTES.heroShop}>Visit shop →</ButtonLink>
                      </div>
                    ) : (
                      <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                        {choices.map((item) => {
                          const isOn = item.id === equipped[key];
                          const r = rarityOf(item);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                className={cn("min-h-11 min-w-11 p-2 rounded-md border-2 bg-canvas flex flex-col items-center gap-1 text-xs text-fg-2", rarityClass(r))}
                                style={{ borderColor: "var(--rarity)" }}
                                aria-pressed={isOn}
                                aria-label={`${isOn ? "Take off" : "Wear"} ${item.name}`}
                                title={item.name}
                                onMouseEnter={() => setPreview(item.id)}
                                onMouseLeave={() => setPreview(null)}
                                onFocus={() => setPreview(item.id)}
                                onBlur={() => setPreview(null)}
                                onClick={() => { void (isOn ? unequip(key, item.name) : equip(item)); }}
                              >
                                <ItemArt itemId={item.id} size={40} rarity={r} />
                                <span className="max-w-20 truncate">{item.name}</span>
                                {isOn && <Badge tone="success">On</Badge>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
