"use client";

import { useEffect, useState } from "react";
import { Check, Coins, Gem, Hammer, PawPrint, Sparkles } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import ItemArt from "@/components/champion/ItemArt";
import { Badge, Button, EmptyState } from "@/components/ui";
import { useForge, type ForgeItem } from "@/hooks/useForge";
import { useHeroStore } from "@/hooks/useHero";
import { useHUDStore } from "@/hooks/useHUD";
import { HERO_STYLES, heroFighter } from "@/lib/pixel/appearance";
import { MOUNT_FRAME, mountFrame } from "@/lib/pixel/pets";
import { toCanvas } from "@/lib/pixel/canvas";
import { cn } from "@/lib/utils";
import FilterBar from "./FilterBar";
import PixelLoader from "./PixelLoader";

const ROMAN = ["", "I", "II", "III", "IV", "V"];
const CATEGORY: Record<string, string> = { weapon: "Weapons", armor: "Outfits", headgear: "Head pieces", pet: "Pets" };
const MOUNT_TEXT: Record<string, string> = { beast: "+5% chance to slip past a blow", bird: "+3 s on the first question", dragon: "Right Heavies hit 5% harder" };
const BONUS_WHAT = (c: string) => (c === "armor" || c === "headgear" ? "chance to take a heart less" : c === "pet" ? "to its bonus" : "damage");
type Filter = "all" | "weapon" | "armor" | "headgear" | "pet";

/** A mount on its own, drawn once (the forge's picture of a saddled pet). */
function MountArt({ petId, label }: { petId: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const m = mountFrame(petId, 0);
    if (!m || typeof document === "undefined") return;
    try { setSrc(toCanvas(m.buf).toDataURL()); } catch { /* no canvas (tests) */ }
  }, [petId]);
  // eslint-disable-next-line @next/next/no-img-element -- a generated pixel sprite, not a page image
  return src ? <img src={src} alt={label} width={MOUNT_FRAME.w / 2} height={MOUNT_FRAME.h / 2} className="forge-mount__art" /> : <span className="forge-mount__art" role="img" aria-label={label} />;
}

function Art({ it, big }: { it: ForgeItem; big?: boolean }) {
  const style = it.id.startsWith("style:") ? it.id.slice(6) : null;
  if (style) return <PixelSprite hero={heroFighter({ style })} still className="forge-art__sprite" />;
  if (it.category === "pet") return <PixelSprite pet={it.id} petStage={it.stage} still={!big} className="forge-art__sprite" />;
  return <ItemArt itemId={it.id} size={big ? 112 : 52} />;
}

/** Five pips, lit up to the tier. */
function Pips({ tier }: { tier: number }) {
  return (
    <span className="forge-pips" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((t) => <i key={t} data-on={t <= tier || undefined} />)}
    </span>
  );
}

function Bar({ it }: { it: ForgeItem }) {
  if (!it.next) return <span className="forge-bar forge-bar--max" aria-hidden="true"><span style={{ width: "100%" }} /></span>;
  const pct = Math.min(100, Math.round((100 * it.xp) / it.next.xp));
  return (
    <span className="forge-bar" role="progressbar" aria-label="XP to the next tier" aria-valuemin={0} aria-valuemax={it.next.xp} aria-valuenow={Math.min(it.xp, it.next.xp)}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** One owned item in the grid: its picture, tier and bar. Clicking it opens it in the side panel. */
function Tile({ it, name, on, onPick }: { it: ForgeItem; name: string; on: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" className={cn("forge-tile", it.ready && "forge-tile--ready")} aria-pressed={on} onClick={onPick} data-tier={it.tier}>
        <span className="forge-tile__art"><Art it={it} /></span>
        <span className="forge-tile__name">{name}</span>
        <span className="forge-tile__row"><Pips tier={it.tier} /><span className="forge-tile__tier pixel-font">{ROMAN[it.tier]}</span></span>
        <Bar it={it} />
        <span className="forge-tile__tags">
          {it.ready && it.next && <Badge tone="reward">Ready</Badge>}
          {it.worn && <Badge tone="success">Worn</Badge>}
          {!it.next && <Badge tone="epic">Max</Badge>}
        </span>
      </button>
    </li>
  );
}

/** The side panel: the item picked in the grid, what forging it gives and costs, and the button. */
function Detail({ it, name, coins, commons, rares }: { it: ForgeItem; name: string; coins: number; commons: number; rares: number }) {
  const upgrade = useForge((s) => s.upgrade);
  const saddle = useForge((s) => s.saddle);
  const ride = useForge((s) => s.ride);
  const mount = useForge((s) => s.view?.mount);
  const [busy, setBusy] = useState(false);
  const n = it.next;
  const costs = n ? [
    { key: "xp", label: "XP from fights", have: Math.min(it.xp, n.xp), need: n.xp, icon: <Sparkles size={13} aria-hidden="true" /> },
    { key: "coins", label: "Coins", have: coins, need: n.coins, icon: <Coins size={13} aria-hidden="true" /> },
    { key: "common", label: "Common materials", have: commons, need: n.common, icon: <Sparkles size={13} aria-hidden="true" /> },
    ...(n.rare ? [{ key: "rare", label: "Rare materials", have: rares, need: n.rare, icon: <Gem size={13} aria-hidden="true" /> }] : []),
  ] : [];
  const short = costs.filter((c) => c.have < c.need);
  const go = async (fn: () => Promise<boolean>) => { setBusy(true); await fn(); setBusy(false); };
  return (
    <section className="forge-detail" aria-label={`${name} at the forge`} data-testid="forge-detail">
      <div className="forge-detail__stage"><Art it={it} big /></div>
      <div className="grid gap-1">
        <p className="ipv__tags">
          <Badge tone={it.tier >= 4 ? "epic" : it.tier >= 2 ? "accent" : "neutral"}>Tier {ROMAN[it.tier]}</Badge>
          {it.worn && <Badge tone="success">Worn</Badge>}
          {it.stage && <Badge>{it.stage}</Badge>}
        </p>
        <h2 className="ipv__name">{name}</h2>
        <Pips tier={it.tier} />
      </div>
      <dl className="forge-detail__bonus">
        <div><dt>Now</dt><dd>{it.bonus > 0 ? <><strong className="pixel-font">+{Math.round(it.bonus * 100)}%</strong> {BONUS_WHAT(it.category)}</> : "No bonus yet"}</dd></div>
        {n && <div><dt>Next: {ROMAN[it.tier + 1]}</dt><dd><strong className="pixel-font">+{Math.round(it.bonus * 100) + 5}%</strong> {BONUS_WHAT(it.category)}</dd></div>}
      </dl>
      {n ? (
        <>
          <ul className="forge-costs" aria-label={`To forge tier ${ROMAN[it.tier + 1]}`}>
            {costs.map((c) => (
              <li key={c.key} data-met={c.have >= c.need || undefined}>
                {c.icon}<span className="flex-1">{c.label}</span>
                <span className="pixel-font">{c.key === "xp" ? `${c.have}/${c.need}` : `${c.have.toLocaleString()}/${c.need}`}</span>
                {c.have >= c.need && <Check size={13} aria-label="enough" />}
              </li>
            ))}
          </ul>
          <Button variant={it.ready && !short.length ? "reward" : "secondary"} disabled={!it.ready || short.length > 0 || busy} loading={busy}
            onClick={() => void go(() => upgrade(it.id))}>
            <Hammer size={14} aria-hidden="true" />Forge to {ROMAN[it.tier + 1]}
          </Button>
          <p className="ipv__note">{!it.ready ? "Wear it in fights to fill the XP bar." : short.length ? `Short of ${short.map((c) => c.label.toLowerCase()).join(", ")}.` : "Everything is ready."}</p>
        </>
      ) : <p className="ipv__note">Tier V: fully forged.</p>}
      {it.category === "pet" && it.can_saddle && <Button disabled={busy} onClick={() => void go(() => saddle(it.id))}><PawPrint size={14} aria-hidden="true" />Saddle it</Button>}
      {it.saddled && (mount === it.id
        ? <Button variant="ghost" disabled={busy} onClick={() => void go(() => ride(null))}>Stop riding</Button>
        : <Button disabled={busy} onClick={() => void go(() => ride(it.id))}>Ride it</Button>)}
    </section>
  );
}

/**
 * The Forge: everything you own earns XP when worn in a fight; a full bar plus coins plus materials (from Bestiary
 * wins) raises it a tier, up to V. The grid shows every item at a glance (filter by kind, or what is ready); the side
 * panel shows the one picked, with what forging it costs and gives. Pets grow with their tiers and can be ridden.
 */
export default function ForgeTab() {
  const view = useForge((s) => s.view);
  const load = useForge((s) => s.load);
  const shop = useHeroStore((s) => s.shop);
  const coins = useHUDStore((s) => s.coins);
  const [filter, setFilter] = useState<Filter>("all");
  const [readyOnly, setReadyOnly] = useState<"all" | "ready">("all");
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { void load(true); }, [load]);
  if (!view) return <PixelLoader label="Lighting the forge" />;

  const commons = view.materials.filter((m) => !m.rare).reduce((a, m) => a + m.count, 0);
  const rares = view.materials.filter((m) => m.rare).reduce((a, m) => a + m.count, 0);
  const nameOf = (id: string) => (id.startsWith("style:") ? `${HERO_STYLES[id.slice(6)]?.name ?? id.slice(6)} (your hero)` : shop?.items.find((i) => i.id === id)?.name ?? id);
  const ready = view.items.filter((i) => i.ready && i.next);
  const shown = view.items.filter((i) => (filter === "all" || i.category === filter) && (readyOnly === "all" || (i.ready && i.next)));
  const current = view.items.find((i) => i.id === picked) ?? ready[0] ?? view.items[0];
  const riding = view.mount ? view.items.find((i) => i.id === view.mount) : null;

  if (!view.items.length) {
    return <div className="forge" data-testid="forge"><EmptyState title="Nothing to forge yet" description="Wear a weapon, outfit, head piece or pet from the shop, then fight with it." /></div>;
  }

  return (
    <div className="hero-split hero-split--fixed forge" data-testid="forge">
      <aside className="hero-split__side" aria-label="Forge">
        <div className="forge-wallet" aria-label="Your materials">
          <span className="forge-mat"><Coins size={14} aria-hidden="true" /><strong className="pixel-font">{coins.toLocaleString()}</strong> coins</span>
          <span className="forge-mat"><Sparkles size={14} aria-hidden="true" /><strong className="pixel-font">{commons}</strong> common</span>
          <span className="forge-mat"><Gem size={14} aria-hidden="true" /><strong className="pixel-font">{rares}</strong> rare</span>
        </div>
        {view.materials.length > 0 && (
          <ul className="forge-matlist" aria-label="Materials by kind">
            {view.materials.map((m) => <li key={m.id} data-rare={m.rare || undefined}>{m.name} <strong>{m.count}</strong></li>)}
          </ul>
        )}
        {current && <Detail key={current.id} it={current} name={nameOf(current.id)} coins={coins} commons={commons} rares={rares} />}
        {riding && (
          <div className="forge-mount" aria-label="Your mount">
            <MountArt petId={riding.id} label={`${nameOf(riding.id)}, saddled`} />
            <p className="m-0 text-sm"><strong>Riding {nameOf(riding.id)}.</strong> It carries you into every fight. {MOUNT_TEXT[riding.mount_kind ?? "beast"]}.</p>
          </div>
        )}
      </aside>

      <section className="hero-split__main" aria-label="Your gear">
        <div className="collection-head">
          <FilterBar label="Kind of gear" size="lg" value={filter} onChange={setFilter}
            options={([["all", "All"], ["weapon", CATEGORY.weapon], ["armor", CATEGORY.armor], ["headgear", CATEGORY.headgear], ["pet", CATEGORY.pet]] as [Filter, string][])
              .map(([id, label]) => ({ id, label, count: view.items.filter((i) => id === "all" || i.category === id).length }))} />
          <FilterBar label="Show" value={readyOnly} onChange={setReadyOnly}
            options={[{ id: "all", label: "Everything" }, { id: "ready", label: "Ready to forge", count: ready.length }]} />
        </div>
        <p className="collection-title__desc mb-4">Wear gear in fights to fill its bar. A full bar, coins and materials from Bestiary wins raise it a tier: up to V, +5% a tier.</p>
        {shown.length === 0 ? (
          <p className="py-12 text-center text-fg-muted">{readyOnly === "ready" ? "Nothing is ready yet: fight with your gear on to fill the bars." : "Nothing of this kind yet."}</p>
        ) : (
          <ul className="forge-grid" aria-label="Gear to forge">
            {shown.map((it) => <Tile key={it.id} it={it} name={nameOf(it.id)} on={current?.id === it.id} onPick={() => setPicked(it.id)} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
