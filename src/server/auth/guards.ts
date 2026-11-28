// Sign-in defences on top of Better Auth's per-IP limits (security fix #5):
//   * per account: after ACCOUNT_FAILS wrong passwords in ACCOUNT_WINDOW seconds, that account's password sign-in
//     pauses until the window ends, whichever IPs the guesses come from. Counted per account, not per name typed, so
//     the email and the username of one account share the count. A right password or a password reset clears it.
//     A name nobody has gets the same treatment, so the pause never tells whether an account exists.
//   * breached passwords: a new password (sign-up, reset, change) that appears in Have I Been Pwned is refused. Only
//     the first five characters of its SHA-1 hash leave the Worker (k-anonymity). If the service can't be reached the
//     password is allowed (a sign-up never fails because a third party is down).
import * as logs from "../log";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { isPasswordCompromised } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { verifyPassword } from "./password";
import type { Db } from "../db";
import * as schema from "../db/schema";
import { bumpCounter, clearCounter, peekCounter, windowLeft } from "../http";

export const ACCOUNT_FAILS = 10;
export const ACCOUNT_WINDOW = 15 * 60;
const SIGN_IN_PATHS = new Set(["/sign-in/email", "/sign-in/username"]);
/** Where a new password is chosen, and the body field it comes in. */
const NEW_PASSWORD_PATHS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/email-otp/reset-password": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
};
export const PASSWORD_COMPROMISED = "PASSWORD_COMPROMISED";

export type BreachCheck = (password: string) => Promise<boolean>;

interface GuardOptions {
  db: Db;
  /** null: no breach check (tests, or PASSWORD_BREACH_CHECK=off). */
  breachCheck: BreachCheck | null;
  log?: (line: string) => void;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** The counter key for a sign-in attempt: the account's email when the name is known, else the name typed. */
async function accountKey(db: Db, path: string, body: Record<string, unknown>): Promise<string | null> {
  if (path === "/sign-in/email") {
    const email = str(body.email);
    return email ? `signin-fail:${email}` : null;
  }
  const name = str(body.username);
  if (!name) return null;
  const u = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.username, name)).get();
  return u ? `signin-fail:${u.email.toLowerCase()}` : `signin-fail:u:${name}`;
}

// ── an emailed code proves the mailbox, not the account (security audit run 1) ─────────────────────────────────────
// Verifying an address never signs anyone in (emailVerification.autoSignInAfterVerification is off in ./index.ts), an
// address that is already verified can't be verified again, and a first verification of an account that has a
// password needs that password too (sent as `password` alongside the code), unless the request comes from that
// account's own session. Otherwise someone who registered a victim's address first would get the account (and with
// it OWNER_EMAIL's rights) the moment the victim proved the mailbox, and an email-only sign-in would skip two-step.
// The before-hook below notes what the request carried; checkFirstVerification runs once Better Auth has accepted the
// code (emailVerification.beforeEmailVerification), so a wrong password is never told apart from a wrong code.
// The note is kept against the request object itself (audit run 2): keyed by email, a second request for the same
// address could swap its own password in while the real holder's verification was in flight.
const VERIFY_PATH = "/email-otp/verify-email";
const attempts = new WeakMap<Request, { email: string; password?: string; sessionUserId?: string }>();

export const EMAIL_REGISTERED_BEFORE = "EMAIL_REGISTERED_BEFORE";

export function checkFirstVerification(db: Db) {
  return async (user: { id: string | number; email: string; emailVerified?: boolean }, request?: Request) => {
    if (!request || !new URL(request.url).pathname.endsWith(VERIFY_PATH)) return;
    const email = String(user.email).toLowerCase();
    const noted = attempts.get(request);
    attempts.delete(request);
    const seen = noted?.email === email ? noted : undefined;
    if (user.emailVerified) {
      throw new APIError("BAD_REQUEST", { code: "EMAIL_ALREADY_VERIFIED", message: "This email is already verified. Sign in instead." });
    }
    if (seen?.sessionUserId && String(seen.sessionUserId) === String(user.id)) return;   // verifying from inside the account
    const cred = await db.select({ password: schema.account.password }).from(schema.account)
      .where(and(eq(schema.account.userId, Number(user.id)), eq(schema.account.providerId, "credential"))).get();
    if (!cred?.password) return;                                    // no password was set before the mailbox was proven
    const ok = !!seen?.password && await verifyPassword({ hash: cred.password, password: seen.password });
    if (!ok) {
      throw new APIError("BAD_REQUEST", {
        code: EMAIL_REGISTERED_BEFORE,
        message: "This email was already registered with a different password. Reset your password to take the account over.",
      });
    }
  };
}

export function authGuards({ db, breachCheck, log = logs.warn }: GuardOptions) {
  const before = createAuthMiddleware(async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    if (ctx.path === VERIFY_PATH) {
      const email = str(body.email);
      if (email && ctx.request) {
        const s = await getSessionFromCtx(ctx).catch(() => null);
        attempts.set(ctx.request, { email, password: typeof body.password === "string" ? body.password : undefined, sessionUserId: s?.user?.id });
      }
    }
    if (SIGN_IN_PATHS.has(ctx.path)) {
      const key = await accountKey(db, ctx.path, body);
      if (key && await peekCounter(db, key, ACCOUNT_WINDOW) >= ACCOUNT_FAILS) {
        const retry = windowLeft(ACCOUNT_WINDOW);
        throw new APIError("TOO_MANY_REQUESTS", {
          code: "ACCOUNT_SIGN_IN_PAUSED",
          message: "Too many wrong passwords for this account. Wait a few minutes, or reset your password.",
        }, { "retry-after": String(retry), "x-retry-after": String(retry) });
      }
    }
    const field = NEW_PASSWORD_PATHS[ctx.path];
    if (field && breachCheck) {
      const pw = body[field];
      if (typeof pw === "string" && pw) {
        let breached = false;
        try { breached = await breachCheck(pw); } catch (e) { log(`[coursemate-auth] breached-password check skipped: ${e instanceof Error ? e.message : String(e)}`); }
        if (breached) {
          throw new APIError("BAD_REQUEST", {
            code: PASSWORD_COMPROMISED,
            message: "That password has appeared in a data breach. Please choose a different one.",
          });
        }
      }
    }
  });

  const after = createAuthMiddleware(async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const returned = ctx.context.returned;
    const failed = returned instanceof APIError;
    if (SIGN_IN_PATHS.has(ctx.path)) {
      const key = await accountKey(db, ctx.path, body);
      if (!key) return;
      // a wrong email or password (401); "verify your email" (403) means the password was right
      if (failed && returned.statusCode === 401) await bumpCounter(db, key, ACCOUNT_WINDOW);
      else if (!failed) await clearCounter(db, key);
    } else if (ctx.path === "/email-otp/reset-password" && !failed) {
      const email = str(body.email);
      if (email) await clearCounter(db, `signin-fail:${email}`);
    }
  });

  return { before, after };
}

/** The real check against Have I Been Pwned (an error means it couldn't be checked). */
export const pwnedCheck: BreachCheck = (password) => isPasswordCompromised(password);

// ── how many codes go out (security fix #8, split by audit run 2) ────────────────────────────────────────────────
// Better Auth already limits each code endpoint per IP. On top: at most MAIL_PER_ADDRESS codes an hour to one
// address (whoever asks, from however many IPs), and EMAIL_DAILY_CAP emails a day for the whole site (default 100,
// Resend's free daily allowance), so nobody can flood one inbox or use up the sending quota. Over either limit the
// code is quietly not sent (the reply stays the same, so it never tells whether an account exists) and the Worker's
// log says why. The person can ask again later.
//
// Codes come from two budgets. "open" codes are the ones anyone can ask for without owning a verified account (a
// sign-up's verification code, a reset for an address nobody has verified): they may use at most OPEN_SHARE of the
// daily cap. "account" codes (a reset or a two-step code for a verified account) are counted on their own per address
// and may use the whole cap, so filling the open budget with throwaway addresses never stops a real user's reset or
// two-step code.
export const MAIL_PER_ADDRESS = 5;
export const DEFAULT_EMAIL_DAILY_CAP = 100;
export const OPEN_SHARE = 0.6;
export type MailBudget = "open" | "account";

export function emailDailyCap(raw: string | undefined): number {
  const n = Number((raw ?? "").trim() || NaN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EMAIL_DAILY_CAP;
}

type Mail = { to: string; subject: string; text: string; html: string };

/** The mailer, with the per-address and daily limits in front of it. */
export function limitedMailer<M extends { canSend: boolean; send: (m: Mail) => Promise<void> }>(
  db: Db, mailer: M, dailyCap: number, log: (line: string) => void = logs.warn,
): Omit<M, "send"> & { send: (m: Mail, budget?: MailBudget) => Promise<void> } {
  const openCap = Math.max(1, Math.floor(dailyCap * OPEN_SHARE));
  return {
    ...mailer,
    async send(m: Mail, budget: MailBudget = "open") {
      if (!mailer.canSend) return mailer.send(m);              // nothing really goes out: the code is only logged
      const to = m.to.trim().toLowerCase();
      const perAddress = budget === "account" ? `mail-to:account:${to}` : `mail-to:${to}`;
      if (await bumpCounter(db, perAddress, 3600) > MAIL_PER_ADDRESS) {
        log(`[coursemate-email] not sent: over ${MAIL_PER_ADDRESS} codes this hour for one address`);
        return;
      }
      if (budget === "open" && await bumpCounter(db, "mail-day-open", 86_400) > openCap) {
        log(`[coursemate-email] not sent: the daily share for sign-up codes (${openCap} of ${dailyCap}) is used up`);
        return;
      }
      if (await bumpCounter(db, "mail-day", 86_400) > dailyCap) {
        log(`[coursemate-email] not sent: the site's daily email cap (${dailyCap}, EMAIL_DAILY_CAP) is reached`);
        return;
      }
      return mailer.send(m);
    },
  };
}
