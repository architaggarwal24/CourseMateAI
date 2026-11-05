"use client";

// Account -> Admin (Stage 4.1): find any account and give it any plan, for some days or for good; ban and unban;
// make admins (the owner only); invite codes that grant a plan. Server rules: src/server/admin.ts.
import { useCallback, useEffect, useState } from "react";
import { Ban, Crown, Search, ShieldCheck, Sparkles, Ticket, UserCog } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Skeleton, toast } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { adminApi, shortDate, TIER_OPTIONS, usd, type AdminUser, type AiReport, type Invite, type Tier } from "@/lib/admin/adminApi";

const PAGE = 25;

function daysOrNull(text: string): number | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : "bad";
}

function planLine(u: AdminUser): string {
  if (u.is_owner) return "Archmage (owner)";
  if (!u.plan) return "Apprentice (Free)";
  return u.plan.expires_at ? `${u.tier_name} until ${shortDate(u.plan.expires_at)}` : `${u.tier_name}, no end`;
}

function UserEditor({ user, isOwnerActor, onClose, onSaved }: {
  user: AdminUser;
  isOwnerActor: boolean;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const [tier, setTier] = useState<Tier>(user.plan?.tier ?? "scholar");
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [banDays, setBanDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [daysError, setDaysError] = useState("");

  async function run(fn: () => Promise<AdminUser>, done: string) {
    setBusy(true);
    try {
      const fresh = await fn();
      toast.success(done);
      onSaved(fresh);
    } catch (e) {
      toast.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  function savePlan() {
    const d = daysOrNull(days);
    if (d === "bad") { setDaysError("A whole number of days from 1 to 3650, or empty for no end"); return; }
    if (tier === "apprentice") { void run(() => adminApi.clearPlan(user.user_id), "Back on Free"); return; }
    void run(() => adminApi.setPlan(user.user_id, tier, d), `Plan set: ${TIER_OPTIONS.find((t) => t.value === tier)?.label}`);
  }

  function doBan() {
    const d = daysOrNull(banDays);
    if (d === "bad") { toast.error("Ban days: a whole number from 1 to 3650, or empty for good"); return; }
    void run(() => adminApi.ban(user.user_id, reason, d), "Banned and signed out");
  }

  return (
    <Modal open onClose={onClose} title={user.full_name || user.email} size="wide"
      actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-6">
        <p className="text-sm text-fg-2">{user.email}{user.username ? ` · @${user.username}` : ""} · {planLine(user)}</p>

        {user.is_owner ? (
          <p className="text-sm text-fg-2">This is the owner account (OWNER_EMAIL): always an admin, always on Archmage.</p>
        ) : (
          <>
            <section aria-labelledby="ed-plan" className="space-y-3">
              <h3 id="ed-plan" className="text-sm font-semibold text-fg">Plan</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Plan" value={tier} onChange={(e) => setTier(e.currentTarget.value as Tier)}>
                  {TIER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <Input label="Days" inputMode="numeric" value={days} disabled={tier === "apprentice"}
                  hint="Empty = no end" error={daysError || undefined}
                  onChange={(e) => { setDays(e.currentTarget.value); setDaysError(""); }} />
              </div>
              <Button variant="primary" onClick={savePlan} loading={busy}>Save plan</Button>
            </section>

            {isOwnerActor && (
              <section aria-labelledby="ed-role" className="space-y-3">
                <h3 id="ed-role" className="text-sm font-semibold text-fg">Role</h3>
                <p className="text-sm text-fg-2">{user.role === "admin" ? "An admin: can use this page." : "A regular account."}</p>
                <Button onClick={() => void run(() => adminApi.setRole(user.user_id, user.role === "admin" ? "user" : "admin"),
                  user.role === "admin" ? "No longer an admin" : "Now an admin")} disabled={busy}>
                  <UserCog size={14} aria-hidden="true" />{user.role === "admin" ? "Remove admin" : "Make admin"}
                </Button>
              </section>
            )}

            <section aria-labelledby="ed-ban" className="space-y-3">
              <h3 id="ed-ban" className="text-sm font-semibold text-fg">Access</h3>
              {user.banned ? (
                <>
                  <p className="text-sm text-fg-2">
                    Banned{user.ban_reason ? `: ${user.ban_reason}` : ""}{user.ban_expires ? `, until ${shortDate(user.ban_expires)}` : ", for good"}.
                  </p>
                  <Button onClick={() => void run(() => adminApi.unban(user.user_id), "Unbanned")} disabled={busy}>Unban</Button>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Reason (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.currentTarget.value)} />
                    <Input label="Ban days" inputMode="numeric" value={banDays} hint="Empty = for good" onChange={(e) => setBanDays(e.currentTarget.value)} />
                  </div>
                  <Button variant="danger" onClick={doBan} disabled={busy}><Ban size={14} aria-hidden="true" />Ban and sign out</Button>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function Users({ isOwnerActor }: { isOwnerActor: boolean }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ users: AdminUser[]; total: number } | null>(null);
  const [failed, setFailed] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setFailed("");
    try {
      setData(await adminApi.users(query, offset, PAGE));
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Couldn't load the accounts");
    }
  }, [query, offset]);
  useEffect(() => { void load(); }, [load]);

  function saved(u: AdminUser) {
    setEditing(u);
    setData((d) => (d ? { ...d, users: d.users.map((x) => (x.user_id === u.user_id ? u : x)) } : d));
  }

  return (
    <Card title="Accounts" className="settings-section">
      <form className="flex gap-2 items-end" role="search" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(q); }}>
        <Input label="Find an account" placeholder="Email, username or name" value={q} wrapperClassName="flex-1"
          leading={<Search size={15} aria-hidden="true" />} onChange={(e) => setQ(e.currentTarget.value)} />
        <Button type="submit">Search</Button>
      </form>

      {failed ? (
        <Card tone="danger" pad="sm" role="alert" className="mt-4"><p className="text-sm text-ink-red">{failed}</p></Card>
      ) : !data ? (
        <div className="mt-4 space-y-2" aria-busy="true"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : data.users.length === 0 ? (
        <EmptyState className="mt-4" title="No accounts found" description={query ? "Try another search." : "Nobody has signed up yet."} />
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line list-none p-0 m-0" aria-label="Accounts">
            {data.users.map((u) => (
              <li key={u.user_id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg truncate">
                    {u.full_name || u.username || u.email}
                    {u.username && <span className="text-fg-muted font-normal"> @{u.username}</span>}
                  </p>
                  <p className="text-xs text-fg-muted truncate">{u.email} · joined {shortDate(u.created_at)}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={u.tier === "apprentice" ? "neutral" : "accent"}>{planLine(u)}</Badge>
                    {u.is_owner && <Badge tone="reward"><Crown size={11} aria-hidden="true" /> Owner</Badge>}
                    {!u.is_owner && u.role === "admin" && <Badge tone="accent"><ShieldCheck size={11} aria-hidden="true" /> Admin</Badge>}
                    {u.banned && <Badge tone="danger">Banned</Badge>}
                    {!u.email_verified && <Badge tone="warning">Email not verified</Badge>}
                  </div>
                </div>
                <Button size="sm" onClick={() => setEditing(u)} aria-label={`Manage ${u.email}`}>Manage</Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between text-sm text-fg-muted">
            <span>{offset + 1}–{offset + data.users.length} of {data.total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </div>
          </div>
        </>
      )}
      {editing && <UserEditor user={editing} isOwnerActor={isOwnerActor} onClose={() => { setEditing(null); void load(); }} onSaved={saved} />}
    </Card>
  );
}

function Invites() {
  const [list, setList] = useState<Invite[] | null>(null);
  const [form, setForm] = useState({ tier: "sage" as Tier, days: "30", uses: "10", code: "", note: "", valid: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList((await adminApi.invites()).invites); } catch (e) { toast.apiError(e); setList([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const days = daysOrNull(form.days), valid = daysOrNull(form.valid), uses = Number(form.uses);
    if (days === "bad" || valid === "bad" || !Number.isInteger(uses) || uses < 1) { toast.error("Use whole numbers of 1 or more (days: empty = no end)"); return; }
    setBusy(true);
    try {
      const made = await adminApi.createInvite({ tier: form.tier, days, max_uses: uses, code: form.code.trim() || undefined, note: form.note.trim() || undefined, valid_days: valid });
      toast.success(`Code ${made.code} created`);
      setForm((f) => ({ ...f, code: "", note: "" }));
      await load();
    } catch (err) {
      toast.apiError(err);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code: string) {
    try { await adminApi.revokeInvite(code); toast.success(`${code} revoked`); await load(); } catch (e) { toast.apiError(e); }
  }

  return (
    <Card title="Invite codes" className="settings-section">
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
        <Select label="Plan" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.currentTarget.value as Tier })}>
          {TIER_OPTIONS.filter((t) => t.value !== "apprentice").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Input label="Plan days" inputMode="numeric" value={form.days} hint="Empty = no end" onChange={(e) => setForm({ ...form, days: e.currentTarget.value })} />
        <Input label="Uses" inputMode="numeric" value={form.uses} onChange={(e) => setForm({ ...form, uses: e.currentTarget.value })} />
        <Input label="Code (optional)" value={form.code} placeholder="Made up for you" spellCheck={false} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} />
        <Input label="Code works for (days)" inputMode="numeric" value={form.valid} hint="Empty = until used up" onChange={(e) => setForm({ ...form, valid: e.currentTarget.value })} />
        <Input label="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
        <div className="sm:col-span-3"><Button type="submit" variant="primary" loading={busy}><Ticket size={14} aria-hidden="true" />Create code</Button></div>
      </form>

      {!list ? (
        <Skeleton className="h-12 mt-4" />
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No codes yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line list-none p-0 m-0" aria-label="Invite codes">
          {list.map((i) => (
            <li key={i.code} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono font-medium text-fg">{i.code}</p>
                <p className="text-xs text-fg-muted">
                  {i.tier_name} · {i.days ? `${i.days} days` : "no end"} · used {i.uses} of {i.max_uses}
                  {i.expires_at ? ` · works until ${shortDate(i.expires_at)}` : ""}{i.note ? ` · ${i.note}` : ""}
                </p>
              </div>
              {i.usable ? (
                <Button size="sm" variant="ghost" onClick={() => void revoke(i.code)} aria-label={`Revoke ${i.code}`}>Revoke</Button>
              ) : (
                <Badge tone="neutral">{i.revoked ? "Revoked" : "Used up or expired"}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AiSpend() {
  const [report, setReport] = useState<AiReport | null>(null);
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.ai();
      setReport(r);
      setCap(String(r.cap_usd));
    } catch (e) { toast.apiError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = cap.trim();
    const n = Number(t);
    const max = report?.cap_max_usd ?? 20;
    if (t === "" || !Number.isFinite(n) || n < 0 || n > max) { toast.error(`The cap is a number of US dollars, from 0 up to ${usd(max)}`); return; }
    setBusy(true);
    try {
      const r = await adminApi.setCap(n);
      setReport(r);
      toast.success(`Daily cap: ${usd(n)}`);
    } catch (err) { toast.apiError(err); } finally { setBusy(false); }
  }

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Sparkles size={16} aria-hidden="true" />AI spend</span>} className="settings-section">
      {!report ? <Skeleton className="h-16" /> : (
        <div className="space-y-4">
          <p className="text-sm text-fg tabular-nums">
            Today: <b>{usd(report.today_usd)}</b> of a {usd(report.cap_usd)} cap
            {" · "}last {report.days} days: <b>{usd(report.total_usd)}</b>
            {report.capped && <> {" "}<Badge tone="warning">Cap reached: everyone is on Workers AI until midnight UTC</Badge></>}
          </p>
          {report.can_edit ? (
            <form onSubmit={save} className="flex flex-wrap items-end gap-2">
              <Input label="Daily cap (US $)" inputMode="decimal" value={cap} hint={`0 up to ${usd(report.cap_max_usd)}`} wrapperClassName="w-44"
                onChange={(e) => setCap(e.currentTarget.value)} />
              <Button type="submit" loading={busy}>Save cap</Button>
            </form>
          ) : (
            <p className="text-sm text-fg-muted">Only the owner changes the cap (up to {usd(report.cap_max_usd)} a day).</p>
          )}
          {report.models.length > 0 && (
            <ul className="divide-y divide-line list-none p-0 m-0" aria-label="Cost per model">
              {report.models.map((m) => (
                <li key={`${m.provider}:${m.model}`} className="flex flex-wrap items-center gap-3 py-2 text-sm tabular-nums">
                  <span className="font-mono text-fg min-w-0 flex-1 truncate">{m.provider}:{m.model}</span>
                  <span className="text-fg-muted">{m.calls} calls · {(m.tokens_in + m.tokens_out).toLocaleString("en-IN")} tokens</span>
                  <span className="text-fg">{usd(m.cost_usd)}</span>
                  {!m.priced && <Badge tone="warning">estimated: set MODEL_PRICES_JSON</Badge>}
                </li>
              ))}
            </ul>
          )}
          <details className="text-sm text-fg-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-fg">Which model answers what</summary>
            <ul className="mt-2 list-none p-0 space-y-1 font-mono text-xs">
              {(Object.keys(report.routes) as Tier[]).map((t) => (
                <li key={t}>{t}: questions → {report.routes[t].strong.join(" → ") || "none"}; small jobs → {report.routes[t].small.join(" → ") || "none"}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Card>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  if (!user?.is_admin) {
    return <div className="max-w-5xl mx-auto px-6 py-6"><EmptyState title="Admins only" description="This page is for the CourseMate team." /></div>;
  }
  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Admin</h1>
        <p className="text-sm text-fg-muted">Accounts, plans and invite codes</p>
      </div>
      <Users isOwnerActor={!!user.is_owner} />
      <AiSpend />
      <Invites />
    </div>
  );
}
