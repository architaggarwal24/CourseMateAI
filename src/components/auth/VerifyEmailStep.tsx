"use client";

import { useState } from "react";
import { MailCheck } from "@/components/icons";
import { Button, Card } from "@/components/ui";
import { sendVerificationCode, verifyEmail } from "@/lib/auth/authApi";
import CodeField from "./CodeField";

/**
 * "We emailed you a code": enter it to confirm the address (and be signed in). `sent` says whether a code is already
 * on its way (sign-up sends one); otherwise the first button sends it.
 */
export default function VerifyEmailStep({ email, sent = true, onVerified, onSkip }: {
  email: string;
  sent?: boolean;
  onVerified: () => void | Promise<void>;
  /** Shown when the server doesn't insist on a verified email. */
  onSkip?: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState(sent ? `We sent a 6-digit code to ${email}.` : "");
  const [busy, setBusy] = useState(false);
  const [hasCode, setHasCode] = useState(sent);

  async function send() {
    setBusy(true);
    setError("");
    const r = await sendVerificationCode(email);
    setBusy(false);
    if (r.ok) { setHasCode(true); setNote(`We sent a new code to ${email}. It works for 10 minutes.`); }
    else setError(r.failure.message);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("Enter the 6-digit code from the email"); return; }
    setBusy(true);
    setError("");
    const r = await verifyEmail(email, code);
    setBusy(false);
    if (r.ok) await onVerified();
    else setError(r.failure.message);
  }

  return (
    <form onSubmit={verify} noValidate className="space-y-4">
      <h3 data-step-heading tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-fg outline-none">
        <MailCheck size={16} className="text-ink-blue" aria-hidden="true" /> Verify your email
      </h3>
      {note && <p className="text-sm text-fg-2" role="status">{note}</p>}
      {hasCode && <CodeField value={code} onChange={(v) => { setCode(v); setError(""); }} error={error || undefined} />}
      {!hasCode && error && <Card tone="danger" pad="sm" role="alert"><p className="text-sm text-ink-red">{error}</p></Card>}
      <div className="flex flex-wrap gap-3">
        {hasCode && <Button type="submit" variant="primary" loading={busy}>Verify</Button>}
        <Button variant={hasCode ? "ghost" : "primary"} onClick={() => void send()} disabled={busy}>
          {hasCode ? "Send a new code" : "Send me a code"}
        </Button>
        {onSkip && <Button variant="ghost" onClick={onSkip} disabled={busy}>Later</Button>}
      </div>
    </form>
  );
}
