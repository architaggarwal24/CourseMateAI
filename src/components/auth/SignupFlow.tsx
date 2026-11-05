"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff } from "@/components/icons";
import { Button, Card, Input, toast } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { parseApiError, rawApi } from "@/lib/api";
import { fetchAuthConfig } from "@/lib/auth/config";
import {
  ACCOUNT_FIELDS, emptyAccountForm, fieldForFailure, validateAccount, validateField,
  type AccountErrors, type AccountField, type AccountForm,
} from "@/lib/signup";
import VerifyEmailStep from "./VerifyEmailStep";

const STEPS = ["Account", "Verify email"] as const;

type UsernameCheck = { status: "idle" } | { status: "checking" | "available" | "taken"; name: string };

/**
 * Sign-up (Stage 4.1). Step 1: the account (name, username, email, password, an optional invite code), checked as you
 * type with the server's own rules and the username-availability check. Step 2, when this server sends emails: the
 * 6-digit code that confirms the address (and signs you in). An invite code is redeemed once you are signed in.
 * A refusal lands beside its field (a taken email or username) or as a message on the step.
 */
export default function SignupFlow({ onDone }: { onDone: () => void }) {
  const { register, refresh } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [account, setAccount] = useState<AccountForm>(emptyAccountForm);
  const [touched, setTouched] = useState<Partial<Record<AccountField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<AccountErrors>({});
  const [general, setGeneral] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheck>({ status: "idle" });
  const [focusTick, setFocusTick] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [emailsGoOut, setEmailsGoOut] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAuthConfig().then((c) => { if (alive) setEmailsGoOut(c.verification_required); });
    return () => { alive = false; };
  }, []);

  const username = account.username.trim();
  const usernameWellFormed = validateField("username", account) === null;
  useEffect(() => {
    if (!usernameWellFormed) { setUsernameCheck({ status: "idle" }); return; }
    let cancelled = false;
    setUsernameCheck({ status: "checking", name: username });
    const timer = setTimeout(async () => {
      try {
        const { data } = await rawApi.GET("/auth/check-username", { params: { query: { username } } });
        if (cancelled || !data) return;
        setUsernameCheck(data.available ? { status: "available", name: username } : data.reason ? { status: "idle" } : { status: "taken", name: username });
      } catch {
        if (!cancelled) setUsernameCheck({ status: "idle" });      // offline: the server still decides on submit
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [username, usernameWellFormed]);

  useEffect(() => {
    if (focusTick === 0) return;
    const bad = panelRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
    (bad ?? panelRef.current?.querySelector<HTMLElement>("[data-step-heading]"))?.focus();
  }, [focusTick]);

  const takenHere = usernameCheck.status === "taken" && usernameCheck.name === username;
  const errorFor = (field: AccountField): string | undefined => {
    if (serverErrors[field]) return serverErrors[field];
    if (field === "username" && takenHere) return "That username is already taken";
    if (!touched[field]) return undefined;
    return validateField(field, account) ?? undefined;
  };

  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const field = e.currentTarget.name as AccountField;
    const value = e.currentTarget.value;
    setAccount((prev) => ({ ...prev, [field]: value }));
    setServerErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    setGeneral("");
  };
  const blur = (e: React.FocusEvent<HTMLInputElement>) => {
    const field = e.currentTarget.name;
    setTouched((t) => ({ ...t, [field]: true }));
  };

  /** Signed in: use the invite code (if any), then go in. */
  async function finish() {
    const code = account.inviteCode.trim();
    if (code) {
      try {
        const { error, response } = await rawApi.POST("/account/redeem", { body: { code } });
        if (response.ok) toast.success("Invite code used: your plan is upgraded.");
        else toast.apiError(parseApiError(response.status, error, "That invite code didn't work"));
      } catch { /* the code can be used later from Account -> Plan & usage */ }
    }
    onDone();
  }

  async function submit() {
    const all = Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f, true])) as Record<AccountField, boolean>;
    setTouched(all);
    setGeneral("");
    const problems = validateAccount(account);
    if (Object.keys(problems).length > 0 || takenHere || Object.values(serverErrors).some(Boolean)) {
      setFocusTick((n) => n + 1);
      return;
    }
    setLoading(true);
    const result = await register({
      email: account.email.trim(), password: account.password, username: account.username.trim(), fullName: account.fullName.trim(),
    });
    setLoading(false);
    if (result.ok) {
      if (result.signedIn) { await finish(); return; }
      setStep(2);
      setFocusTick((n) => n + 1);
      return;
    }
    const field = fieldForFailure(result.failure);
    if (field) setServerErrors({ [field]: result.failure.message });
    else setGeneral(result.failure.message);
    setFocusTick((n) => n + 1);
  }

  const toggle = (shown: boolean, set: (v: boolean) => void, label: string) => (
    <Button variant="ghost" size="sm" icon onClick={() => set(!shown)} aria-label={shown ? `Hide ${label}` : `Show ${label}`}>
      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
    </Button>
  );

  const steps = emailsGoOut ? STEPS : STEPS.slice(0, 1);
  return (
    <div className="space-y-4">
      {steps.length > 1 && (
        <div>
          <ol aria-label="Sign-up progress" className="flex gap-2 list-none p-0 m-0">
            {steps.map((label, i) => {
              const n = i + 1;
              const state = n < step ? "done" : n === step ? "current" : "todo";
              return (
                <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex-1">
                  <div className={`h-1 rounded-full ${state === "todo" ? "bg-line" : "bg-accent-blue"}`} aria-hidden="true" />
                  <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${state === "todo" ? "text-fg-muted" : "text-fg"}`}>
                    {state === "done" ? <Check size={12} aria-hidden="true" /> : <span aria-hidden="true">{n}</span>}
                    <span>{label}</span>
                    {state === "done" && <span className="sr-only"> (done)</span>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="sr-only" aria-live="polite">Step {step} of {steps.length}: {steps[step - 1]}</p>
        </div>
      )}

      <div ref={panelRef} className="space-y-4">
        {step === 1 ? (
          <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
            <h3 data-step-heading tabIndex={-1} className="text-base font-semibold text-fg outline-none">Your account</h3>

            <Input label="Full Name" type="text" name="fullName" value={account.fullName} onChange={change} onBlur={blur}
              placeholder="John Doe" autoComplete="name" error={errorFor("fullName")} />

            <Input label="Username" type="text" name="username" value={account.username} onChange={change} onBlur={blur}
              placeholder="johndoe" autoComplete="username" spellCheck={false} error={errorFor("username")}
              hint={
                usernameCheck.status === "checking" && usernameWellFormed ? "Checking availability…"
                : usernameCheck.status === "available" && usernameCheck.name === username && !errorFor("username") ? "✓ Username is available"
                : "3–32 characters: letters, numbers, _ - and ."
              } />

            <Input label="Email" type="email" name="email" value={account.email} onChange={change} onBlur={blur}
              placeholder="you@example.com" autoComplete="email" error={errorFor("email")} />

            <Input label="Password" type={showPassword ? "text" : "password"} name="password" value={account.password}
              onChange={change} onBlur={blur} placeholder="••••••••" autoComplete="new-password"
              error={errorFor("password")} hint="At least 8 characters"
              trailing={toggle(showPassword, setShowPassword, "password")} />

            <Input label="Confirm Password" type={showConfirm ? "text" : "password"} name="confirmPassword"
              value={account.confirmPassword} onChange={change} onBlur={blur} placeholder="••••••••" autoComplete="new-password"
              error={errorFor("confirmPassword")}
              trailing={toggle(showConfirm, setShowConfirm, "password")} />

            <Input label="Invite code (optional)" type="text" name="inviteCode"
              value={account.inviteCode} onChange={change} onBlur={blur} placeholder="BETA-XXXX" autoComplete="off"
              spellCheck={false} hint="A code from the team puts you on its plan." />

            {general && (
              <Card tone="danger" pad="sm" role="alert">
                <p className="text-sm text-ink-red">{general}</p>
              </Card>
            )}

            <Button type="submit" variant="primary" block loading={loading}>
              {loading ? "Creating your account…" : "Create account"}
            </Button>
          </form>
        ) : (
          <VerifyEmailStep email={account.email.trim()} onVerified={async () => { await refresh(); await finish(); }} />
        )}
      </div>
    </div>
  );
}
