"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, User, Lock, Trash2, Loader2, Save,
  Eye, EyeOff, CheckCircle2, XCircle,
  Type, Zap, Database, Download, AlertTriangle, Key, ExternalLink, Info,
} from "lucide-react";
import { toast } from "sonner";
import { loadMetadata, deleteSession } from "@/lib/sessions";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-bg-secondary/40">
        <h2 className="text-sm font-semibold text-text-primary pixel-font uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
    </div>
  );
}

const PROVIDERS_SETTINGS = [
  {
    id: "mistral", label: "Mistral AI",
    docsUrl: "https://console.mistral.ai/api-keys",
    usageUrl: "https://console.mistral.ai/usage",
    recommended: true,
    infoTooltip: null,
    models: [
      { id: "mistral-large-2512", label: "Mistral Large" },
    ],
  },
  {
    id: "gemini", label: "Google Gemini",
    docsUrl: "https://aistudio.google.com/app/apikey",
    usageUrl: "https://aistudio.google.com/app/usage",
    recommended: false,
    infoTooltip: "Free but limited quota",
    // FIX BUG 43: key_service validates Gemini keys against gemini-1.5-flash by default.
    // If the user selects a 2.5 model and their free-tier key can't access it,
    // they get a 404 at runtime. The validation in key_service now passes the
    // selected model through, giving a clear error if the key lacks access.
    models: [
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash (Free tier)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Paid)" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (Paid)" },
    ],
  },
  {
    id: "openai", label: "OpenAI",
    docsUrl: "https://platform.openai.com/api-keys",
    usageUrl: "https://platform.openai.com/usage",
    recommended: false,
    infoTooltip: null,
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
  {
    id: "claude", label: "Anthropic Claude",
    docsUrl: "https://console.anthropic.com/settings/keys",
    usageUrl: "https://console.anthropic.com/settings/plans",
    recommended: false,
    infoTooltip: null,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    ],
  },
];

export default function SettingsPage() {
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();

  // ── API Key state ─────────────────────────────────────────────────────────
  const [apiKeyForm, setApiKeyForm] = useState({ key: "", provider: "mistral", model: "mistral-large-2512" });
  const [apiKeyInfo, setApiKeyInfo] = useState<{ has_key: boolean; provider: string | null } | null>(null);
  const [quotaHit, setQuotaHit] = useState<{ provider: string; usageUrl: string } | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [showNewApiKey, setShowNewApiKey] = useState(false);

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

  // ── Appearance state ──────────────────────────────────────────────────────
  const [fontSize, setFontSize] = useState<"normal" | "large">("normal");
  const [reduceAnimations, setReduceAnimations] = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [clearingChat, setClearingChat] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Load initial values ───────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
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
        const res = await fetch(`${API}/auth/check-username?username=${encodeURIComponent(form.username)}`);
        const data = await res.json();
        setUsernameAvailable(data.available);
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

    setSavingProfile(true);
    const body: any = {};
    if (form.fullName !== user?.full_name) body.full_name = form.fullName;
    if (form.username !== user?.username) body.username = form.username;
    if (form.email !== user?.email) body.email = form.email;
    if (form.newPassword) { body.current_password = form.currentPassword; body.new_password = form.newPassword; }

    try {
      const res = await fetch(`${API}/auth/update-profile`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Profile updated!", { icon: "✅" });
        setForm(f => ({ ...f, currentPassword: "", newPassword: "", confirmPassword: "" }));
        setTimeout(() => window.location.reload(), 800);
      } else {
        const err = await res.json();
        toast.error(err.detail || "Update failed");
      }
    } catch { toast.error("Update failed"); }
    setSavingProfile(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") { toast.error('Type DELETE to confirm'); return; }
    setDeletingAccount(true);
    try {
      const res = await fetch(`${API}/auth/delete-account`, {
        method: "DELETE", credentials: "include",
      });
      if (res.ok) {
        toast.success("Account deleted");
        await logout();
        router.push("/login");
      } else {
        const err = await res.json();
        toast.error(err.detail || "Deletion failed");
      }
    } catch { toast.error("Deletion failed"); }
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
    try {
      await fetch(`${API}/sessions/clear`, { method: "DELETE", credentials: "include" });
    } catch { /* endpoint may not exist yet — localStorage already cleared */ }
    toast.success("All session data cleared");
    setClearingSessions(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API}/profile`, { credentials: "include" });
      const profileData = await res.json();
      const questRes = await fetch(`${API}/daily-quests`, { credentials: "include" });
      const questData = await questRes.json();

      const exportObj = {
        exported_at: new Date().toISOString(),
        user: { username: user?.username, email: user?.email, full_name: user?.full_name },
        progress: profileData.progress,
        quests: questData.quests,
      };

      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coursemate_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported!");
    } catch { toast.error("Export failed"); }
    setExporting(false);
  };

  useEffect(() => {
    // Load quota hit from localStorage (set by Providers.tsx global handler)
    try {
      const stored = localStorage.getItem("cmai_quota_hit");
      if (stored) {
        const parsed = JSON.parse(stored);
        // Only show if hit within last 24h
        if (Date.now() - parsed.ts < 86_400_000) {
          setQuotaHit({ provider: parsed.provider, usageUrl: parsed.usageUrl });
        }
      }
    } catch (_) {}

    // Also react to live quota events fired during this session
    const onQuota = (e: Event) => {
      const { provider, usageUrl } = (e as CustomEvent).detail ?? {};
      setQuotaHit({ provider: provider || "", usageUrl: usageUrl || "" });
    };
    window.addEventListener("cmai:quota", onQuota);

    fetch(`${API}/auth/api-key`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setApiKeyInfo(d))
      .catch(() => {});

    return () => window.removeEventListener("cmai:quota", onQuota);
  }, []);

  async function handleSaveApiKey() {
    if (!apiKeyForm.key.trim()) { toast.error("Enter your API key"); return; }
    setApiKeyLoading(true);
    try {
      const res = await fetch(`${API}/auth/api-key`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKeyForm.key.trim(), llm_provider: apiKeyForm.provider, llm_model: apiKeyForm.model }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("API key updated!");
        setApiKeyInfo({ has_key: true, provider: apiKeyForm.provider });
        setApiKeyForm(f => ({ ...f, key: "" }));
        setShowApiKeyInput(false);
      } else {
        toast.error(data.detail || "Invalid API key — check and try again");
      }
    } catch { toast.error("Failed to update API key"); }
    setApiKeyLoading(false);
  }

  const handleProviderChange = (pid: string) => {
    const p = PROVIDERS_SETTINGS.find(x => x.id === pid)!;
    setApiKeyForm(f => ({ ...f, provider: pid, model: p.models[0].id }));
  };

  if (authLoading) return (
    <div className="flex h-screen items-center justify-center bg-bg-primary">
      <Loader2 size={32} className="animate-spin text-accent-gold" />
    </div>
  );
  if (!user) return null;

  const selectedSettingsProvider = PROVIDERS_SETTINGS.find(p => p.id === apiKeyForm.provider)!;

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => router.push("/")}
            className="p-2 hover:bg-bg-hover rounded-lg text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Settings</h1>
            <p className="text-xs text-text-muted">Manage your account and preferences</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">

        {/* ── ACCOUNT ──────────────────────────────────────────────────────── */}
        <Section title="Account">
          <form onSubmit={handleSaveProfile} className="space-y-5">

            <FieldRow label="Full Name">
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input type="text" value={form.fullName}
                  onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                  className="w-full pl-9 pr-4 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                  placeholder="Your name" />
              </div>
            </FieldRow>

            <FieldRow label="Username">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">@</span>
                <input type="text" value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full pl-7 pr-9 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                  placeholder="username" minLength={3} />
                {checkingUsername && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted" />}
                {!checkingUsername && usernameAvailable === true && <CheckCircle2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-accent-green" />}
                {!checkingUsername && usernameAvailable === false && <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400" />}
              </div>
              {usernameAvailable === false && <p className="text-xs text-red-400 mt-1">Username already taken</p>}
            </FieldRow>

            <FieldRow label="Email">
              <input type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-4 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                placeholder="you@example.com" />
            </FieldRow>

            {/* Divider */}
            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                <Lock size={12} /> Change Password
              </p>

              <div className="space-y-4">
                <FieldRow label="Current Password">
                  <div className="relative">
                    <input type={showCurrent ? "text" : "password"} value={form.currentPassword}
                      onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
                      className="w-full pl-4 pr-10 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                      placeholder="••••••••" />
                    <button type="button" onClick={() => setShowCurrent(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                      {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </FieldRow>

                <FieldRow label="New Password" hint="At least 8 characters">
                  <div className="relative">
                    <input type={showNew ? "text" : "password"} value={form.newPassword}
                      onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                      className="w-full pl-4 pr-10 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                      placeholder="••••••••" minLength={8} />
                    <button type="button" onClick={() => setShowNew(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                      {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </FieldRow>

                <FieldRow label="Confirm New Password">
                  <div className="relative">
                    <input type={showConfirm ? "text" : "password"} value={form.confirmPassword}
                      onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      className="w-full pl-4 pr-10 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
                      placeholder="••••••••" />
                    <button type="button" onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </FieldRow>
              </div>
            </div>

            <button type="submit" disabled={savingProfile || usernameAvailable === false}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-accent-gold to-accent-purple text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
              {savingProfile ? <><Loader2 size={16} className="animate-spin" />Saving...</> : <><Save size={16} />Save Changes</>}
            </button>
          </form>
        </Section>

        {/* ── AI PROVIDER ──────────────────────────────────────────────────── */}
        <Section title="AI Provider">
          <FieldRow label="Your API Key" hint="Your key is encrypted and never shared. Used for all AI features.">
            {quotaHit && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle size={14} className="text-red-400 shrink-0" />
                <span className="text-sm text-red-400">Quota limit reached</span>
                {quotaHit.usageUrl && (
                  <a
                    href={quotaHit.usageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-xs text-accent-gold hover:underline"
                  >
                    Check usage <ExternalLink size={10} />
                  </a>
                )}
                <button
                  onClick={() => { setQuotaHit(null); localStorage.removeItem("cmai_quota_hit"); }}
                  className="text-xs text-text-muted hover:text-text-primary ml-1"
                >✕</button>
              </div>
            )}

            {apiKeyInfo?.has_key ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-bg-primary border border-border rounded-lg">
                  <CheckCircle2 size={16} className="text-green-400" />
                  <span className="text-sm text-text-primary font-medium capitalize">{apiKeyInfo.provider}</span>
                  <span className="text-xs text-text-muted ml-auto">key saved</span>
                </div>
                <button onClick={() => setShowApiKeyInput(v => !v)}
                  className="px-3 py-2.5 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold text-sm transition-all">
                  Change
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-accent-red/5 border border-accent-red/30 rounded-lg">
                <span className="text-sm text-accent-red">⚠ No API key set — AI features are unavailable</span>
                <button onClick={() => setShowApiKeyInput(true)} className="ml-auto text-xs text-accent-gold hover:underline">Add key</button>
              </div>
            )}

            {showApiKeyInput && (
              <div className="mt-3 space-y-3 p-4 bg-bg-primary rounded-xl border border-border">
                {/* Provider buttons */}
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS_SETTINGS.map(p => (
                    <button key={p.id} type="button" onClick={() => handleProviderChange(p.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        apiKeyForm.provider === p.id
                          ? "border-accent-gold bg-accent-gold/10 text-accent-gold"
                          : "border-border text-text-muted hover:border-accent-gold/30"
                      }`}>
                      {apiKeyForm.provider === p.id && <CheckCircle2 size={11} className="shrink-0" />}
                      <span>{p.label}</span>
                      {/* Recommended badge */}
                      {p.recommended && (
                        <span className="ml-auto text-[9px] bg-accent-gold/20 text-accent-gold px-1 py-0.5 rounded font-semibold shrink-0">
                          REC
                        </span>
                      )}
                      {/* Gemini info icon */}
                      {p.infoTooltip && (
                        <span className="ml-auto relative group shrink-0">
                          <Info size={11} className="text-blue-400 cursor-help" />
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-36 text-center text-[10px] bg-bg-card border border-border text-text-muted px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                            {p.infoTooltip}
                          </span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Model selector — only shown if provider has multiple models */}
                {selectedSettingsProvider.models.length > 1 && (
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1.5">Model</label>
                    <select value={apiKeyForm.model} onChange={e => setApiKeyForm(f => ({ ...f, model: e.target.value }))}
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent-gold transition-all">
                      {selectedSettingsProvider.models.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="relative">
                  <input type={showNewApiKey ? "text" : "password"}
                    value={apiKeyForm.key} onChange={e => setApiKeyForm(f => ({ ...f, key: e.target.value }))}
                    placeholder="Paste your API key..."
                    className="w-full px-4 py-2.5 pr-10 bg-bg-card border border-border rounded-lg text-text-primary font-mono text-sm focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all" />
                  <button type="button" onClick={() => setShowNewApiKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                    {showNewApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <a href={selectedSettingsProvider.docsUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-text-muted hover:text-accent-gold flex items-center gap-1 transition-colors">
                    <ExternalLink size={11} /> Get {selectedSettingsProvider.label} key
                  </a>
                  <button onClick={handleSaveApiKey} disabled={apiKeyLoading || !apiKeyForm.key.trim()}
                    className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-accent-gold to-accent-purple text-black text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-all">
                    {apiKeyLoading ? <><Loader2 size={14} className="animate-spin" /> Validating...</> : <><Key size={14} /> Save Key</>}
                  </button>
                </div>
              </div>
            )}
          </FieldRow>
        </Section>

        <Section title="Appearance">
          <FieldRow label="Font Size">
            <div className="flex gap-2 mt-1">
              {(["normal", "large"] as const).map(size => (
                <button key={size} onClick={() => setFontSize(size)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all capitalize ${fontSize === size ? "border-accent-gold bg-accent-gold/10 text-accent-gold" : "border-border text-text-muted hover:border-border-subtle hover:text-text-primary"}`}>
                  <Type size={14} className="inline mr-1.5" />{size}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Reduce Animations" hint="Disables pixel sparkles, screen shakes, and transitions">
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-text-secondary flex items-center gap-2">
                <Zap size={14} className="text-accent-gold" />
                {reduceAnimations ? "Animations disabled" : "Animations enabled"}
              </span>
              <button onClick={() => setReduceAnimations(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors ${reduceAnimations ? "bg-accent-gold" : "bg-bg-hover border border-border"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${reduceAnimations ? "translate-x-5" : ""}`} />
              </button>
            </div>
          </FieldRow>

          <button onClick={handleAppearanceSave}
            className="w-full py-2.5 rounded-xl bg-bg-secondary border border-border text-sm font-medium text-text-primary hover:border-accent-gold/50 hover:text-accent-gold transition-all flex items-center justify-center gap-2">
            <Save size={15} />Apply Appearance
          </button>
        </Section>

        {/* ── DATA & PRIVACY ────────────────────────────────────────────────── */}
        <Section title="Data & Privacy">
          <div className="space-y-3">

            <div className="flex items-center justify-between p-4 bg-bg-secondary/50 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium text-text-primary">Clear Chat History</p>
                <p className="text-xs text-text-muted mt-0.5">Removes all saved chat sessions from this device</p>
              </div>
              <button onClick={handleClearChatHistory} disabled={clearingChat}
                className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:border-red-500/40 hover:text-red-400 transition-all disabled:opacity-40 flex items-center gap-2 shrink-0">
                {clearingChat ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                Clear
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-bg-secondary/50 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium text-text-primary">Clear All Session Data</p>
                <p className="text-xs text-text-muted mt-0.5">Removes uploaded PDFs, quizzes, notes, and arena data</p>
              </div>
              <button onClick={handleClearAllSessions} disabled={clearingSessions}
                className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:border-red-500/40 hover:text-red-400 transition-all disabled:opacity-40 flex items-center gap-2 shrink-0">
                {clearingSessions ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Clear
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-bg-secondary/50 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium text-text-primary">Export My Data</p>
                <p className="text-xs text-text-muted mt-0.5">Download your XP, coins, level, and quest history as JSON</p>
              </div>
              <button onClick={handleExport} disabled={exporting}
                className="px-4 py-2 rounded-lg border border-accent-blue/40 text-sm text-accent-blue hover:bg-accent-blue/10 transition-all disabled:opacity-40 flex items-center gap-2 shrink-0">
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </button>
            </div>

          </div>
        </Section>

        {/* ── DELETE ACCOUNT ────────────────────────────────────────────────── */}
        <Section title="Danger Zone">
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-400">Delete Account</p>
                <p className="text-xs text-text-muted mt-1">This permanently deletes your account, XP, coins, and all progress. This cannot be undone.</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-2">Type <span className="font-mono text-red-400">DELETE</span> to confirm</p>
              <input type="text" value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 bg-bg-primary border border-red-500/30 rounded-lg text-sm text-text-primary focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 transition-all font-mono mb-3" />
              <button onClick={handleDeleteAccount}
                disabled={deletingAccount || deleteConfirm !== "DELETE"}
                className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                {deletingAccount ? <><Loader2 size={16} className="animate-spin" />Deleting...</> : <><Trash2 size={16} />Delete My Account</>}
              </button>
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
}