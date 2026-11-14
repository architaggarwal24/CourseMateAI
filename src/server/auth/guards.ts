// Sign-in defences on top of Better Auth's per-IP limits (security fix #5):
//   * per account: after ACCOUNT_FAILS wrong passwords in ACCOUNT_WINDOW seconds, that account's password sign-in
//     pauses until the window ends, whichever IPs the guesses come from. Counted per account, not per name typed, so
//     the email and the username of one account share the count. A right password or a password reset clears it.
//     A name nobody has gets the same treatment, so the pause never tells whether an account exists.
//   * breached passwords: a new password (sign-up, reset, change) that appears in Have I Been Pwned is refused. Only
//     the first five characters of its SHA-1 hash leave the Worker (k-anonymity). If the service can't be reached the
//     password is allowed (a sign-up never fails because a third party is down).
import * as logs from "../log";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { isPasswordCompromised } from "better-auth/plugins";
import { eq } from "drizzle-orm";
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

export function authGuards({ db, breachCheck, log = logs.warn }: GuardOptions) {
  const before = createAuthMiddleware(async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
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

// ── how many codes go out (security fix #8) ──────────────────────────────────────────────────────────────────────
// Better Auth already limits each code endpoint per IP. On top: at most MAIL_PER_ADDRESS codes an hour to one
// address (whoever asks, from however many IPs), and EMAIL_DAILY_CAP emails a day for the whole site (default 100,
// Resend's free daily allowance), so nobody can flood one inbox or use up the sending quota. Over either limit the
// code is quietly not sent (the reply stays the same, so it never tells whether an account exists) and the Worker's
// log says why. The person can ask again later.
export const MAIL_PER_ADDRESS = 5;
export const DEFAULT_EMAIL_DAILY_CAP = 100;

export function emailDailyCap(raw: string | undefined): number {
  const n = Number((raw ?? "").trim() || NaN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EMAIL_DAILY_CAP;
}

/** The mailer, with the per-address and daily limits in front of it. */
export function limitedMailer<M extends { canSend: boolean; send: (m: { to: string; subject: string; text: string; html: string }) => Promise<void> }>(
  db: Db, mailer: M, dailyCap: number, log: (line: string) => void = logs.warn,
): M {
  return {
    ...mailer,
    async send(m) {
      if (!mailer.canSend) return mailer.send(m);              // nothing really goes out: the code is only logged
      const to = m.to.trim().toLowerCase();
      if (await bumpCounter(db, `mail-to:${to}`, 3600) > MAIL_PER_ADDRESS) {
        log(`[coursemate-email] not sent: over ${MAIL_PER_ADDRESS} codes this hour for one address`);
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
