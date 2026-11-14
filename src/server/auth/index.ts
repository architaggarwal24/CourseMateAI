// Accounts on the Worker (Phase 4.1): Better Auth on D1.
//   * email + password (PBKDF2 through Web Crypto: src/server/auth/password.ts), a 6-digit code to verify the email
//     and to reset a password (email-otp plugin); Google and GitHub sign-in, each when its client id and secret are set
//   * two-step sign-in the user can turn on later (authenticator app, or an emailed code), with backup codes
//   * usernames, roles and bans (username + admin plugins; the admin's own endpoints are switched off: the /admin
//     page uses src/server/account/admin.ts, which protects the owner)
//   * OWNER_EMAIL: that account, once its email is verified, is always an admin and on the top plan
// One instance per request: the D1 binding and the site's address come with the request.
import { TERMS_VERSION } from "@/lib/legal";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, twoFactor, username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { codeMail, createMailer, type Mailer, type MailerEnv } from "./mailer";
import { authGuards, emailDailyCap, limitedMailer, pwnedCheck, type BreachCheck } from "./guards";
import { hashPassword, iterationsFrom, verifyPassword } from "./password";

export interface AuthSettings extends MailerEnv {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  OWNER_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  PASSWORD_HASH_ITERATIONS?: string;
  /** Emails the site may send a day (default 100). */
  EMAIL_DAILY_CAP?: string;
  /** "off" turns the breached-password check off (it is also off under tests). */
  PASSWORD_BREACH_CHECK?: string;
  NODE_ENV?: string;
}

export const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

/** The owner's address, lower-case ("" when OWNER_EMAIL isn't set). */
export function ownerEmail(settings: AuthSettings): string {
  return (settings.OWNER_EMAIL || "").trim().toLowerCase();
}

/** The owner: OWNER_EMAIL, and only once that address is verified (so nobody can claim it by signing up first). */
export function isOwner(user: { email: string; emailVerified?: boolean | null }, settings: AuthSettings): boolean {
  const owner = ownerEmail(settings);
  return !!owner && !!user.emailVerified && user.email.toLowerCase() === owner;
}

export function googleEnabled(settings: AuthSettings): boolean {
  return !!(settings.GOOGLE_CLIENT_ID && settings.GOOGLE_CLIENT_SECRET);
}
export function githubEnabled(settings: AuthSettings): boolean {
  return !!(settings.GITHUB_CLIENT_ID && settings.GITHUB_CLIENT_SECRET);
}

export type SocialProvider = "google" | "github";
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["google", "github"];

/**
 * The sign-in providers that are set up, and how an existing account with the same email is treated:
 *   google  trusted: Google only gives verified addresses, so it signs into that account
 *   github  signs into that account only when GitHub says the address is verified (Better Auth checks)
 */
export function socialProviders(settings: AuthSettings): NonNullable<BetterAuthOptions["socialProviders"]> {
  const out: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (googleEnabled(settings)) {
    out.google = { clientId: settings.GOOGLE_CLIENT_ID!, clientSecret: settings.GOOGLE_CLIENT_SECRET!, prompt: "select_account" };
  }
  if (githubEnabled(settings)) {
    out.github = { clientId: settings.GITHUB_CLIENT_ID!, clientSecret: settings.GITHUB_CLIENT_SECRET! };
  }
  return out;
}

/** Only `next dev` and the tests may run without a real secret. */
const DEV_SECRET_OK = new Set(["development", "test"]);

/**
 * The secret that signs sessions. Fails closed: on Cloudflare Workers NODE_ENV is not set at run time (OpenNext only
 * copies the Worker's own variables), so anything but an explicit "development" or "test" counts as the live site,
 * and a missing or short secret stops sign-in instead of falling back to the public placeholder below.
 */
export function secretFrom(settings: AuthSettings): string {
  const secret = (settings.BETTER_AUTH_SECRET || "").trim();
  if (secret.length >= 32) return secret;
  if (!DEV_SECRET_OK.has((settings.NODE_ENV || "").trim())) {
    throw new Error("BETTER_AUTH_SECRET must be set (32+ random characters) in the Worker's settings.");
  }
  return "coursemate-dev-only-secret-change-me-0123456789";
}

/** A free username from an email (for Google and GitHub sign-ups): its letters before the @, and a number if taken. */
export function usernameFromEmail(email: string, suffix: number): string {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24) || "student";
  const padded = base.length < 3 ? `${base}${"xyz".slice(base.length)}` : base;
  return suffix ? `${padded}${suffix}` : padded;
}

// The admin plugin's own HTTP endpoints: off. Admin work goes through src/server/account/admin.ts.
const ADMIN_PLUGIN_PATHS = [
  "ban-user", "create-user", "get-user", "has-permission", "impersonate-user", "list-user-sessions", "list-users",
  "remove-user", "revoke-user-session", "revoke-user-sessions", "set-role", "set-user-password", "stop-impersonating",
  "unban-user", "update-user",
].map((p) => `/admin/${p}`);

export interface CreateAuthOptions {
  /** The site's own origin (from the request): cookies, redirects and the allowed Origin header. */
  origin?: string;
  mailer?: Mailer;
  /** Tests: the breached-password check to use (default: Have I Been Pwned, unless switched off). */
  breachCheck?: BreachCheck | null;
  /**
   * Security fix #20: where Better Auth's background work goes (the Worker's ctx.waitUntil). Codes are then sent after
   * the reply, so asking for one takes as long whether or not the account exists (otherwise only a real account
   * waited for the email to be handed over, and the time gave it away). Without it (tests), the send is awaited.
   */
  runInBackground?: (work: Promise<unknown>) => void;
}

export function authOptions(d1: D1Database, settings: AuthSettings, { origin, mailer, breachCheck, runInBackground }: CreateAuthOptions = {}) {
  const db = getDb(d1);
  const mail = limitedMailer(db, mailer ?? createMailer(settings), emailDailyCap(settings.EMAIL_DAILY_CAP));
  const baseURL = (settings.BETTER_AUTH_URL || origin || "").replace(/\/+$/, "") || undefined;
  const iterations = iterationsFrom(settings as Record<string, unknown>);
  const breachOff = (settings.PASSWORD_BREACH_CHECK || "").trim().toLowerCase() === "off" || settings.NODE_ENV === "test";
  const guards = authGuards({ db, breachCheck: breachCheck !== undefined ? breachCheck : breachOff ? null : pwnedCheck });

  async function syncOwner(user: { id: string | number; email: string; emailVerified?: boolean | null; role?: string | null }) {
    if (isOwner(user, settings) && user.role !== "admin") {
      await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, Number(user.id)));
    }
  }

  async function freeUsername(email: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const candidate = usernameFromEmail(email, i === 0 ? 0 : Math.floor(1000 + Math.random() * 9000));
      const taken = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, candidate.toLowerCase())).get();
      if (!taken) return candidate;
    }
    return `student${Date.now()}`;
  }

  return {
    appName: "CourseMateAI",
    baseURL,
    basePath: "/api/auth",
    secret: secretFrom(settings),
    trustedOrigins: [origin, settings.BETTER_AUTH_URL].filter((o): o is string => !!o),
    database: drizzleAdapter(db, { provider: "sqlite", schema, transaction: false }),
    advanced: {
      cookiePrefix: "coursemate",
      database: { generateId: "serial" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      ...(runInBackground ? { backgroundTasks: { handler: runInBackground } } : {}),
    },
    disabledPaths: ["/sign-in/email-otp", ...ADMIN_PLUGIN_PATHS],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      // Without an email service nobody could ever verify, so the account works straight away.
      requireEmailVerification: mail.canSend,
      revokeSessionsOnPasswordReset: true,
      password: { hash: (password: string) => hashPassword(password, iterations), verify: verifyPassword },
    },
    emailVerification: { autoSignInAfterVerification: true },
    socialProviders: socialProviders(settings),
    // Google is trusted; GitHub links only verified addresses (see socialProviders above)
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    user: {
      additionalFields: {
        timezone: { type: "string", required: false, input: true },
        // the Terms and Privacy Policy accepted at sign-up (only the current version counts; see the create hook)
        termsVersion: { type: "string", required: false, input: true },
        termsAcceptedAt: { type: "date", required: false, input: false },
      },
      deleteUser: { enabled: true },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-in/username": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 10 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/email-otp/verify-email": { window: 60, max: 10 },
        "/email-otp/reset-password": { window: 60, max: 5 },
        "/forget-password/email-otp": { window: 60, max: 3 },
        "/two-factor/send-otp": { window: 60, max: 3 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-otp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 10 },
      },
    },
    // per-account sign-in pause and breached-password check (./guards.ts)
    hooks: { before: guards.before, after: guards.after },
    databaseHooks: {
      user: {
        create: {
          before: async (user: Record<string, unknown>) => {
            const email = String(user.email).trim().toLowerCase();
            const data: Record<string, unknown> = { ...user, email, role: "user" };
            // the box at sign-up: recorded with the date, and only for the version on the page now (anything else
            // means "not accepted": the app asks once you're in)
            if (data.termsVersion === TERMS_VERSION) data.termsAcceptedAt = new Date();
            else { data.termsVersion = null; data.termsAcceptedAt = null; }
            if (!data.username) {
              const name = await freeUsername(email);
              data.username = name.toLowerCase();
              data.displayUsername = name;
            }
            return { data };
          },
          after: async (user: { id: string; email: string; emailVerified?: boolean }) => syncOwner(user),
        },
        update: { after: async (user: { id: string; email: string; emailVerified?: boolean; role?: string }) => syncOwner(user) },
      },
      session: {
        create: {
          after: async (session: { userId: string | number }) => {
            const user = await db.select().from(schema.user).where(eq(schema.user.id, Number(session.userId))).get();
            if (user) await syncOwner(user);
          },
        },
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (name: string) => USERNAME_RE.test(name),
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => mail.send(codeMail(email, otp, type)),
      }),
      twoFactor({
        issuer: "CourseMateAI",
        otpOptions: { sendOTP: async ({ user, otp }) => mail.send(codeMail(user.email, otp, "two-factor")) },
      }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(d1: D1Database, settings: AuthSettings, opts: CreateAuthOptions = {}) {
  return betterAuth(authOptions(d1, settings, opts));
}

export type Auth = ReturnType<typeof createAuth>;
