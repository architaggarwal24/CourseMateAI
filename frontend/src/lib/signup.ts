// The signup form's rules and error routing, kept out of the component so they can be tested.
// The validation messages are the backend's own (backend/auth/auth_service.py: validate_email / validate_username /
// validate_full_name / validate_password), so what the form says before sending is what the server would say.
import type { ProviderFieldErrors } from "@/components/ProviderPicker";
import type { ProviderSpec } from "@/lib/llmProviders";

export interface AccountForm {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}
export const emptyAccountForm: AccountForm = { fullName: "", username: "", email: "", password: "", confirmPassword: "" };

export type AccountField = keyof AccountForm;
export type AccountErrors = Partial<Record<AccountField, string>>;
export const ACCOUNT_FIELDS: AccountField[] = ["fullName", "username", "email", "password", "confirmPassword"];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_\-.]+$/;
const MAX_PASSWORD_BYTES = 72;                       // bcrypt only reads the first 72 bytes

export function validateField(field: AccountField, form: AccountForm): string | null {
  switch (field) {
    case "fullName": {
      const name = form.fullName.trim();
      if (!name) return "Full name is required";
      if (name.length > 100) return "Full name must be at most 100 characters";
      return null;
    }
    case "username": {
      const username = form.username.trim();
      if (username.length < 3) return "Username must be at least 3 characters";
      if (username.length > 32) return "Username must be at most 32 characters";
      if (!USERNAME_RE.test(username)) return "Username may only contain letters, numbers, underscores, hyphens and dots";
      return null;
    }
    case "email": {
      const email = form.email.trim().toLowerCase();
      if (email.length > 254 || !EMAIL_RE.test(email)) return "Invalid email format";
      return null;
    }
    case "password": {
      if (form.password.length < 8) return "Password must be at least 8 characters";
      if (new TextEncoder().encode(form.password).length > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
      return null;
    }
    case "confirmPassword":
      return form.confirmPassword !== form.password ? "Passwords do not match" : null;
  }
}

export function validateAccount(form: AccountForm): AccountErrors {
  const errors: AccountErrors = {};
  for (const field of ACCOUNT_FIELDS) {
    const problem = validateField(field, form);
    if (problem) errors[field] = problem;
  }
  return errors;
}

// ── Where a failed registration goes ────────────────────────────────────────────

/** A failed POST /auth/register: the message, and the request field it is about (error.details.field) when known. */
export interface SignupFailure {
  message: string;
  field?: string;
}

/** The API's field names for the account step, and the form field each one is shown beside. */
const ACCOUNT_API_FIELDS: Record<string, AccountField> = {
  full_name: "fullName", username: "username", email: "email", password: "password",
};
const PROVIDER_API_FIELDS = ["llm_provider", "llm_model", "llm_base_url", "api_key"] as const;

export interface SignupFailureRoute {
  step: 1 | 2;
  accountErrors: AccountErrors;
  providerErrors: ProviderFieldErrors;
  /** A message that has no field of its own on the step it is shown on. */
  general?: string;
}

/**
 * Account problems (taken email or username, bad format) go back to step 1, beside their field. Everything about the
 * AI provider stays on step 2 - beside the field when the picker shows it, otherwise as a message on the step - so a
 * failed provider check never sends the user back to the start.
 */
export function routeSignupFailure(failure: SignupFailure, spec: ProviderSpec | undefined): SignupFailureRoute {
  const accountField = failure.field ? ACCOUNT_API_FIELDS[failure.field] : undefined;
  if (accountField) {
    return { step: 1, accountErrors: { [accountField]: failure.message }, providerErrors: {} };
  }
  const providerField = PROVIDER_API_FIELDS.find((f) => f === failure.field);
  // A field the picker doesn't show for this provider (a base URL for Gemini) is a message on the step instead.
  const shown =
    providerField === "llm_base_url" ? spec?.base_url_mode === "required" || spec?.base_url_mode === "optional"
    : providerField === "api_key" ? !!spec?.needs_key
    : !!providerField;
  if (providerField && shown) {
    return { step: 2, accountErrors: {}, providerErrors: { [providerField]: failure.message } };
  }
  return { step: 2, accountErrors: {}, providerErrors: {}, general: failure.message };
}

// ── Step 2 ──────────────────────────────────────────────────────────────────────

/** Problems with the provider choice before anything is sent (the same checks, in the same order, as validateLLMForm). */
export function validateProviderStep(
  form: { provider: string; model: string; baseUrl: string; apiKey: string },
  spec: ProviderSpec | undefined,
): ProviderFieldErrors {
  if (!spec) return { llm_provider: "Choose an AI provider" };
  const errors: ProviderFieldErrors = {};
  if (spec.needs_key && !form.apiKey.trim()) errors.api_key = `${spec.label} API key is required`;
  if (spec.base_url_mode === "required" && !form.baseUrl.trim()) errors.llm_base_url = "Base URL is required";
  if (!form.model.trim()) errors.llm_model = "Enter a model name";
  return errors;
}

/** The one sentence on step 2: why a key is needed, and how it is kept. */
export const WHY_A_KEY =
  "CourseMateAI runs chat, quizzes and notes on your own AI provider account, so it needs your key to do that for you — it is stored encrypted and never shown again.";
