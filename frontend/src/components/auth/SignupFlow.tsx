"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Key } from "lucide-react";
import ProviderPicker, { type ProviderFieldErrors } from "@/components/ProviderPicker";
import { Button, Card, Input } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { rawApi } from "@/lib/api";
import { emptyLLMForm, formForProvider, llmPayload, useProviders, type LLMForm } from "@/lib/llmProviders";
import {
  ACCOUNT_FIELDS, WHY_A_KEY, emptyAccountForm, routeSignupFailure, validateAccount, validateField, validateProviderStep,
  type AccountErrors, type AccountField, type AccountForm,
} from "@/lib/signup";

const STEPS = ["Account", "AI provider"] as const;

type UsernameCheck = { status: "idle" } | { status: "checking" | "available" | "taken"; name: string };

/**
 * Sign-up in two steps - what is collected is unchanged. Step 1: the account (name, username, email, password), checked
 * as you type with the backend's own rules and the username-availability check. Step 2: the AI provider (ProviderPicker).
 * Everything lives in this component, so Back and Next keep what was typed. A failed registration lands on the step its
 * error belongs to, beside the field (error.details.field): a failed provider check is always back on step 2.
 */
export default function SignupFlow({ onDone }: { onDone: () => void }) {
  const { register } = useAuth();
  const { providers, loading: providersLoading, error: providersError, reload } = useProviders();

  const [step, setStep] = useState<1 | 2>(1);
  const [account, setAccount] = useState<AccountForm>(emptyAccountForm);
  const [llm, setLlm] = useState<LLMForm>(emptyLLMForm);
  const [touched, setTouched] = useState<Partial<Record<AccountField, boolean>>>({});
  const [serverAccountErrors, setServerAccountErrors] = useState<AccountErrors>({});
  const [providerErrors, setProviderErrors] = useState<ProviderFieldErrors>({});
  const [general, setGeneral] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheck>({ status: "idle" });
  const [focusTick, setFocusTick] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Preselect the first provider (Gemini — free) once the catalogue arrives.
  useEffect(() => {
    if (!llm.provider && providers.length > 0) setLlm(formForProvider(providers[0]));
  }, [providers, llm.provider]);
  const spec = providers.find((p) => p.id === llm.provider);

  // The existing availability check (GET /auth/check-username), once the username is well-formed.
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

  // Move focus to the first problem (or the step's heading) after a step change or a failed attempt.
  useEffect(() => {
    if (focusTick === 0) return;
    const bad = panelRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
    (bad ?? panelRef.current?.querySelector<HTMLElement>("[data-step-heading]"))?.focus();
  }, [focusTick]);

  const takenHere = usernameCheck.status === "taken" && usernameCheck.name === username;
  const errorFor = (field: AccountField): string | undefined => {
    if (serverAccountErrors[field]) return serverAccountErrors[field];
    if (field === "username" && takenHere) return "That username is already taken";      // worth saying as soon as it is known
    if (!touched[field]) return undefined;
    return validateField(field, account) ?? undefined;
  };

  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const field = e.currentTarget.name as AccountField;
    const value = e.currentTarget.value;
    setAccount((prev) => ({ ...prev, [field]: value }));
    setServerAccountErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));   // an edit answers the server's complaint
  };
  const blur = (e: React.FocusEvent<HTMLInputElement>) => {
    const field = e.currentTarget.name;                  // read now: the updater below runs after the event is gone
    setTouched((t) => ({ ...t, [field]: true }));
  };

  const changeLlm = (next: LLMForm) => {
    setLlm(next);
    setProviderErrors({});
    setGeneral("");
  };

  function next() {
    const all = Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f, true])) as Record<AccountField, boolean>;
    setTouched(all);
    const problems = validateAccount(account);
    if (Object.keys(problems).length > 0 || takenHere || Object.values(serverAccountErrors).some(Boolean)) {
      setFocusTick((n) => n + 1);                       // the errors render beside their fields; jump to the first
      return;
    }
    setStep(2);
    setFocusTick((n) => n + 1);
  }

  async function submit() {
    setGeneral("");
    const problems = validateProviderStep(llm, spec);
    if (Object.keys(problems).length > 0) {
      setProviderErrors(problems);
      setFocusTick((n) => n + 1);
      return;
    }
    setProviderErrors({});
    setLoading(true);
    const payload = llmPayload(llm, spec!);
    const result = await register(
      account.email.trim(), account.password, account.username.trim(), account.fullName.trim(),
      payload.api_key, llm.provider, payload.llm_model, payload.llm_base_url,
    );
    setLoading(false);
    if (result === true) { onDone(); return; }

    const route = routeSignupFailure(result, spec);
    setStep(route.step);
    setServerAccountErrors(route.accountErrors);
    setTouched((t) => (route.step === 1 ? { ...t, ...Object.fromEntries(Object.keys(route.accountErrors).map((f) => [f, true])) } : t));
    setProviderErrors(route.providerErrors);
    setGeneral(route.general ?? "");
    setFocusTick((n) => n + 1);
  }

  const toggle = (shown: boolean, set: (v: boolean) => void, label: string) => (
    <Button variant="ghost" size="sm" icon onClick={() => set(!shown)} aria-label={shown ? `Hide ${label}` : `Show ${label}`}>
      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
    </Button>
  );

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (step === 1) next(); else void submit(); }} className="space-y-4">
      {/* Progress */}
      <div>
        <ol aria-label="Sign-up progress" className="flex gap-2 list-none p-0 m-0">
          {STEPS.map((label, i) => {
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
        <p className="sr-only" aria-live="polite">Step {step} of {STEPS.length}: {STEPS[step - 1]}</p>
      </div>

      <div ref={panelRef} className="space-y-4">
        {step === 1 ? (
          <>
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

            <Button type="submit" variant="primary" block>Next</Button>
          </>
        ) : (
          <>
            <h3 data-step-heading tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-fg outline-none">
              <Key size={15} className="text-ink-blue" aria-hidden="true" /> Connect your AI provider
            </h3>
            <p className="text-sm text-fg-2">{WHY_A_KEY}</p>

            <ProviderPicker
              providers={providers} loading={providersLoading} error={providersError} onRetry={reload}
              value={llm} onChange={changeLlm} errors={providerErrors}
            />

            {general && (
              <Card tone="danger" pad="sm" role="alert">
                <p className="text-sm text-ink-red">{general}</p>
              </Card>
            )}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setStep(1); setGeneral(""); setFocusTick((n) => n + 1); }} disabled={loading}>Back</Button>
              <Button type="submit" variant="primary" block loading={loading}>
                {loading ? "Checking your AI provider..." : "Create Account"}
              </Button>
            </div>
          </>
        )}
      </div>
    </form>
  );
}
