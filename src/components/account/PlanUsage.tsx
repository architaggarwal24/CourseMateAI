"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, FileText, KeyRound, Sparkles, Ticket, Trash2 } from "lucide-react";
import { Badge, Button, Card, Input, Modal, Skeleton, toast } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useDocuments, useSessionStore } from "@/hooks/useSessions";
import {
  deleteDocument, fetchPlans, fetchUsage, fill, formatCount, formatInr, redeemCode, TIERS, untilText,
  type Plan, type PlansInfo, type Tier, type Usage,
} from "@/lib/account/plans";
import {
  cancelSubscription, completeStub, fetchBilling, payWithRazorpay, startCheckout, verifyPayment,
  type BillingStatus, type Checkout, type Subscription,
} from "@/lib/account/billing";
import "./plan-usage.css";

const LIMIT_LABEL: Record<string, string> = {
  ai_calls_day: "AI calls today", tokens_month: "AI tokens this month", documents: "Documents", courses: "Courses",
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
    toast.success(`Welcome to ${sub.tier_name}!`);
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
    { key: "tokens_month", used: usage.used.tokens_month, allowed: usage.limits.tokens_month, note: `Renews ${untilText(usage.resets.tokens_month)}` },
    { key: "documents", used: usage.used.documents, allowed: usage.limits.documents, note: `PDFs up to ${usage.limits.pdf_mb} MB` },
    { key: "courses", used: usage.used.courses, allowed: usage.limits.courses, note: usage.limits.courses ? undefined : "Courses come with Sage" },
  ];

  return (
    <div className="pu">
      <header className="pu-head">
        <div>
          <h1 className="pu-title">Plan &amp; usage</h1>
          <p className="pu-sub">What your plan includes and how much of it you&apos;ve used.</p>
        </div>
      </header>

      <section className="pu-plan" aria-labelledby="pu-plan-title">
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
                <div className="pu-meter__bar" role="progressbar" aria-label={label} aria-valuemin={0}
                     aria-valuemax={Math.max(1, m.allowed)} aria-valuenow={Math.min(m.used, Math.max(1, m.allowed))}
                     aria-valuetext={`${m.used} of ${m.allowed}`}>
                  <span style={{ width: `${f.share * 100}%` }} />
                </div>
                {m.note && <span className="pu-meter__note">{f.state === "full" && m.key !== "courses" ? "Used up. " : ""}{m.note}</span>}
              </li>
            );
          })}
        </ul>
        {billing?.subscription && <SubscriptionLine sub={billing.subscription} onChanged={() => void load()} />}
      </section>

      <div className="pu-cols">
        <DocumentsBox allowed={usage.limits.documents} onChanged={() => void load()} />
        <RedeemBox onRedeemed={(u) => { setUsage(u); toast.success(`You're on ${u.tier_name} now.`); }} />
      </div>

      <section aria-labelledby="pu-plans-title" className="pu-plans-wrap">
        <div className="pu-plans-head">
          <h2 id="pu-plans-title" className="pu-h2">Plans</h2>
          <div className="pu-billing" role="group" aria-label="Billing period">
            <Button size="sm" pressed={!yearly} onClick={() => setYearly(false)}>Monthly</Button>
            <Button size="sm" pressed={yearly} onClick={() => setYearly(true)}>Yearly <span className="pu-save">2 months free</span></Button>
          </div>
        </div>
        <ul className="pu-plans">
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
    </li>
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
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await deleteDocument(confirm.id);
      await refreshDocument(confirm.id).catch(() => null);             // gone on the server: gone here too
      toast.success(`${confirm.name} deleted`);
      setConfirm(null);
      onChanged();
    } catch (e) {
      toast.apiError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="pu-box" aria-labelledby="pu-docs-title">
      <h2 id="pu-docs-title" className="pu-h2"><FileText size={16} aria-hidden="true" />Your documents <span className="pu-count">{list.length} of {allowed}</span></h2>
      {list.length === 0 ? <p className="pu-box__text">No documents yet.</p> : (
        <ul className="pu-docs">
          {list.map((d) => (
            <li key={d.id}>
              <span className="pu-docs__name" title={d.filename}>{d.filename}</span>
              <Button size="sm" icon variant="ghost" onClick={() => setConfirm({ id: d.id, name: d.filename })}
                      aria-label={`Delete ${d.filename}`} title="Delete"><Trash2 size={15} /></Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete this document?"
             actions={<><Button onClick={() => setConfirm(null)}>Keep it</Button>
                       <Button variant="danger" loading={busy} onClick={() => void remove()}>Delete</Button></>}>
        <p className="m-0 text-fg-2"><b>{confirm?.name}</b> is removed with its index, and it leaves its courses. You can upload it again later.</p>
      </Modal>
    </section>
  );
}
