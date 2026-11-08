"use client";

import { useEffect, useState } from "react";
import { sfx } from "@/lib/sound/chip";
import { create } from "zustand";
import { Check, Coins, Eye, ShoppingBag, Sparkles } from "@/components/icons";
import ItemArt from "@/components/champion/ItemArt";
import PixelConfetti from "@/components/fx/PixelConfetti";
import { Badge, Button, Modal } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore, type ShopItem } from "@/hooks/useHero";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/rarity";
import "./purchase.css";

type Step = { kind: "confirm"; item: ShopItem } | { kind: "bought"; item: ShopItem; coinsLeft: number };

/** Which item the purchase screen is showing, and at which step (one screen for the whole Hero area). */
export const usePurchase = create<{ step: Step | null; ask: (item: ShopItem) => void; close: () => void; show: (s: Step) => void }>((set) => ({
  step: null,
  ask: (item) => set({ step: { kind: "confirm", item } }),
  close: () => set({ step: null }),
  show: (step) => set({ step }),
}));

const SLOT_WORD: Record<string, string> = { emote: "emote",  headgear: "head piece", armor: "outfit", weapon: "weapon finish", pet: "pet", title: "title", potion: "potion", special: "item" };

function Confirm({ item }: { item: ShopItem }) {
  const coins = useHUDStore((s) => s.coins);
  const purchase = useHeroStore((s) => s.purchase);
  const busy = useHeroStore((s) => !!s.pending[item.id]);
  const close = usePurchase((s) => s.close);
  const show = usePurchase((s) => s.show);
  const price = Number(item.price);
  const after = coins - price;
  const r = rarityOf(item);

  const buy = async () => {
    const ok = await purchase(item, { quiet: true });
    if (ok) show({ kind: "bought", item, coinsLeft: Math.max(0, after) });
  };

  return (
    <Modal open onClose={close} title={`Buy ${item.name}?`}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Not now</Button>
          <Button variant="primary" onClick={() => { void buy(); }} loading={busy} disabled={after < 0}>
            <ShoppingBag size={14} aria-hidden="true" />Buy for {price}
          </Button>
        </>
      }>
      <div className={`buy-confirm ${rarityClass(r)}`} data-testid="buy-confirm">
        <div className="buy-confirm__art"><ItemArt itemId={item.id} size={112} rarity={r} label={item.name} /></div>
        <div className="buy-confirm__text">
          <p className="m-0"><Badge tone={r === "common" ? "neutral" : r}>{RARITY_LABEL[r]}</Badge> <span className="text-xs text-fg-muted">{SLOT_WORD[item.category] ?? item.category}</span></p>
          {item.description && <p className="buy-confirm__desc">{item.description}</p>}
          <dl className="buy-confirm__ledger">
            <div><dt>Your coins</dt><dd className="pixel-font">{coins}</dd></div>
            <div><dt>Price</dt><dd className="pixel-font">-{price}</dd></div>
            <div className="buy-confirm__after" data-short={after < 0 || undefined}><dt>After</dt><dd className="pixel-font"><Coins size={12} aria-hidden="true" /> {after}</dd></div>
          </dl>
          {after < 0 && <p className="buy-confirm__short" role="alert">You need {-after} more coins.</p>}
        </div>
      </div>
    </Modal>
  );
}

function Bought({ item, coinsLeft }: { item: ShopItem; coinsLeft: number }) {
  const close = usePurchase((s) => s.close);
  const equip = useHeroStore((s) => s.equip);
  const useItem = useHeroStore((s) => s.useItem);
  const setPreview = useHeroStore((s) => s.setPreview);
  const [busy, setBusy] = useState(false);
  const r = rarityOf(item);
  useEffect(() => { sfx("buy"); }, [item.id]);
  const wearable = !item.consumable && !["potion", "special", "emote"].includes(item.category);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); close(); } };

  return (
    <Modal open onClose={close} title={r === "legendary" ? "Legendary find!" : r === "epic" ? "Epic find!" : "It's yours!"}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Done</Button>
          {wearable ? (
            <>
              <Button onClick={() => { setPreview(item.id); close(); }} disabled={busy}><Eye size={14} aria-hidden="true" />Try on</Button>
              <Button variant="primary" loading={busy} onClick={() => { void act(() => equip(item)); }}><Check size={14} aria-hidden="true" />Equip now</Button>
            </>
          ) : item.consumable && !item.arena_only ? (
            <Button variant="primary" loading={busy} onClick={() => { void act(() => useItem(item)); }}><Sparkles size={14} aria-hidden="true" />Use now</Button>
          ) : null}
        </>
      }>
      <div className={`buy-done ${rarityClass(r)}`} data-rarity={r} data-testid="buy-done">
        <PixelConfetti burst={r} className="buy-done__confetti" />
        <div className="buy-done__stage">
          <svg className="buy-done__rays" viewBox="-100 -100 200 200" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => <path key={i} d="M0 0 L-9 -100 L9 -100 Z" transform={`rotate(${i * 30})`} />)}
          </svg>
          <div className="buy-done__art"><ItemArt itemId={item.id} size={128} rarity={r} label={item.name} /></div>
        </div>
        <p className="buy-done__new pixel-font" aria-hidden="true">New {SLOT_WORD[item.category] ?? "item"}!</p>
        <p className="buy-done__name">{item.name}</p>
        {item.category === "emote" && <p className="m-0 text-sm text-fg-2">Pick it on the emote wheel after your next win.</p>}
        <p className="m-0 text-sm text-fg-2" role="status">Bought. You have <span className="pixel-font">{coinsLeft}</span> coins left.</p>
      </div>
    </Modal>
  );
}

/** The purchase screen: "Buy it?" with what it costs and what's left, then a reveal with confetti once it's yours. */
export default function PurchaseFlow() {
  const step = usePurchase((s) => s.step);
  if (!step) return null;
  return step.kind === "confirm" ? <Confirm item={step.item} /> : <Bought item={step.item} coinsLeft={step.coinsLeft} />;
}
