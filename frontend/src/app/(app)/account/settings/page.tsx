"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import {
  User, Lock, Trash2, Loader2, Save,
  Eye, EyeOff, CheckCircle2, XCircle,
  Type, Zap, Database, Download, AlertTriangle, Key,
} from "lucide-react";
import { Button, Card, Checkbox, Input } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { parseApiError, rawApi, type ApiKeyInfo } from "@/lib/api";
import { loadMetadata, deleteSession } from "@/lib/sessions";
import ProviderPicker from "@/components/ProviderPicker";
import { ROUTES } from "@/lib/routes";
import {
  emptyLLMForm, formForProvider, llmPayload, useProviders, validateLLMForm,
  type LLMForm,
} from "@/lib/llmProviders";


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
const SECTIONS = ["Account", "AI Provider", "Appearance", "Data & Privacy", "Danger Zone"];
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

  // ── API Key state ─────────────────────────────────────────────────────────
  const { providers, loading: providersLoading, error: providersError, reload: reloadProviders } = useProviders();
  const [llm, setLlm] = useState<LLMForm>(emptyLLMForm);
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

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

    setSavingProfile(true);
    const body: any = {};
    if (form.fullName !== user?.full_name) body.full_name = form.fullName;
    if (form.username !== user?.username) body.username = form.username;
    if (form.email !== user?.email) body.email = form.email;
    if (form.newPassword) { body.current_password = form.currentPassword; body.new_password = form.newPassword; }

    try {
      const { error: err, response } = await rawApi.POST("/auth/update-profile", { body });
      if (response.ok) {
        toast.success("Profile updated!", { icon: "✅" });
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
    setDeletingAccount(true);
    try {
      const { error: err, response } = await rawApi.DELETE("/auth/delete-account");
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

  const handleExport = async () => {
    setExporting(true);
    try {
      const profile = await rawApi.GET("/profile");
      if (!profile.response.ok) throw parseApiError(profile.response.status, profile.error);
      const quests = await rawApi.GET("/daily-quests");
      if (!quests.response.ok) throw parseApiError(quests.response.status, quests.error);
      const profileData: any = profile.data;
      const questData: any = quests.data;

      const exportObj = {
        exported_at: new Date().toISOString(),
        user: { username: user?.username, email: user?.email, full_name: user?.full_name },
        progress: profileData?.progress,
        quests: questData?.quests,
      };

      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coursemate_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported!");
    } catch (e) { toast.apiError(e, { onRetry: handleExport }); }
    setExporting(false);
  };

  useEffect(() => {
    rawApi.GET("/auth/api-key")
      .then(({ data }) => { if (data) setApiKeyInfo(data); })
      .catch(() => {});
  }, []);

  const selectedSettingsProvider = providers.find(p => p.id === llm.provider);

  // Open the editor pre-filled with the current provider (or the first one for new/legacy accounts).
  function openProviderEditor() {
    const current = providers.find(p => p.id === apiKeyInfo?.provider) ?? providers[0];
    if (current) {
      const base = formForProvider(current);
      const savedModel = apiKeyInfo?.provider === current.id ? apiKeyInfo?.model : null;
      const isCurated = !!savedModel && current.models.some(m => m.id === savedModel);
      setLlm({
        ...base,
        model: savedModel || base.model,
        custom: savedModel ? !isCurated : base.custom,
        baseUrl: (apiKeyInfo?.provider === current.id && apiKeyInfo?.base_url) || base.baseUrl,
      });
    }
    setShowApiKeyInput(true);
  }

  async function handleSaveApiKey() {
    const problem = validateLLMForm(llm, selectedSettingsProvider);
    if (problem || !selectedSettingsProvider) { toast.error(problem || "Choose a provider"); return; }
    setApiKeyLoading(true);
    try {
      const { data, error, response } = await rawApi.PUT("/auth/api-key", {
        body: llmPayload(llm, selectedSettingsProvider),
      });
      if (response.ok && data?.success) {
        toast.success("AI provider updated!");
        const fresh = await rawApi.GET("/auth/api-key").then(({ data }) => data).catch(() => null);
        setApiKeyInfo(fresh ?? { has_key: true, provider: llm.provider });
        setLlm(f => ({ ...f, apiKey: "" }));
        setShowApiKeyInput(false);
      } else {
        toast.apiError(parseApiError(response.status, error), { without: ["settings"] });
      }
    } catch (e) { toast.apiError(e, { onRetry: handleSaveApiKey }); }
    setApiKeyLoading(false);
  }

  if (authLoading) return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Loader2 size={32} className="ui-spinner text-ink-gold" aria-label="Loading" />
    </div>
  );
  if (!user) return null;

  return (
    <div>
      <div className="max-w-5xl mx-auto px-6 pt-6">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Settings</h1>
        <p className="text-sm text-fg-muted">Manage your account and preferences</p>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 settings-grid">
      <nav aria-label="Settings sections" className="settings-rail">
        {SECTIONS.map((t) => <a key={t} href={`#${slug(t)}`}>{t}</a>)}
      </nav>
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
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-4 flex items-center gap-2">
                <Lock size={12} /> Change Password
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

        {/* ── AI PROVIDER ──────────────────────────────────────────────────── */}
        <Section title="AI Provider">
          <FieldRow label="Your API Key" hint="Your key is encrypted and never shared. Used for all AI features.">
            {apiKeyInfo?.has_key ? (
              <div className="flex items-center gap-3">
                <Card surface="inset" pad="sm" className="flex-1 flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={16} className="text-ink-green shrink-0" />
                  <span className="text-sm text-fg font-medium">{apiKeyInfo.provider_label || apiKeyInfo.provider}</span>
                  {apiKeyInfo.model && <span className="text-xs text-fg-muted font-mono truncate">{apiKeyInfo.model}</span>}
                  <span className="text-xs text-fg-muted ml-auto shrink-0">saved</span>
                </Card>
                <Button onClick={() => (showApiKeyInput ? setShowApiKeyInput(false) : openProviderEditor())}>
                  Change
                </Button>
              </div>
            ) : (
              <Card tone="danger" pad="sm" className="flex items-center gap-2">
                <span className="text-sm text-ink-red">⚠ No API key set — AI features are unavailable</span>
                <Button variant="link" className="ml-auto text-xs" onClick={openProviderEditor}>Add key</Button>
              </Card>
            )}

            {apiKeyInfo?.has_key && apiKeyInfo.provider_supported === false && (
              <Card tone="warning" pad="sm" className="mt-3 flex items-start gap-2 text-sm">
                <AlertTriangle size={16} className="text-ink-gold shrink-0 mt-0.5" />
                <div className="text-fg">
                  Your saved provider (<span className="font-mono">{apiKeyInfo.provider}</span>) is no longer supported,
                  so AI features are paused.{" "}
                  <Button variant="link" onClick={openProviderEditor}>Choose a new provider</Button>
                </div>
              </Card>
            )}

            {showApiKeyInput && (
              <Card surface="inset" pad="lg" className="mt-3 space-y-3">
                <ProviderPicker
                  providers={providers}
                  loading={providersLoading}
                  error={providersError}
                  onRetry={reloadProviders}
                  value={llm}
                  onChange={setLlm}
                  onInset
                />
                <div className="flex items-center gap-2">
                  <Button variant="primary" className="ml-auto" onClick={handleSaveApiKey}
                    loading={apiKeyLoading} disabled={!!validateLLMForm(llm, selectedSettingsProvider)}>
                    {apiKeyLoading ? "Checking..." : <><Key size={14} /> Save</>}
                  </Button>
                </div>
              </Card>
            )}
          </FieldRow>
        </Section>

        <Section title="Appearance">
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

          <Button block onClick={handleAppearanceSave}>
            <Save size={15} />Apply Appearance
          </Button>
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
                <p className="text-sm font-medium text-fg">Clear All Session Data</p>
                <p className="text-xs text-fg-muted mt-0.5">Removes uploaded PDFs, quizzes, notes, and arena data</p>
              </div>
              <Button onClick={handleClearAllSessions} loading={clearingSessions} className="shrink-0">
                <Trash2 size={14} />Clear
              </Button>
            </Card>

            <Card surface="inset" pad="lg" className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-fg">Export My Data</p>
                <p className="text-xs text-fg-muted mt-0.5">Download your XP, coins, level, and quest history as JSON</p>
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
            <Button variant="danger" block onClick={handleDeleteAccount}
              loading={deletingAccount} disabled={deleteConfirm !== "DELETE"}>
              {deletingAccount ? "Deleting..." : <><Trash2 size={16} />Delete My Account</>}
            </Button>
          </Card>
        </Section>

      </div>
      </div>
    </div>
  );
}
