// The sign-up form's rules, kept out of the component so they can be tested. They match the server's
// (src/server/auth/account.ts, Better Auth's username and password limits), so what the form says before sending is what
// the server would say.
import type { AuthFailure } from "@/lib/auth/auth-api";

export interface AccountForm {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  /** Optional: a code from the team puts the new account on its plan (redeemed once signed in). */
  inviteCode: string;
}
export const emptyAccountForm: AccountForm = { fullName: "", username: "", email: "", password: "", confirmPassword: "", inviteCode: "" };

export type AccountField = keyof AccountForm;
export type AccountErrors = Partial<Record<AccountField, string>>;
export const ACCOUNT_FIELDS: AccountField[] = ["fullName", "username", "email", "password", "confirmPassword"];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_\-.]+$/;
const MAX_PASSWORD_LENGTH = 128;

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
      if (form.password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
      return null;
    }
    case "confirmPassword":
      return form.confirmPassword !== form.password ? "Passwords do not match" : null;
    case "inviteCode":
      return null;                                   // the server checks codes (and says whether one is needed)
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

// ── Where a failed sign-up goes ────────────────────────────────────────────────

/** The account field a refusal belongs beside, or null (then it's a message on the form). */
export function fieldForFailure(failure: AuthFailure): AccountField | null {
  switch (failure.field) {
    case "email": return "email";
    case "username": return "username";
    case "password": return "password";
    case "fullName": return "fullName";
    default: return null;
  }
}
