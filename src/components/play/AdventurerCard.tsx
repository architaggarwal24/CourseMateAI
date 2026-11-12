"use client";

import { useEffect, useRef, useState } from "react";
import { Award, Crown, Download, Flame, Gauge, HeartPulse, Skull } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { fetchAdventurer } from "@/lib/arena/api";
import type { AdventurerCardData } from "@/lib/arena/types";
import { toCanvas } from "@/lib/pixel/canvas";
import { heroFrame } from "@/lib/pixel/sprites";

export const CARD_W = 640, CARD_H = 360;

/** The card's lines, in order (the page and the downloaded image say the same). */
export function cardLines(d: AdventurerCardData): [string, string][] {
  return [
    ["Level", String(d.level)], ["Power", String(d.power)], ["Best Survival", `${d.survival_best} ${d.survival_best === 1 ? "boss" : "bosses"}`],
    ["Boss Rush", `${d.rush_wins} ${d.rush_wins === 1 ? "clear" : "clears"}`], ["Bestiary", `${d.bestiary.beaten}/${d.bestiary.total} hunted`],
    ["Achievements", `${d.achievements.unlocked}/${d.achievements.total}`], ["Streak", `${d.streak} ${d.streak === 1 ? "day" : "days"}`],
  ];
}

/**
 * The Adventurer card (the two worlds, Stage 7): who you are in the Hero world, on one card - your champion, level,
 * power level, best Survival, Boss Rush clears, Bestiary progress, achievements and streak. Download it as an image
 * (drawn here, pixel for pixel), or share it where the device can.
 */
export default function AdventurerCard() {
  const [data, setData] = useState<AdventurerCardData | null>(null);
  const { hero } = useChampionLook();
  const font = useRef<HTMLSpanElement>(null);
  useEffect(() => { let alive = true; fetchAdventurer().then((d) => alive && setData(d)).catch(() => {}); return () => { alive = false; }; }, []);
  if (!data) return null;

  const draw = (): HTMLCanvasElement | null => {
    const c = document.createElement("canvas");
    c.width = CARD_W; c.height = CARD_H;
    const g = c.getContext("2d");
    if (!g) return null;
    const family = (font.current && getComputedStyle(font.current).fontFamily) || "monospace";
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#0b0e26"; g.fillRect(0, 0, CARD_W, CARD_H);
    g.fillStyle = "#03040d"; g.fillRect(0, 0, CARD_W, 8); g.fillRect(0, CARD_H - 8, CARD_W, 8); g.fillRect(0, 0, 8, CARD_H); g.fillRect(CARD_W - 8, 0, 8, CARD_H);
    g.strokeStyle = hero.accent; g.lineWidth = 4; g.strokeRect(14, 14, CARD_W - 28, CARD_H - 28);
    const f = heroFrame(hero, "win", 0);
    const img = toCanvas(f.buf);
    g.drawImage(img as CanvasImageSource, 10, 60, f.buf.w * 1.6, f.buf.h * 1.6);
    g.fillStyle = "#f5b942"; g.font = `20px ${family}`; g.fillText("ADVENTURER", 36, 50);
    g.fillStyle = hero.accent; g.font = `16px ${family}`; g.fillText(hero.name.toUpperCase(), 36, CARD_H - 34);
    g.fillStyle = "#ffffff"; g.font = `18px ${family}`; g.fillText(data.name.slice(0, 22), 300, 56);
    cardLines(data).forEach(([k, v], i) => {
      g.fillStyle = "#a5b4fc"; g.font = `12px ${family}`; g.fillText(k.toUpperCase(), 300, 96 + i * 34);
      g.fillStyle = "#ffffff"; g.font = `16px ${family}`; g.fillText(v, 470, 96 + i * 34);
    });
    g.fillStyle = "#6b7280"; g.font = `10px ${family}`; g.fillText("COURSEMATEAI", CARD_W - 150, CARD_H - 30);
    return c;
  };
  const blob = () => new Promise<Blob | null>((ok) => { const c = draw(); if (!c) ok(null); else c.toBlob(ok, "image/png"); });
  const download = async () => {
    const b = await blob();
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url; a.download = "adventurer-card.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = async () => {
    const b = await blob();
    if (!b) return;
    const file = new File([b], "adventurer-card.png", { type: "image/png" });
    try { await navigator.share({ files: [file], title: "My Adventurer card" }); } catch { /* cancelled */ }
  };
  const ICONS = [Crown, Gauge, HeartPulse, Skull, Skull, Award, Flame];

  return (
    <section className="adv-card-wrap" aria-labelledby="adv-card-title">
      <h3 id="adv-card-title" className="hero-label">Adventurer card</h3>
      <div className="adv-card" style={{ "--hero-accent": hero.accent } as React.CSSProperties} data-testid="adventurer-card">
        <div className="adv-card__hero">
          <PixelSprite hero={hero} anim="win" className="adv-card__sprite" />
          <span className="adv-card__champ pixel-font" ref={font}>{hero.name}</span>
        </div>
        <div className="adv-card__body">
          <p className="adv-card__name pixel-font">{data.name}</p>
          <dl className="adv-card__stats">
            {cardLines(data).map(([k, v], i) => { const I = ICONS[i]; return <div key={k}><dt><I size={13} aria-hidden="true" />{k}</dt><dd className="pixel-font">{v}</dd></div>; })}
          </dl>
          {data.achievements.recent.length > 0 && <p className="adv-card__recent">Latest: {data.achievements.recent.join(" · ")}</p>}
        </div>
      </div>
      <div className="adv-card__actions">
        <Button onClick={() => void download()}><Download size={15} aria-hidden="true" />Download as image</Button>
        {canShare && <Button variant="ghost" onClick={() => void share()}>Share</Button>}
      </div>
    </section>
  );
}
