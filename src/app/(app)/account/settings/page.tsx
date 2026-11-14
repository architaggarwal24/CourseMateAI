"use client";

import { API_BASE_URL, throwForResponse } from "@/lib/api/client";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import {
  User, Lock, Trash2, Loader2, Save,
  Eye, EyeOff, CheckCircle2, XCircle,
  Type, Zap, Database, Download, AlertTriangle,
} from "@/components/ui/icons";
import { Button, Card, Checkbox, Input } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { parseApiError, rawApi } from "@/lib/api";
import { loadMetadata, deleteSession } from "@/lib/study/sessions";
import InstallApp from "@/components/pwa/InstallApp";
import ThemeSwitch from "@/components/account/ThemeSwitch";
import AccentSwitch from "@/components/account/AccentSwitch";
import SectionIndex from "@/components/account/SectionIndex";
import MyModel from "@/components/account/MyModel";
import SoundSettings from "@/components/account/SoundSettings";
import { ROUTES } from "@/lib/routes";


const NETWORK_SAVE_MESSAGE = "Couldn't reach the server, so nothing was saved. Check your connection and try again.";

// ── Settings persistence ─────────────────────────────────────────────────────
function loadAppearance() {
  if (typeof window === "undefined") return { fontSize: "normal", reduceAnimations: false };
  try {
    return JSON.parse(localStorage.getItem("cmai_appearance") || "{}");
  } catch { return {}; }
}
function saveAppearance(prefs: { fontSize: string; reduceAnimations: boolean }) {
  localStorage.setItem("cmai_appearance", JSON.stringify(prefs));
  applyAppearance(prefs);
}
function applyAppearance(prefs: { fontSize: string; reduceAnimations: boolean }) {
  const html = document.documentElement;
  html.classList.toggle("text-lg-mode", prefs.fontSize === "large");
  html.classList.toggle("reduce-animations", !!prefs.reduceAnimations);
}

// ── Section wrapper ───────────────────────────────────────────────────────────
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const SECTIONS = ["Account", "AI", "Appearance", "App", "Data & Privacy", "Danger Zone"];
const SECTION_LINKS = SECTIONS.map((t) => ({ id: slug(t), label: t }));
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card id={slug(title)} title={title} interactive className="settings-section">{children}</Card>;
}

/** A label above something that is not a single text field (a button group, a status row). */
function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="ui-field__label">{label}</p>
      {children}
      {hint && <p className="ui-field__hint">{hint}</p>}
    </div>
  );
}

function RevealButton({ shown, onToggle, label }: { shown: boolean; onToggle: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" icon onClick={onToggle} aria-label={`${shown ? "Hide" : "Show"} ${label}`}>
      {shown ? <EyeOff size={15} /> : <Eye size={15} />}
    </Button>
  );
}

export default function SettingsPage() {
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    fullName: "", username: "", email: "",
    currentPassword: "", newPassword: "", confirmPassword: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  // ── Appearance state ──────────────────────────────────────────────────────
  const [fontSize, setFontSize] = useState<"normal" | "large">("normal");
  const [reduceAnimations, setReduceAnimations] = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [clearingChat, setClearingChat] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Load initial values ───────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push(ROUTES.login);
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      setForm(f => ({ ...f, fullName: user.full_name || "", username: user.username || "", email: user.email || "" }));
    }
  }, [user]);

  useEffect(() => {
    const prefs = loadAppearance();
    setFontSize(prefs.fontSize === "large" ? "large" : "normal");
    setReduceAnimations(!!prefs.reduceAnimations);
  }, []);

  // ── Username availability check ───────────────────────────────────────────
  useEffect(() => {
    if (!form.username || form.username === user?.username) { setUsernameAvailable(null); return; }
    const t = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const { data } = await rawApi.GET("/auth/check-username", { params: { query: { username: form.username } } });
        setUsernameAvailable(data?.available ?? null);
      } catch { /* ignore */ }
      setCheckingUsername(false);
    }, 500);
    return () => clearTimeout(t);
  }, [form.username, user?.username]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.username.length < 3) { toast.error("Username must be at least 3 characters"); return; }
    if (form.username !== user?.username && usernameAvailable === false) { toast.error("Username is not available"); return; }
    if (form.newPassword && form.newPassword !== form.confirmPassword) { toast.error("Passwords do not match"); return; }
    if (form.newPassword && form.newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    // The email you log in with, like the password, needs your current password to change (a stolen session can't).
    if (form.email !== user?.email && !form.currentPassword) { toast.error("Enter your current password to change your email"); return; }

    setSavingProfile(true);
    const body: any = {};
    if (form.fullName !== user?.full_name) body.full_name = form.fullName;
    if (form.username !== user?.username) body.username = form.username;
    if (form.email !== user?.email) body.email = form.email;
    if (form.newPassword) body.new_password = form.newPassword;
    if (form.newPassword || body.email) body.current_password = form.currentPassword;

    try {
      const { error: err, response } = await rawApi.POST("/auth/update-profile", { body });
      if (response.ok) {
        toast.success("Profile saved");
        setForm(f => ({ ...f, currentPassword: "", newPassword: "", confirmPassword: "" }));
        setTimeout(() => window.location.reload(), 800);
      } else {
        toast.apiError(parseApiError(response.status, err));
      }
    } catch (e) { toast.apiError(e, { fallbackMessage: NETWORK_SAVE_MESSAGE }); }
    setSavingProfile(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") { toast.error('Type DELETE to confirm'); return; }
    if (!deletePassword) { toast.error("Enter your password to delete your account"); return; }
    setDeletingAccount(true);
    try {
      const { error: err, response } = await rawApi.DELETE("/auth/delete-account", { body: { password: deletePassword, confirm: deleteConfirm } } as never);
      if (response.ok) {
        toast.success("Account deleted");
        await logout();
        router.push(ROUTES.login);
      } else {
        toast.apiError(parseApiError(response.status, err));
      }
    } catch (e) { toast.apiError(e); }
    setDeletingAccount(false);
  };

  const handleAppearanceSave = () => {
    saveAppearance({ fontSize, reduceAnimations });
    toast.success("Appearance saved");
  };

  const handleClearChatHistory = () => {
    setClearingChat(true);
    const meta = loadMetadata();
    let count = 0;
    for (const [id, m] of Object.entries(meta)) {
      if (m.type === "chat") { deleteSession(id); count++; }
    }
    toast.success(`Cleared ${count} chat session${count !== 1 ? "s" : ""}`);
    setClearingChat(false);
  };

  const handleClearAllSessions = async () => {
    setClearingSessions(true);
    const meta = loadMetadata();
    for (const id of Object.keys(meta)) deleteSession(id);
    // Sessions live in localStorage only - the server has no "clear sessions" endpoint.
    toast.success("All session data cleared");
    setClearingSessions(false);
  };

  // a copy of everything the app keeps about you (GET /account/export: the server reads every table, not the
  // browser stitching two screens together)
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/account/export`, { credentials: "include" });
      if (!res.ok) await throwForResponse(res);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "coursemateai-data.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Your data is downloading");
    } catch (e) { toast.apiError(e, { onRetry: handleExport }); }
    setExporting(false);
  };



  if (authLoading) return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Loader2 size={32} className="ui-spinner text-ink-gold" aria-label="Loading" />
    </div>
  );
  if (!user) return null;

  // The title and the index stay put; only the sections scroll (in `scroller`), and the index marks where you are.
  return (
    <div className="settings-page">
      <div className="settings-head">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Settings</h1>
        <p className="text-sm text-fg-muted">Manage your account and preferences</p>
      </div>

      <div className="settings-grid">
      <SectionIndex label="Settings sections" items={SECTION_LINKS} scroller={scroller} />
      <div ref={scroller} className="settings-scroll" tabIndex={0} role="region" aria-label="Settings">
      <div className="space-y-6 min-w-0">

        {/* ── ACCOUNT ──────────────────────────────────────────────────────── */}
        <Section title="Account">
          <form onSubmit={handleSaveProfile} className="space-y-5">

            <Input label="Full Name" type="text" value={form.fullName}
              onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
              leading={<User size={16} />} placeholder="Your name" />

            <Input label="Username" type="text" value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              leading={<span className="text-sm">@</span>} placeholder="username" minLength={3}
              error={usernameAvailable === false ? "Username already taken" : undefined}
              trailing={
                checkingUsername ? <Loader2 size={14} className="ui-spinner" aria-label="Checking username" />
                : usernameAvailable === true ? <CheckCircle2 size={14} className="text-ink-green" aria-label="Username available" />
                : usernameAvailable === false ? <XCircle size={14} className="text-ink-red" aria-hidden="true" />
                : undefined
              } />

            <Input label="Email" type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="you@example.com" />

            {/* Divider */}
            <div className="border-t border-line pt-4">
              <p className="text-sm font-medium text-fg-2 mb-4 flex items-center gap-2">
                <Lock size={12} /> Password (also needed to change your email)
              </p>

              <div className="space-y-4">
                <Input label="Current Password" type={showCurrent ? "text" : "password"} value={form.currentPassword}
                  onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
                  placeholder="••••••••"
                  trailing={<RevealButton shown={showCurrent} onToggle={() => setShowCurrent(v => !v)} label="current password" />} />

                <Input label="New Password" hint="At least 8 characters" type={showNew ? "text" : "password"} value={form.newPassword}
                  onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                  placeholder="••••••••" minLength={8}
                  trailing={<RevealButton shown={showNew} onToggle={() => setShowNew(v => !v)} label="new password" />} />

                <Input label="Confirm New Password" type={showConfirm ? "text" : "password"} value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="••••••••"
                  trailing={<RevealButton shown={showConfirm} onToggle={() => setShowConfirm(v => !v)} label="confirm password" />} />
              </div>
            </div>

            <Button type="submit" variant="primary" block loading={savingProfile} disabled={usernameAvailable === false}>
              {savingProfile ? "Saving..." : <><Save size={16} />Save Changes</>}
            </Button>
          </form>
        </Section>

        {/* ── AI ─────────────────────────────────────────────────────────────── */}
        <Section title="AI">
          <Card surface="inset" pad="sm" className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-ink-green shrink-0" aria-hidden="true" />
            <span className="text-sm text-fg">CourseMateAI&apos;s AI is included in your plan: nothing to set up. See what you&apos;ve used in Plan &amp; usage.</span>
          </Card>
          {user.is_admin && (
            <div className="mt-5">
              <FieldRow label="Your model (admins)">
                <div className="mt-2"><MyModel /></div>
              </FieldRow>
            </div>
          )}
        </Section>

        <Section title="Appearance">
          <FieldRow label="Theme" hint="System follows your device's light or dark setting. Changes apply at once.">
            <div className="mt-1"><ThemeSwitch /></div>
          </FieldRow>

          <FieldRow label="Accent colour" hint="Study's own colour. The Hero world keeps its pixel palette.">
            <div className="mt-1"><AccentSwitch /></div>
          </FieldRow>

          <FieldRow label="Font Size">
            <div className="flex gap-2 mt-1">
              {(["normal", "large"] as const).map(size => (
                <Button key={size} pressed={fontSize === size} onClick={() => setFontSize(size)}
                  className="flex-1 capitalize">
                  <Type size={14} />{size}
                </Button>
              ))}
            </div>
          </FieldRow>

          <Checkbox appearance="switch" checked={reduceAnimations}
            onChange={e => setReduceAnimations(e.target.checked)}
            label={<span className="flex items-center gap-2"><Zap size={14} className="text-ink-gold" />Reduce Animations — {reduceAnimations ? "Animations disabled" : "Animations enabled"}</span>}
            description="Disables pixel sparkles, screen shakes, and transitions" />

          <SoundSettings />

          <Button block onClick={handleAppearanceSave}>
            <Save size={15} />Apply Appearance
          </Button>
        </Section>

        <Section title="App">
          <InstallApp />
        </Section>

        {/* ── DATA & PRIVACY ────────────────────────────────────────────────── */}
        <Section title="Data & Privacy">
          <div className="space-y-3">

            <Card surface="inset" pad="lg" className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-fg">Clear Chat History</p>
                <p className="text-xs text-fg-muted mt-0.5">Removes all saved chat sessions from this device</p>
              </div>
              <Button onClick={handleClearChatHistory} loading={clearingChat} className="shrink-0">
                <Database size={14} />Clear
              </Button>
            </Card>

            <Card surface="inset" pad="lg" className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-fg">Clear saved sessions on this device</p>
                <p className="text-xs text-fg-muted mt-0.5">Forgets the chats and study sessions this browser remembers. Your account, PDFs and progress stay.</p>
              </div>
              <Button onClick={handleClearAllSessions} loading={clearingSessions} className="shrink-0">
                <Trash2 size={14} />Clear
              </Button>
            </Card>

            <Card surface="inset" pad="lg" className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-fg">Download a copy of your data</p>
                <p className="text-xs text-fg-muted mt-0.5">Everything we keep about your account, as one JSON file</p>
              </div>
              <Button onClick={handleExport} loading={exporting} className="shrink-0">
                <Download size={14} />Export
              </Button>
            </Card>

          </div>
        </Section>

        {/* ── DELETE ACCOUNT ────────────────────────────────────────────────── */}
        <Section title="Danger Zone">
          <Card tone="danger" surface="inset" pad="lg" className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-ink-red shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-ink-red">Delete Account</p>
                <p className="text-xs text-fg-muted mt-1">This permanently deletes your account, XP, coins, and all progress. This cannot be undone.</p>
              </div>
            </div>
            <Input label={<>Type <span className="font-mono text-ink-red">DELETE</span> to confirm</>}
              type="text" value={deleteConfirm} mono danger onInset
              onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE" />
            <Input label="Your password" type="password" value={deletePassword} danger onInset autoComplete="current-password"
              onChange={e => setDeletePassword(e.target.value)} placeholder="••••••••" />
            <Button variant="danger" block onClick={handleDeleteAccount}
              loading={deletingAccount} disabled={deleteConfirm !== "DELETE" || !deletePassword}>
              {deletingAccount ? "Deleting..." : <><Trash2 size={16} />Delete My Account</>}
            </Button>
          </Card>
        </Section>

      </div>
      </div>
      </div>
    </div>
  );
}
