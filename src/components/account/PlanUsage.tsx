"use client";

import { showUpgradeNow } from "@/lib/account/upgrade-notice";
import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, FileText, KeyRound, Sparkles, Ticket, Trash2 } from "@/components/ui/icons";
import { Badge, Button, Card, Input, Meter, Modal, Skeleton, toast, type MeterTone } from "@/components/ui";
import { undoable } from "@/lib/undo";
import { ApiError } from "@/lib/api";
import { useDocuments, useSessionStore } from "@/hooks/useSessions";
import {
  deleteDocument, fetchPlans, fetchUsage, fill, formatCount, formatInr, redeemCode, TIERS, untilText,
  type ManaInfo, type Plan, type PlansInfo, type Tier, type Usage,
} from "@/lib/account/plans";
import { completeManaStub, payManaWithRazorpay, startManaCheckout, verifyMana, type ManaCheckout } from "@/lib/account/mana";
import {
  cancelSubscription, completeStub, fetchBilling, payWithRazorpay, startCheckout, verifyPayment,
  type BillingStatus, type Checkout, type Subscription,
} from "@/lib/account/billing";
import "./plan-usage.css";

const LIMIT_LABEL: Record<string, string> = {
  ai_calls_day: "AI calls today", ocr_pages_day: "Scanned pages today", tokens_month: "AI tokens this month", documents: "Documents", courses: "Courses",
};

function sourceText(u: Usage): string {
  const until = u.expires_at ? ` until ${new Date(u.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "";
  switch (u.source) {
    case "invite": return `From an invite code${until}.`;
    case "admin": return `Set for you${until}.`;
    case "subscription": return `Your subscription${until}.`;
    default: return u.tier === "apprentice" ? "The free plan." : "This server's plan for every account.";
  }
}

/**
 * Account -> Plan & usage. What plan you're on and until when, how much of it you've used (AI calls today, tokens
 * this month, documents, courses), your documents (delete one to free a place), an invite code box, and every plan
 * side by side, with upgrades through Razorpay Checkout when payments are on (the stub's test dialog in testing),
 * and the subscription (renewal date, cancel at the end of the period).
 */
export default function PlanUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plans, setPlans] = useState<PlansInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [stub, setStub] = useState<Checkout | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, p, b] = await Promise.all([fetchUsage(), fetchPlans(), fetchBilling().catch(() => null)]);
      setUsage(u); setPlans(p); setBilling(b); setFailed(false);
    } catch (e) {
      setFailed(true);
      toast.apiError(e);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const paid = (sub: Subscription) => {
    void showUpgradeNow(`Welcome to ${sub.tier_name}!`);           // the "you've been upgraded" window
    void load();
  };
  const upgrade = async (tier: string) => {
    setBusyTier(tier);
    try {
      const c = await startCheckout(tier, yearly ? "year" : "month");
      if (c.provider === "stub") { setStub(c); return; }
      const r = await payWithRazorpay(c);
      if (r) paid(await verifyPayment(r));
      else toast.info("Checkout closed. Nothing was charged.");
    } catch (e) {
      toast.apiError(e);
    } finally {
      setBusyTier(null);
    }
  };

  if (failed && !usage) {
    return <div className="pu"><Card pad="lg"><p className="m-0">Your plan didn&apos;t load.</p><Button className="mt-3" onClick={() => void load()}>Try again</Button></Card></div>;
  }
  if (!usage || !plans) {
    return <div className="pu" aria-busy="true"><Skeleton className="h-[160px] w-full rounded-[var(--radius-xl)]" aria-label="Loading your plan" /></div>;
  }

  const meters: { key: string; used: number; allowed: number; note?: string }[] = [
    { key: "ai_calls_day", used: usage.used.ai_calls_day, allowed: usage.limits.ai_calls_day, note: `Resets ${untilText(usage.resets.ai_calls_day)}` },
    ...(usage.ocr?.allowed != null
      ? [{ key: "ocr_pages_day", used: usage.ocr.used, allowed: usage.ocr.allowed, note: `Scans and photos the AI reads. Resets ${untilText(usage.ocr.resets_at)}` }]
      : []),
    { key: "tokens_month", used: usage.used.tokens_month, allowed: usage.limits.tokens_month, note: `Renews ${untilText(usage.resets.tokens_month)}` },
    { key: "documents", used: usage.used.documents, allowed: usage.limits.documents, note: `PDFs up to ${usage.limits.pdf_mb} MB` },
    { key: "courses", used: usage.used.courses, allowed: usage.limits.courses, note: undefined },
  ];

  return (
    <div className="pu">
      <header className="pu-head">
        <div>
          <h1 className="pu-title">Plan &amp; usage</h1>
          <p className="pu-sub">What your plan includes and how much of it you&apos;ve used.</p>
        </div>
      </header>

      <section className="pu-plan lit" aria-labelledby="pu-plan-title">
        <div className="pu-plan__top">
          <span className="pu-plan__icon" aria-hidden="true"><Sparkles size={18} /></span>
          <div className="min-w-0">
            <h2 id="pu-plan-title" className="pu-plan__name">{usage.tier_name}</h2>
            <p className="pu-plan__src">{sourceText(usage)}</p>
          </div>
        </div>
        {usage.own_key.active && (
          <p className="pu-note"><KeyRound size={14} aria-hidden="true" />
            {usage.own_key.exempt
              ? `AI runs on your own provider key, so it doesn't use your plan's AI allowance (${usage.own_key.calls_today} calls today).`
              : "AI runs on your own provider key; it still counts toward your plan here."}
          </p>
        )}
        <ul className="pu-meters" aria-label="Usage">
          {meters.map((m) => {
            const f = fill(m.used, m.allowed);
            const label = LIMIT_LABEL[m.key];
            return (
              <li key={m.key} className="pu-meter" data-state={f.state}>
                <div className="pu-meter__row">
                  <span className="pu-meter__label">{label}</span>
                  <span className="pu-meter__value">{m.allowed ? <>{formatCount(m.used)} <span>of {formatCount(m.allowed)}</span></> : <span>Not on this plan</span>}</span>
                </div>
                <Meter label={label} value={f.share * Math.max(1, m.allowed)} max={Math.max(1, m.allowed)}
                       valueText={`${m.used} of ${m.allowed}`} tone={TONE[f.state]} />
                {m.note && <span className="pu-meter__note">{f.state === "full" && m.key !== "courses" ? "Used up. " : ""}{m.note}</span>}
              </li>
            );
          })}
          {usage.ai_budget?.limited && <BudgetMeter share={usage.ai_budget.share} resetsAt={usage.ai_budget.resets_at} />}
        </ul>
        {billing?.subscription && <SubscriptionLine sub={billing.subscription} onChanged={() => void load()} />}
      </section>

      <div className="pu-cols">
        <DocumentsBox allowed={usage.limits.documents} onChanged={() => void load()} />
        <RedeemBox onRedeemed={(u) => { setUsage(u); void showUpgradeNow(`You're on ${u.tier_name} now.`); }} />
      </div>

      {usage.mana && <ManaBox mana={usage.mana} onPaid={() => void load()} />}

      <section id="plans" aria-labelledby="pu-plans-title" className="pu-plans-wrap">
        <div className="pu-plans-head">
          <h2 id="pu-plans-title" className="pu-h2">Plans</h2>
          <div className="pu-billing" role="group" aria-label="Billing period">
            <Button size="sm" pressed={!yearly} onClick={() => setYearly(false)}>Monthly</Button>
            <Button size="sm" pressed={yearly} onClick={() => setYearly(true)}>Yearly <span className="pu-save">2 months free</span></Button>
          </div>
        </div>
        <ul className="pu-plans stage">
          {plans.plans.map((p) => (
            <PlanCard key={p.tier} plan={p} current={usage.tier as Tier} yearly={yearly} payments={plans.payments_enabled}
                      busy={busyTier === p.tier} onUpgrade={() => void upgrade(p.tier)} />
          ))}
        </ul>
        {!plans.payments_enabled && (
          <p className="pu-note">Payments open soon. Until then, plans come with invite codes.</p>
        )}
        {plans.payments_enabled && (
          <p className="pu-note"><CreditCard size={14} aria-hidden="true" />Payments by Razorpay (UPI, cards, netbanking). Renews automatically; cancel any time and keep your plan until the period ends.</p>
        )}
      </section>

      <Modal open={!!stub} onClose={() => setStub(null)} title="Test payment"
             actions={<><Button onClick={() => setStub(null)}>Cancel</Button>
               <Button variant="primary" onClick={async () => {
                 const c = stub!; setStub(null);
                 try { paid(await completeStub(c.subscription_id)); } catch (e) { toast.apiError(e); }
               }}>Pay {stub ? formatInr(stub.amount) : ""} (test)</Button></>}>
        <p className="m-0 text-fg-2">This server uses the test payment provider: no money moves. Paying switches you to <b>{stub?.tier_name}</b> ({stub?.period === "year" ? "yearly" : "monthly"}) right away.</p>
      </Modal>
    </div>
  );
}

function PlanCard({ plan, current, yearly, payments, busy, onUpgrade }: {
  plan: Plan; current: Tier; yearly: boolean; payments: boolean; busy?: boolean; onUpgrade?: () => void;
}) {
  const here = plan.tier === current;
  const higher = TIERS.indexOf(plan.tier as Tier) > TIERS.indexOf(current);
  const price = yearly ? plan.price_year : plan.price_month;
  const l = plan.limits;
  return (
    <li className="pu-card" data-current={here || undefined} aria-labelledby={`pu-card-${plan.tier}`}>
      <div className="pu-card__head">
        <h3 id={`pu-card-${plan.tier}`}>{plan.name}</h3>
        {here && <Badge tone="accent">Your plan</Badge>}
      </div>
      <p className="pu-card__price">
        {price ? <>{formatInr(price)}<span>/{yearly ? "year" : "month"}</span></> : <>Free</>}
      </p>
      <p className="pu-card__tag">{plan.tagline}</p>
      <ul className="pu-card__list">
        <li><Check size={14} aria-hidden="true" />{l.documents} documents, PDFs up to {l.pdf_mb} MB</li>
        <li><Check size={14} aria-hidden="true" />{formatCount(l.ai_calls_day)} AI calls a day</li>
        <li><Check size={14} aria-hidden="true" />{formatCount(l.tokens_month)} AI tokens a month</li>
        {l.courses > 0 && <li><Check size={14} aria-hidden="true" />{l.courses} courses</li>}
        {plan.highlights.map((h) => <li key={h}><Check size={14} aria-hidden="true" />{h}</li>)}
      </ul>
      {higher && (
        <Button variant={plan.tier === "sage" ? "primary" : "secondary"} block disabled={!payments} loading={busy}
                title={payments ? undefined : "Payments open soon"} onClick={onUpgrade}>
          {payments ? `Upgrade to ${plan.name}` : `${plan.name}: coming soon`}
        </Button>
      )}
      {/* said before you pay, not only in the Terms (legal and trust pass: auto-renewal disclosure) */}
      {higher && price && (
        <p className="pu-card__renew">
          Renews every {yearly ? "year" : "month"} at {formatInr(price)} until you cancel. Cancel any time in Plan &amp; usage: you keep the plan until the paid period ends.
        </p>
      )}
    </li>
  );
}

/**
 * Today's AI budget (server/ai/budget.ts), as a share rather than money. Past it the answers come from a lighter
 * model until it resets, or Mana pays for the full one.
 */
/** A usage meter's colour follows how full it is (fill() in lib/account/plans.ts). */
const TONE: Record<"ok" | "near" | "full", MeterTone> = { ok: "accent", near: "warning", full: "danger" };

function BudgetMeter({ share, resetsAt }: { share: number; resetsAt: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
  const state = fill(pct, 100).state;
  return (
    <li className="pu-meter" data-state={state}>
      <div className="pu-meter__row">
        <span className="pu-meter__label">Today&apos;s AI budget</span>
        <span className="pu-meter__value">{pct}% <span>used</span></span>
      </div>
      <Meter label="Today's AI budget" value={pct} valueText={`${pct}% used`} tone={TONE[state]} />
      <span className="pu-meter__note">
        {pct >= 100 ? "Used up: a lighter model answers until it resets, unless Mana pays. " : ""}Resets {untilText(resetsAt)}
      </span>
    </li>
  );
}

/**
 * Mana (server/account/wallet.ts): one-time packs that pay for AI answers once the day's budget is used up, so the
 * full model keeps answering. Paid plans only; only for studying, never game currency; no renewal.
 */
function ManaBox({ mana, onPaid }: { mana: ManaInfo; onPaid: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [stub, setStub] = useState<ManaCheckout | null>(null);
  const done = (added: { status: string; mana: number }, pack: string) => {
    const name = mana.packs.find((p) => p.id === pack)?.name ?? "Mana";
    if (added.status === "paid") toast.success(`${name} added. You have ${added.mana} Mana.`);
    else toast.info("Payment received. Your Mana will show up in a minute.");
    onPaid();
  };
  const buy = async (pack: string) => {
    setBusy(pack);
    try {
      const c = await startManaCheckout(pack);
      if (c.provider === "stub") { setStub(c); return; }
      const r = await payManaWithRazorpay(c);
      if (r) done(await verifyMana(r), pack);
      else toast.info("Checkout closed. Nothing was charged.");
    } catch (e) {
      toast.apiError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section id="mana" className="pu-box pu-mana" aria-labelledby="pu-mana-title">
      <h2 id="pu-mana-title" className="pu-h2"><Sparkles size={16} aria-hidden="true" />Mana <span className="pu-count">{mana.balance} left</span></h2>
      <p className="pu-box__text">
        Mana pays for AI answers once today&apos;s budget is used up, so the full model keeps answering. It never expires,
        and it&apos;s only for studying: it isn&apos;t game currency.
      </p>
      {!mana.can_buy ? (
        <p className="pu-note">Mana is for Scholar, Sage and Archmage. <a href="#plans">See plans</a></p>
      ) : !mana.payments_enabled ? (
        <p className="pu-note">Mana packs open when payments do.</p>
      ) : (
        <>
          <ul className="pu-packs">
            {mana.packs.map((p) => (
              <li key={p.id}>
                <Button variant={p.id === "medium" ? "primary" : "secondary"} block loading={busy === p.id} disabled={!!busy && busy !== p.id}
                        onClick={() => void buy(p.id)} aria-label={`Buy ${p.name}: ${p.mana} Mana for ${formatInr(p.inr)}`}>
                  {formatInr(p.inr)} · {p.mana} Mana
                </Button>
                <span className="pu-packs__name">{p.name}</span>
              </li>
            ))}
          </ul>
          <p className="pu-note"><CreditCard size={14} aria-hidden="true" />A one-time payment by Razorpay. Nothing renews.</p>
        </>
      )}
      <Modal open={!!stub} onClose={() => setStub(null)} title="Test payment"
             actions={<><Button onClick={() => setStub(null)}>Cancel</Button>
               <Button variant="primary" onClick={async () => {
                 const c = stub!; setStub(null);
                 try { done(await completeManaStub(c.order_id), c.pack); } catch (e) { toast.apiError(e); }
               }}>Pay {stub ? formatInr(stub.amount) : ""} (test)</Button></>}>
        <p className="m-0 text-fg-2">This server uses the test payment provider: no money moves. Paying adds <b>{stub?.mana} Mana</b> right away.</p>
      </Modal>
    </section>
  );
}

const DAY = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function SubscriptionLine({ sub, onChanged }: { sub: Subscription; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = ["authenticated", "active", "pending"].includes(sub.status);
  const text = !live
    ? sub.status === "halted" ? `Your ${sub.tier_name} payments failed, so the plan ended. Upgrade again to restart it.`
      : `Your ${sub.tier_name} subscription has ended.`
    : sub.status === "pending" ? `${sub.tier_name}: the last payment is being retried by Razorpay. Your plan stays on meanwhile.`
    : sub.cancel_at_period_end ? `${sub.tier_name} is cancelled and ends${sub.current_end ? ` on ${DAY(sub.current_end)}` : " at the end of the period"}.`
    : `${sub.tier_name}, ${sub.period === "year" ? "yearly" : "monthly"}${sub.current_end ? `: renews on ${DAY(sub.current_end)}` : ""}.`;
  const cancel = async () => {
    setBusy(true);
    try {
      await cancelSubscription();
      toast.success("Cancelled. Your plan stays until the paid period ends.");
      setConfirm(false);
      onChanged();
    } catch (e) {
      toast.apiError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pu-sub-line">
      <p className="pu-note"><CreditCard size={14} aria-hidden="true" />{text}{sub.provider === "stub" ? " (test payments)" : ""}</p>
      {live && !sub.cancel_at_period_end && <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Cancel subscription</Button>}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Cancel your subscription?"
             actions={<><Button onClick={() => setConfirm(false)}>Keep it</Button>
                       <Button variant="danger" loading={busy} onClick={() => void cancel()}>Cancel subscription</Button></>}>
        <p className="m-0 text-fg-2">You keep {sub.tier_name}{sub.current_end ? ` until ${DAY(sub.current_end)}` : " until the paid period ends"}, then go back to the free plan. Nothing more is charged.</p>
      </Modal>
    </div>
  );
}

function RedeemBox({ onRedeemed }: { onRedeemed: (u: Usage) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!code.trim()) { setError("Enter your invite code."); return; }
    setBusy(true);
    try {
      onRedeemed(await redeemCode(code.trim()));
      setCode(""); setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "invite_invalid") setError(e.message);
      else toast.apiError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="pu-box" aria-labelledby="pu-redeem-title">
      <h2 id="pu-redeem-title" className="pu-h2"><Ticket size={16} aria-hidden="true" />Invite code</h2>
      <p className="pu-box__text">A code from the team puts you on its plan.</p>
      <form className="pu-redeem" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Input label="Code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
               placeholder="BETA-XXXX" autoComplete="off" spellCheck={false} error={error ?? undefined} />
        <Button type="submit" variant="primary" loading={busy}>Redeem</Button>
      </form>
    </section>
  );
}

function DocumentsBox({ allowed, onChanged }: { allowed: number; onChanged: () => void }) {
  const { list } = useDocuments();
  const refreshDocument = useSessionStore((s) => s.refreshDocument);
  // Deleted here but still inside their undo window: hidden at once, sent when the window closes.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = list.filter((d) => !hidden.has(d.id));
  const show = (id: string, on: boolean) => setHidden((h) => {
    const next = new Set(h);
    if (on) next.delete(id); else next.add(id);
    return next;
  });
  const remove = (id: string, name: string) => {
    show(id, false);
    undoable({
      message: `${name} deleted`,
      undo: () => show(id, true),
      commit: async () => {
        await deleteDocument(id);
        await refreshDocument(id).catch(() => null);                   // gone on the server: gone here too
        show(id, true);                                                 // (the list no longer has it)
        onChanged();
      },
    });
  };
  return (
    <section className="pu-box" aria-labelledby="pu-docs-title">
      <h2 id="pu-docs-title" className="pu-h2"><FileText size={16} aria-hidden="true" />Your documents <span className="pu-count">{shown.length} of {allowed}</span></h2>
      {shown.length === 0 ? <p className="pu-box__text">No documents yet.</p> : (
        <ul className="pu-docs">
          {shown.map((d) => (
            <li key={d.id}>
              <span className="pu-docs__name" title={d.filename}>{d.filename}</span>
              <Button size="sm" icon variant="ghost" onClick={() => remove(d.id, d.filename)}
                      aria-label={`Delete ${d.filename}`} title="Delete (you can undo it for a few seconds)"><Trash2 size={15} /></Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
