"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Checkbox } from "@/components/ui";
import { sendTwoFactorCode, verifyTwoFactor, type TwoFactorMethod } from "@/lib/auth/authApi";
import CodeField from "./CodeField";

/** The second step of signing in: a code from the authenticator app, an emailed code, or a backup code. */
export default function TwoFactorStep({ onDone, onCancel }: { onDone: () => void | Promise<void>; onCancel: () => void }) {
  const [method, setMethod] = useState<TwoFactorMethod>("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function use(next: TwoFactorMethod) {
    setMethod(next);
    setCode("");
    setError("");
    setNote("");
  }

  async function emailMe() {
    use("otp");
    setBusy(true);
    const r = await sendTwoFactorCode();
    setBusy(false);
    if (r.ok) setNote("We emailed you a 6-digit code.");
    else setError(r.failure.message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { setError("Enter the code"); return; }
    setBusy(true);
    setError("");
    const r = await verifyTwoFactor(method, code, trust);
    setBusy(false);
    if (r.ok) await onDone();
    else setError(r.failure.message);
  }

  const label = method === "totp" ? "Code from your authenticator app" : method === "otp" ? "Code from the email" : "Backup code";
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <h3 data-step-heading tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-fg outline-none">
        <ShieldCheck size={16} className="text-ink-blue" aria-hidden="true" /> Two-step sign-in
      </h3>
      {note && <p className="text-sm text-fg-2" role="status">{note}</p>}
      <CodeField label={label} value={code} onChange={(v) => { setCode(v); setError(""); }} error={error || undefined} long={method === "backup"} />
      <Checkbox label="Trust this device for 30 days" checked={trust} onChange={(e) => setTrust(e.currentTarget.checked)} />
      <Button type="submit" variant="primary" block loading={busy}>Continue</Button>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {method !== "totp" && <Button variant="ghost" size="sm" onClick={() => use("totp")}>Use the authenticator app</Button>}
        {method !== "otp" && <Button variant="ghost" size="sm" onClick={() => void emailMe()} disabled={busy}>Email me a code</Button>}
        {method !== "backup" && <Button variant="ghost" size="sm" onClick={() => use("backup")}>Use a backup code</Button>}
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
