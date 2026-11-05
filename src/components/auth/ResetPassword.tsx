"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { requestPasswordReset, resetPassword } from "@/lib/auth/authApi";
import CodeField from "./CodeField";

/** Forgot password: email -> a 6-digit code -> a new password. */
export default function ResetPassword({ initialEmail = "", onDone, onCancel }: {
  initialEmail?: string;
  onDone: (email: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [stage, setStage] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError({ field: "email", message: "Enter your email" }); return; }
    setBusy(true);
    setError(null);
    const r = await requestPasswordReset(email);
    setBusy(false);
    if (r.ok) setStage("code");
    else setError({ message: r.failure.message });
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError({ field: "code", message: "Enter the 6-digit code from the email" }); return; }
    if (password.length < 8) { setError({ field: "password", message: "Password must be at least 8 characters" }); return; }
    setBusy(true);
    setError(null);
    const r = await resetPassword(email, code, password);
    setBusy(false);
    if (r.ok) onDone(email.trim());
    else setError({ field: r.failure.field === "code" ? "code" : undefined, message: r.failure.message });
  }

  return (
    <form onSubmit={stage === "email" ? ask : reset} noValidate className="space-y-4">
      <h3 data-step-heading tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-fg outline-none">
        <KeyRound size={16} className="text-ink-blue" aria-hidden="true" /> Reset your password
      </h3>
      {stage === "email" ? (
        <>
          <p className="text-sm text-fg-2">We&apos;ll email you a 6-digit code to choose a new password.</p>
          <Input label="Email" type="email" name="email" value={email} autoComplete="email" autoFocus
            onChange={(e) => { setEmail(e.currentTarget.value); setError(null); }}
            error={error?.field === "email" ? error.message : undefined} />
        </>
      ) : (
        <>
          <p className="text-sm text-fg-2" role="status">If {email.trim()} has an account, a code is on its way.</p>
          <CodeField value={code} onChange={(v) => { setCode(v); setError(null); }} error={error?.field === "code" ? error.message : undefined} />
          <Input label="New password" type={show ? "text" : "password"} name="password" value={password} autoComplete="new-password"
            hint="At least 8 characters" error={error?.field === "password" ? error.message : undefined}
            onChange={(e) => { setPassword(e.currentTarget.value); setError(null); }}
            trailing={
              <Button variant="ghost" size="sm" icon onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            } />
        </>
      )}
      {error && !error.field && <Card tone="danger" pad="sm" role="alert"><p className="text-sm text-ink-red">{error.message}</p></Card>}
      <Button type="submit" variant="primary" block loading={busy}>{stage === "email" ? "Email me a code" : "Set the new password"}</Button>
      <div className="flex justify-center gap-3">
        {stage === "code" && <Button variant="ghost" size="sm" onClick={() => void ask()} disabled={busy}>Send a new code</Button>}
        <Button variant="ghost" size="sm" onClick={onCancel}>Back to log in</Button>
      </div>
    </form>
  );
}
