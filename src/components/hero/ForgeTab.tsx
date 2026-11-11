"use client";

import { useEffect, useState } from "react";
import { Coins, Gem, Hammer, PawPrint, Sparkles } from "@/components/icons";
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

const ROMAN = ["", "I", "II", "III", "IV", "V"];
const CATEGORY: Record<string, string> = { weapon: "Weapons", armor: "Outfits", headgear: "Head pieces", pet: "Pets" };
const MOUNT_TEXT: Record<string, string> = { beast: "+5% chance to slip past a blow", bird: "+3 s on the first question", dragon: "Right Heavies hit 5% harder" };

/** A mount on its own, drawn once (the forge's preview of a saddled pet). */
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

function Bar({ it }: { it: ForgeItem }) {
  if (!it.next) return <span className="forge-item__bar forge-item__bar--max" aria-hidden="true"><span style={{ width: "100%" }} /></span>;
  const pct = Math.min(100, Math.round((100 * it.xp) / it.next.xp));
  return (
    <span className="forge-item__bar" role="progressbar" aria-label="XP to the next tier" aria-valuemin={0} aria-valuemax={it.next.xp} aria-valuenow={Math.min(it.xp, it.next.xp)}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function ItemRow({ it, name, coins, commons, rares }: { it: ForgeItem; name: string; coins: number; commons: number; rares: number }) {
  const upgrade = useForge((s) => s.upgrade);
  const saddle = useForge((s) => s.saddle);
  const ride = useForge((s) => s.ride);
  const mount = useForge((s) => s.view?.mount);
  const [busy, setBusy] = useState(false);
  const n = it.next;
  const short = n ? [coins < n.coins && `${n.coins - coins} coins`, commons < n.common && `${n.common - commons} common materials`, rares < n.rare && `${n.rare - rares} rare materials`].filter(Boolean) : [];
  const style = it.id.startsWith("style:") ? it.id.slice(6) : null;
  const go = async (fn: () => Promise<boolean>) => { setBusy(true); await fn(); setBusy(false); };
  return (
    <li className={cn("forge-item", it.ready && "forge-item--ready")} data-tier={it.tier}>
      <span className="forge-item__art">
        {style ? <PixelSprite hero={heroFighter({ style })} still className="forge-item__sprite" />
          : it.category === "pet" ? <PixelSprite pet={it.id} petStage={it.stage} still className="forge-item__sprite" />
          : <ItemArt itemId={it.id} size={44} />}
      </span>
      <span className="min-w-0 grid gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-fg truncate">{name}</span>
          <Badge tone={it.tier >= 4 ? "epic" : it.tier >= 2 ? "accent" : "neutral"}>Tier {ROMAN[it.tier]}</Badge>
          {it.worn && <Badge tone="success">Worn</Badge>}
          {it.stage && <span className="text-xs text-fg-muted">{it.stage}</span>}
        </span>
        <span className="text-xs text-fg-2">{it.bonus > 0 ? `+${Math.round(it.bonus * 100)}% ` : "No bonus yet · "}{it.category === "armor" || it.category === "headgear" ? "chance to take a heart less" : it.category === "pet" ? "to its bonus" : "damage"}</span>
        <Bar it={it} />
        <span className="text-xs text-fg-muted">
          {n ? `${Math.min(it.xp, n.xp)}/${n.xp} XP · next: ${n.coins} coins, ${n.common} common${n.rare ? `, ${n.rare} rare` : ""}` : "Tier V: fully forged"}
        </span>
      </span>
      <span className="forge-item__act">
        {n && (
          <Button size="sm" variant={it.ready ? "reward" : "secondary"} disabled={!it.ready || short.length > 0 || busy} onClick={() => void go(() => upgrade(it.id))}
            title={!it.ready ? "Wear it in fights to fill the bar" : short.length ? `Short of ${short.join(", ")}` : undefined}>
            <Hammer size={14} aria-hidden="true" />Forge to {ROMAN[it.tier + 1]}
          </Button>
        )}
        {it.category === "pet" && it.can_saddle && <Button size="sm" disabled={busy} onClick={() => void go(() => saddle(it.id))}><PawPrint size={14} aria-hidden="true" />Saddle it</Button>}
        {it.saddled && (mount === it.id
          ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void go(() => ride(null))}>Stop riding</Button>
          : <Button size="sm" disabled={busy} onClick={() => void go(() => ride(it.id))}>Ride it</Button>)}
      </span>
    </li>
  );
}

/**
 * The Forge: everything you own earns XP when worn in a fight; here a full bar plus coins plus materials (from
 * Bestiary wins) raises it a tier. Pets grow with their tiers and, once adult, can be saddled and ridden.
 */
export default function ForgeTab() {
  const view = useForge((s) => s.view);
  const load = useForge((s) => s.load);
  const shop = useHeroStore((s) => s.shop);
  const coins = useHUDStore((s) => s.coins);
  useEffect(() => { void load(true); }, [load]);
  if (!view) return <p role="status" className="p-6 text-fg-muted">Lighting the forge…</p>;
  const commons = view.materials.filter((m) => !m.rare).reduce((a, m) => a + m.count, 0);
  const rares = view.materials.filter((m) => m.rare).reduce((a, m) => a + m.count, 0);
  const nameOf = (id: string) => (id.startsWith("style:") ? `${HERO_STYLES[id.slice(6)]?.name ?? id.slice(6)} (your hero)` : shop?.items.find((i) => i.id === id)?.name ?? id);
  const groups = ["weapon", "armor", "headgear", "pet"].map((c) => ({ c, items: view.items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  const riding = view.mount ? view.items.find((i) => i.id === view.mount) : null;
  return (
    <div className="forge" data-testid="forge">
      <section className="forge-head" aria-label="Your materials">
        <p className="m-0 text-sm text-fg-2">Wear gear in fights to fill its bar. A full bar, coins and materials from Bestiary wins raise it a tier: up to V, +5% a tier.</p>
        <div className="forge-mats">
          <span className="forge-mat"><Coins size={14} aria-hidden="true" /><strong className="pixel-font">{coins}</strong> coins</span>
          <span className="forge-mat"><Sparkles size={14} aria-hidden="true" /><strong className="pixel-font">{commons}</strong> common</span>
          <span className="forge-mat"><Gem size={14} aria-hidden="true" /><strong className="pixel-font">{rares}</strong> rare</span>
        </div>
        {view.materials.length > 0 && (
          <ul className="forge-matlist" aria-label="Materials by kind">
            {view.materials.map((m) => <li key={m.id} data-rare={m.rare || undefined}>{m.name} <strong>{m.count}</strong></li>)}
          </ul>
        )}
      </section>
      {riding && (
        <section className="forge-mount" aria-label="Your mount">
          <MountArt petId={riding.id} label={`${nameOf(riding.id)}, saddled`} />
          <p className="m-0 text-sm"><strong>Riding {nameOf(riding.id)}.</strong> It carries you into every fight. {MOUNT_TEXT[riding.mount_kind ?? "beast"]}.</p>
        </section>
      )}
      {groups.length === 0 ? (
        <EmptyState title="Nothing to forge yet" description="Wear a weapon, outfit, head piece or pet from the shop, then fight with it." />
      ) : groups.map((g) => (
        <section key={g.c} aria-label={CATEGORY[g.c]} className="mt-5">
          <p className="hero-label">{CATEGORY[g.c]}</p>
          <ul className="forge-items">
            {g.items.map((it) => <ItemRow key={it.id} it={it} name={nameOf(it.id)} coins={coins} commons={commons} rares={rares} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
