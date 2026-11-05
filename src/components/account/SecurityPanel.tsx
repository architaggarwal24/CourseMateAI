"use client";

// Account -> Security (Stage 4.1): verify the email, and two-step sign-in (an authenticator app, with backup codes;
// an emailed code works as the second step too once emails go out).
import { useState } from "react";
import { encode } from "uqr";
import { CheckCircle2, ShieldCheck } from "@/components/icons";
import { Badge, Button, Card, Input, toast } from "@/components/ui";
import VerifyEmailStep from "@/components/auth/VerifyEmailStep";
import CodeField from "@/components/auth/CodeField";
import { useAuth } from "@/contexts/AuthContext";
import { disableTwoFactor, enableTwoFactor, verifyTwoFactor } from "@/lib/auth/authApi";

/** The otpauth:// link as a QR code, drawn as SVG squares (no image, no network). */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { border: 2 });
  const path = data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width={192} height={192} shapeRendering="crispEdges"
      className="rounded-md bg-white p-1">
      <path d={path} fill="#000" />
    </svg>
  );
}

function TwoStep() {
  const { user, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; backup: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const on = !!user?.two_factor_enabled;

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!password) { setError("Enter your password"); return; }
    setBusy(true);
    setError("");
    const r = await enableTwoFactor(password);
    setBusy(false);
    if (r.ok) { setSetup({ uri: r.data.totpURI, backup: r.data.backupCodes }); setPassword(""); }
    else setError(r.failure.message);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("Enter the 6-digit code from the app"); return; }
    setBusy(true);
    setError("");
    const r = await verifyTwoFactor("totp", code);
    setBusy(false);
    if (r.ok) { setSetup(null); setCode(""); toast.success("Two-step sign-in is on"); await refresh(); }
    else setError(r.failure.message);
  }

  async function turnOff(e: React.FormEvent) {
    e.preventDefault();
    if (!password) { setError("Enter your password"); return; }
    setBusy(true);
    setError("");
    const r = await disableTwoFactor(password);
    setBusy(false);
    if (r.ok) { setPassword(""); toast.success("Two-step sign-in is off"); await refresh(); }
    else setError(r.failure.message);
  }

  if (!user?.has_password) {
    return <p className="text-sm text-fg-2">Your account signs in with Google, so Google&apos;s own two-step sign-in protects it.</p>;
  }
  if (setup) {
    return (
      <form onSubmit={confirm} noValidate className="space-y-4">
        <ol className="list-decimal pl-5 space-y-3 text-sm text-fg-2">
          <li>
            Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 2FAS...), or on this phone
            {" "}<a className="text-ink-blue underline" href={setup.uri}>open it in the app</a>.
            <div className="mt-3"><QrCode text={setup.uri} label="QR code for your authenticator app" /></div>
          </li>
          <li>
            Keep these backup codes somewhere safe. Each one signs you in once if you lose your phone.
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-fg list-none p-0" aria-label="Backup codes">
              {setup.backup.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </li>
          <li>Enter the 6-digit code the app shows now.</li>
        </ol>
        <CodeField value={code} onChange={(v) => { setCode(v); setError(""); }} error={error || undefined} autoFocus={false} />
        <div className="flex gap-3">
          <Button type="submit" variant="primary" loading={busy}>Turn on</Button>
          <Button variant="ghost" onClick={() => { setSetup(null); setError(""); }}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={on ? turnOff : start} noValidate className="space-y-4">
      <p className="text-sm text-fg-2">
        {on ? "On: signing in asks for a code from your authenticator app (or a backup code) after your password."
            : "Off. Turn it on and signing in also asks for a code from an app on your phone."}
      </p>
      <Input label="Your password" type="password" autoComplete="current-password" value={password}
        error={error || undefined} onChange={(e) => { setPassword(e.currentTarget.value); setError(""); }} />
      <Button type="submit" variant={on ? "danger" : "primary"} loading={busy}>{on ? "Turn off two-step sign-in" : "Set up two-step sign-in"}</Button>
    </form>
  );
}

export default function SecurityPanel() {
  const { user, refresh } = useAuth();
  const [verifying, setVerifying] = useState(false);
  if (!user) return null;
  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Security</h1>
        <p className="text-sm text-fg-muted">Your email and two-step sign-in</p>
      </div>
      <Card title="Email" className="settings-section">
        <p className="text-sm text-fg flex flex-wrap items-center gap-2">
          {user.email}
          {user.email_verified
            ? <Badge tone="success"><CheckCircle2 size={11} aria-hidden="true" /> Verified</Badge>
            : <Badge tone="warning">Not verified</Badge>}
        </p>
        {!user.email_verified && (
          verifying
            ? <div className="mt-4"><VerifyEmailStep email={user.email} sent={false} onVerified={async () => { await refresh(); setVerifying(false); toast.success("Email verified"); }} /></div>
            : <Button className="mt-4" onClick={() => setVerifying(true)}>Verify my email</Button>
        )}
      </Card>
      <Card title={<span className="inline-flex items-center gap-2"><ShieldCheck size={16} aria-hidden="true" />Two-step sign-in</span>} className="settings-section">
        <TwoStep />
      </Card>
    </div>
  );
}
