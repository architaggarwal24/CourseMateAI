// The browser's side of accounts (Stage 4.1): Better Auth's endpoints under /api/auth, called with plain fetch, and
// their refusals turned into a message (and the form field it belongs beside) in CourseMateAI's own words.

export interface AuthFailure {
  message: string;
  code?: string;
  /** The sign-up / sign-in form field the message belongs beside. */
  field?: "email" | "username" | "password" | "fullName" | "code";
  /** Seconds to wait (too many tries). */
  retryAfter?: number;
}

const FIELD_FOR_CODE: Record<string, AuthFailure["field"]> = {
  USER_ALREADY_EXISTS: "email",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "email",
  INVALID_EMAIL: "email",
  USERNAME_IS_ALREADY_TAKEN: "username",
  PASSWORD_COMPROMISED: "password",
  USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER: "username",
  INVALID_USERNAME: "username",
  USERNAME_TOO_SHORT: "username",
  USERNAME_TOO_LONG: "username",
  PASSWORD_TOO_SHORT: "password",
  PASSWORD_TOO_LONG: "password",
  INVALID_OTP: "code",
  OTP_EXPIRED: "code",
  TOO_MANY_ATTEMPTS: "code",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "code",
  OTP_HAS_EXPIRED: "code",
  INVALID_CODE: "code",
  INVALID_TWO_FACTOR_CODE: "code",
  INVALID_BACKUP_CODE: "code",
};

const MESSAGE_FOR_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match an account.",
  USER_ALREADY_EXISTS: "An account with that email already exists. Log in instead?",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with that email already exists. Log in instead?",
  USERNAME_IS_ALREADY_TAKEN: "That username is already taken",
  USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER: "That username is already taken",
  INVALID_USERNAME: "Username may only contain letters, numbers, underscores, hyphens and dots",
  EMAIL_NOT_VERIFIED: "Please verify your email first: we've sent you a code.",
  INVALID_OTP: "That code isn't right. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Ask for a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Ask for a new one.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many wrong codes. Ask for a new one.",
  OTP_HAS_EXPIRED: "That code has expired. Ask for a new one.",
  ACCOUNT_TEMPORARILY_LOCKED: "Too many wrong codes: two-step sign-in is locked for a few minutes.",
  BANNED_USER: "This account has been suspended. Contact the CourseMateAI team if you think it's a mistake.",
  INVALID_CODE: "That code isn't right. Check it and try again.",
  INVALID_TWO_FACTOR_CODE: "That code isn't right. Check it and try again.",
  INVALID_BACKUP_CODE: "That backup code isn't right, or it has been used.",
  INVALID_PASSWORD: "That password isn't right.",
  PASSWORD_COMPROMISED: "That password has appeared in a data breach. Please choose a different one.",
};

export async function failureFrom(res: Response): Promise<AuthFailure> {
  let body: { code?: string; message?: string; error?: { code?: string; message?: string; details?: { field?: string } } } = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  const code = (body.code || body.error?.code || "").toUpperCase();
  if (res.status === 429) {
    const retry = Number(res.headers.get("x-retry-after") || res.headers.get("retry-after")) || undefined;
    if (code === "ACCOUNT_SIGN_IN_PAUSED") {
      return { message: "Too many wrong passwords for this account. Wait a few minutes, or reset your password.", code, retryAfter: retry };
    }
    return { message: "Too many tries. Please wait a moment and try again.", code: "RATE_LIMITED", retryAfter: retry };
  }
  const message = MESSAGE_FOR_CODE[code] || body.message || body.error?.message || "Something went wrong. Please try again.";
  return { message, code: code || undefined, field: FIELD_FOR_CODE[code] };
}

async function post<T = unknown>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; failure: AuthFailure }> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, failure: { message: "Couldn't reach CourseMateAI. Check your connection and try again." } };
  }
  if (!res.ok) return { ok: false, failure: await failureFrom(res) };
  let data: T;
  try { data = (await res.json()) as T; } catch { data = {} as T; }
  return { ok: true, data };
}

function browserTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

export type SignInResult = { status: "signed-in" } | { status: "two-factor" } | { status: "verify-email" } | { status: "failed"; failure: AuthFailure };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const r = await post<{ twoFactorRedirect?: boolean }>("/sign-in/email", { email: email.trim(), password, rememberMe: true });
  if (r.ok) return r.data?.twoFactorRedirect ? { status: "two-factor" } : { status: "signed-in" };
  if (r.failure.code === "EMAIL_NOT_VERIFIED") return { status: "verify-email" };
  return { status: "failed", failure: r.failure };
}

export interface SignUpForm { email: string; password: string; username: string; fullName: string }

/** Creates the account. `signedIn` is false when the email must be verified first. */
export async function signUp(form: SignUpForm): Promise<{ ok: true; signedIn: boolean } | { ok: false; failure: AuthFailure }> {
  const r = await post<{ token?: string | null }>("/sign-up/email", {
    email: form.email.trim(), password: form.password, name: form.fullName.trim(), username: form.username.trim(),
    displayUsername: form.username.trim(), timezone: browserTimeZone(),
  });
  if (!r.ok) return r;
  return { ok: true, signedIn: !!r.data?.token };
}

export async function sendVerificationCode(email: string) {
  return post("/email-otp/send-verification-otp", { email: email.trim(), type: "email-verification" });
}

/** Confirms the email with the 6-digit code; signs the person in. */
export async function verifyEmail(email: string, code: string) {
  return post("/email-otp/verify-email", { email: email.trim(), otp: code.trim() });
}

export async function requestPasswordReset(email: string) {
  return post("/forget-password/email-otp", { email: email.trim() });
}

export async function resetPassword(email: string, code: string, password: string) {
  return post("/email-otp/reset-password", { email: email.trim(), otp: code.trim(), password });
}

export type TwoFactorMethod = "totp" | "otp" | "backup";

export async function verifyTwoFactor(method: TwoFactorMethod, code: string, trustDevice = false) {
  const path = method === "totp" ? "/two-factor/verify-totp" : method === "otp" ? "/two-factor/verify-otp" : "/two-factor/verify-backup-code";
  return post(path, { code: code.trim().replace(/\s+/g, ""), trustDevice });
}

export async function sendTwoFactorCode() {
  return post("/two-factor/send-otp", {});
}

/** Starts two-step sign-in: the authenticator link (otpauth://) and the backup codes. Needs the password. */
export async function enableTwoFactor(password: string) {
  return post<{ totpURI: string; backupCodes: string[] }>("/two-factor/enable", { password });
}

export async function disableTwoFactor(password: string) {
  return post("/two-factor/disable", { password });
}

/** Sends the browser to Google; it comes back signed in at `callbackURL`. */
export async function signInWithGoogle(callbackURL = "/study"): Promise<AuthFailure | null> {
  const r = await post<{ url?: string }>("/sign-in/social", { provider: "google", callbackURL, errorCallbackURL: "/login?error=google" });
  if (!r.ok) return r.failure;
  if (r.data?.url) window.location.assign(r.data.url);
  return null;
}
