"use client";
// Admin -> AI spend -> Budgets: how much each plan (all its users together) and each user may spend on AI a day, and
// the free tools on the public pages. Past a budget, calls go to the free Workers AI model until midnight UTC. An
// empty field is no limit at that level (the daily cap above still holds). The owner edits; other admins only see.
import { useState } from "react";
import { Button, Input, toast } from "@/components/ui";
import { adminApi, TIER_OPTIONS, usd, type AiBudgets as Budgets, type AiReport, type Tier } from "@/lib/admin/admin-api";

type Draft = { plan: Record<Tier, string>; user: Record<Tier, string>; tools: string };

const show = (v: number | null) => (v === null ? "" : String(v));
const toDraft = (b: Budgets): Draft => ({
  plan: Object.fromEntries(TIER_OPTIONS.map((t) => [t.value, show(b.plan[t.value])])) as Record<Tier, string>,
  user: Object.fromEntries(TIER_OPTIONS.map((t) => [t.value, show(b.user[t.value])])) as Record<Tier, string>,
  tools: show(b.tools),
});

/** A field's value: null for empty (no limit), a number in range, or undefined when it isn't valid. */
function read(raw: string, max: number): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
}

const spent = (report: AiReport, scope: string) => report.budget_today?.[scope]?.spent_usd ?? 0;

export default function AiBudgets({ report, onSaved }: { report: AiReport; onSaved: (r: AiReport) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(report.budgets));
  const [busy, setBusy] = useState(false);
  const max = report.cap_max_usd;
  const edit = report.can_edit;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const out: Budgets = { plan: { ...report.budgets.plan }, user: { ...report.budgets.user }, tools: null };
    const bad: string[] = [];
    for (const { value: t, label } of TIER_OPTIONS) {
      const plan = read(draft.plan[t], max);
      const user = read(draft.user[t], max);
      if (plan === undefined) bad.push(`${label}: all users`); else out.plan[t] = plan;
      if (user === undefined) bad.push(`${label}: each user`); else out.user[t] = user;
    }
    const tools = read(draft.tools, max);
    if (tools === undefined) bad.push("Free tools"); else out.tools = tools;
    if (bad.length) { toast.error(`Each budget is a number of US dollars from 0 up to ${usd(max)}, or empty for no limit (${bad.join(", ")})`); return; }
    setBusy(true);
    try {
      const r = await adminApi.setBudgets(out);
      onSaved(r);
      setDraft(toDraft(r.budgets));
      toast.success("Budgets saved");
    } catch (err) { toast.apiError(err); } finally { setBusy(false); }
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <Input label={label} inputMode="decimal" value={value} placeholder="No limit" disabled={!edit} wrapperClassName="w-40"
      onChange={(e) => set(e.currentTarget.value)} />
  );

  return (
    <section aria-labelledby="ai-budgets" className="space-y-3 border-t border-line pt-4">
      <div>
        <h3 id="ai-budgets" className="text-sm font-semibold text-fg">Daily budgets (US $)</h3>
        <p className="text-sm text-fg-muted">
          Each call reserves its worst-case cost first, so no budget can be passed. Past one, calls use the free Workers AI
          model until midnight UTC. Empty means no limit at that level; the daily cap still applies.
        </p>
      </div>
      <form onSubmit={save} className="space-y-3">
        <ul className="list-none p-0 m-0 divide-y divide-line">
          {TIER_OPTIONS.map(({ value: t, label }) => (
            <li key={t} className="flex flex-wrap items-end gap-3 py-2">
              <span className="min-w-36 flex-1 text-sm text-fg">
                {label}
                <span className="block text-xs text-fg-muted tabular-nums">Today: {usd(spent(report, `plan:${t}`))}</span>
              </span>
              {field(`${label}: all users a day`, draft.plan[t], (v) => setDraft((d) => ({ ...d, plan: { ...d.plan, [t]: v } })))}
              {field(`${label}: each user a day`, draft.user[t], (v) => setDraft((d) => ({ ...d, user: { ...d.user, [t]: v } })))}
            </li>
          ))}
          <li className="flex flex-wrap items-end gap-3 py-2">
            <span className="min-w-36 flex-1 text-sm text-fg">
              Free tools (public pages)
              <span className="block text-xs text-fg-muted tabular-nums">Today: {usd(spent(report, "tools"))}</span>
            </span>
            {field("Free tools a day", draft.tools, (v) => setDraft((d) => ({ ...d, tools: v })))}
          </li>
        </ul>
        {edit
          ? <Button type="submit" loading={busy}>Save budgets</Button>
          : <p className="text-sm text-fg-muted">Only the owner changes the budgets.</p>}
      </form>
    </section>
  );
}
