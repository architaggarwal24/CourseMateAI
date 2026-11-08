"use client";

import { useEffect, useState } from "react";
import { Coins, Flame, Sparkles } from "@/components/icons";
import ItemArt from "@/components/champion/ItemArt";
import PixelConfetti from "@/components/fx/PixelConfetti";
import { Badge, Button, toast } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { coinRain } from "@/lib/fx/celebrate";
import { sfx } from "@/lib/sound/chip";
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";
import "./chest.css";

export interface ChestState { available: boolean; day: string; streak: number; bonus_pct: number }
export interface ChestReward { ok: boolean; streak: number; bonus_pct: number; coins: number; items: { id: string; name: string; kind: "potion" | "skin" }[]; totals: { coins: number } }

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
async function call<T>(path: string, post = false): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method: post ? "POST" : "GET", credentials: "include", headers: { "content-type": "application/json", ...(zone() ? { "x-timezone": zone() } : {}) }, body: post ? "{}" : undefined });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as T;
}

/** A pixel treasure chest, drawn with boxes (lid, body, lock, gold inside when open). */
function Chest({ open }: { open: boolean }) {
  return (
    <svg className="chest__svg" viewBox="0 0 32 28" shapeRendering="crispEdges" aria-hidden="true" data-open={open || undefined}>
      {open && <rect x="6" y="9" width="20" height="4" fill="#f5b942" />}
      {open && <rect x="9" y="7" width="3" height="3" fill="#fff2c2" />}
      {open && <rect x="18" y="6" width="4" height="4" fill="#f5b942" />}
      <g className="chest__lid">
        <rect x="3" y="4" width="26" height="8" fill="#03040d" />
        <rect x="4" y="5" width="24" height="6" fill="#8b4a1c" />
        <rect x="4" y="5" width="24" height="2" fill="#b0652a" />
        <rect x="14" y="5" width="4" height="6" fill="#c9a227" />
      </g>
      <rect x="3" y="12" width="26" height="14" fill="#03040d" />
      <rect x="4" y="13" width="24" height="12" fill="#6e3814" />
      <rect x="4" y="13" width="24" height="2" fill="#8b4a1c" />
      <rect x="4" y="19" width="24" height="2" fill="#c9a227" />
      <rect x="14" y="15" width="4" height="6" fill="#03040d" />
      <rect x="15" y="16" width="2" height="3" fill="#f5b942" />
    </svg>
  );
}

/**
 * The daily chest (Stage R3), on top of the quest board: once a day it shakes until opened; opening it throws the
 * lid back, coins rain, and what it held is shown (coins, maybe a potion, rarely a skin). A streak adds up to +100%.
 */
export default function DailyChest() {
  const [state, setState] = useState<ChestState | null>(null);
  const [reward, setReward] = useState<ChestReward | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { call<ChestState>("/chest").then(setState).catch(() => { /* no chest today, no harm */ }); }, []);
  if (!state) return null;

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const r = await call<ChestReward>("/chest/open", true);
      setTimeout(() => {
        setReward(r);
        setState({ ...state, available: false, streak: r.streak });
        useHUDStore.setState({ coins: r.totals.coins });
        sfx("chest");
        coinRain(r.coins * 2);
        void useHeroStore.getState().reconcile();
        setOpening(false);
      }, 650);
    } catch (e) { toast.apiError(e); setOpening(false); }
  };

  return (
    <section className="chest" data-state={reward ? "open" : state.available ? "ready" : "done"} aria-labelledby="chest-title">
      <div className="chest__art" data-opening={opening || undefined}>
        <Chest open={!!reward} />
        {reward && <PixelConfetti burst={reward.items.some((i) => i.kind === "skin") ? "epic" : "rare"} className="chest__confetti" />}
      </div>
      <div className="chest__body">
        <h3 id="chest-title" className="chest__title pixel-font">Daily chest</h3>
        {reward ? (
          <div role="status">
            <p className="m-0 text-sm">Inside:</p>
            <ul className="chest__loot">
              <li><Badge tone="reward"><Coins size={12} aria-hidden="true" />+{reward.coins} coins</Badge></li>
              {reward.items.map((i) => (
                <li key={i.id}><ItemArt itemId={i.id} size={28} /><span>{i.name}</span>{i.kind === "skin" && <Badge tone="epic"><Sparkles size={12} aria-hidden="true" />New skin</Badge>}</li>
              ))}
            </ul>
          </div>
        ) : state.available ? (
          <>
            <p className="m-0 text-sm text-fg-2">A new chest waits for you today.{state.bonus_pct ? ` Streak bonus: +${state.bonus_pct}% coins.` : ""}</p>
            <Button variant="reward" size="sm" onClick={() => { void open(); }} loading={opening}>Open the chest</Button>
          </>
        ) : (
          <p className="m-0 text-sm text-fg-2">Opened today. A new chest comes tomorrow.</p>
        )}
        {state.streak > 0 && <p className="chest__streak"><Flame size={12} aria-hidden="true" />{state.streak} {state.streak === 1 ? "day" : "days"} in a row</p>}
      </div>
    </section>
  );
}
