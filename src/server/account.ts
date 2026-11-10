// The account endpoints the UI already used against the Python backend, now on the Worker with Better Auth
// underneath (Stage 4.1): GET /auth/me, /auth/check-username, /auth/config; POST /auth/update-profile, /auth/logout;
// DELETE /auth/delete-account. Same paths and shapes, so the screens keep working.
import { isAPIError } from "better-auth/api";
import { and, eq, ne, sql } from "drizzle-orm";
import { USERNAME_RE, githubEnabled, googleEnabled } from "./auth";
import { verifyPassword } from "./auth/password";
import { account as accountTable, user as userTable } from "./db/schema";
import type { CurrentUser, RequestContext } from "./context";
import { purgeUserFiles } from "./documents";
import { HttpError } from "./http";
import { searchDeps } from "./search";
import { TIER_NAMES, tierFor } from "./plans";

/** A Better Auth refusal in the API's error shape (beside `field` when the UI shows one). */
export function fromAuthError(e: unknown, field?: string): never {
  if (isAPIError(e)) {
    const err = e as unknown as { statusCode?: number; body?: { code?: string; message?: string }; message: string };
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 400;
    throw new HttpError(status, (err.body?.code || "auth_error").toLowerCase(), err.body?.message || err.message, null, field ? { field } : null);
  }
  throw e;
}

/** How this account signs in: a password ("credential") and/or Google, GitHub. One read. */
async function signInMethods(ctx: RequestContext, userId: number): Promise<{ password: boolean; providers: string[] }> {
  const rows = await ctx.db.select({ provider: accountTable.providerId }).from(accountTable).where(eq(accountTable.userId, userId)).all();
  const ids = rows.map((r) => r.provider);
  return { password: ids.includes("credential"), providers: [...new Set(ids.filter((p) => p !== "credential"))].sort() };
}

async function passwordMatches(ctx: RequestContext, userId: number, password: string): Promise<boolean> {
  const row = await ctx.db.select({ password: accountTable.password }).from(accountTable)
    .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "credential"))).get();
  return !!row?.password && (await verifyPassword({ hash: row.password, password }));
}

export async function me(ctx: RequestContext, u: CurrentUser) {
  const tier = await tierFor(ctx.db, { id: u.id, owner: u.owner });
  const r = u.row;
  const methods = await signInMethods(ctx, r.id);
  return {
    user_id: r.id, email: r.email, username: r.displayUsername || r.username, full_name: r.name, image: r.image,
    email_verified: r.emailVerified, role: u.admin ? "admin" : "user", is_admin: u.admin, is_owner: u.owner,
    two_factor_enabled: !!r.twoFactorEnabled, has_password: methods.password,
    /** The other ways in: "github", "google" (Account -> Security names them). */
    sign_in_providers: methods.providers, timezone: r.timezone,
    tier, tier_name: TIER_NAMES[tier],
  };
}

/** How sign-in works here, for the login screen. */
export function authConfig(ctx: RequestContext) {
  return {
    google: googleEnabled(ctx.settings),
    github: githubEnabled(ctx.settings),
    email_delivery: ctx.mailer.canSend,
    verification_required: ctx.mailer.canSend,
    invite_only: false,
  };
}

export function usernameProblem(name: string): string | null {
  if (name.length < 3) return "Username must be at least 3 characters";
  if (name.length > 32) return "Username must be at most 32 characters";
  if (!USERNAME_RE.test(name)) return "Username may only contain letters, numbers, underscores, hyphens and dots";
  return null;
}

export async function checkUsername(ctx: RequestContext, raw: string, exceptUserId?: number) {
  const username = raw.trim();
  const reason = usernameProblem(username);
  if (reason) return { available: false, username, reason };
  const where = exceptUserId
    ? and(eq(userTable.username, username.toLowerCase()), ne(userTable.id, exceptUserId))
    : eq(userTable.username, username.toLowerCase());
  const taken = await ctx.db.select({ id: userTable.id }).from(userTable).where(where).get();
  return { available: !taken, username, reason: null };
}

export interface ProfileChange {
  full_name?: string;
  username?: string;
  email?: string;
  new_password?: string;
  current_password?: string;
}

export async function updateProfile(req: Request, ctx: RequestContext, u: CurrentUser, body: ProfileChange) {
  const headers = req.headers;
  const changes: Record<string, string> = {};
  if (typeof body.full_name === "string" && body.full_name.trim() !== u.row.name) {
    const name = body.full_name.trim();
    if (!name || name.length > 100) throw new HttpError(400, "invalid_name", "Full name must be 1-100 characters", null, { field: "full_name" });
    changes.name = name;
  }
  if (typeof body.username === "string" && body.username.trim() !== (u.row.displayUsername || u.row.username)) {
    const check = await checkUsername(ctx, body.username, u.id);
    if (check.reason) throw new HttpError(400, "invalid_username", check.reason, null, { field: "username" });
    if (!check.available) throw new HttpError(409, "username_taken", "That username is already taken", null, { field: "username" });
    changes.username = check.username;
    changes.displayUsername = check.username;
  }
  const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const emailChanges = !!newEmail && newEmail !== u.row.email;
  if ((emailChanges || body.new_password) && !body.current_password) {
    throw new HttpError(400, "password_required", "Enter your current password", null, { field: "current_password" });
  }
  if (emailChanges) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail) || newEmail.length > 254) {
      throw new HttpError(400, "invalid_email", "Invalid email format", null, { field: "email" });
    }
    if (!(await passwordMatches(ctx, u.id, body.current_password!))) {
      throw new HttpError(400, "wrong_password", "Your current password isn't right", null, { field: "current_password" });
    }
    const taken = await ctx.db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, newEmail)).get();
    if (taken) throw new HttpError(409, "email_taken", "An account with that email already exists", null, { field: "email" });
  }

  if (Object.keys(changes).length) {
    try { await ctx.auth.api.updateUser({ headers, body: changes }); } catch (e) { fromAuthError(e, changes.username ? "username" : "full_name"); }
  }
  if (body.new_password) {
    try {
      await ctx.auth.api.changePassword({ headers, body: { currentPassword: body.current_password!, newPassword: body.new_password, revokeOtherSessions: true } });
    } catch (e) { fromAuthError(e, "new_password"); }
  }
  if (emailChanges) {
    // The new address has to be confirmed again; until then the account isn't verified (and isn't the owner).
    await ctx.db.update(userTable).set({ email: newEmail, emailVerified: false, updatedAt: new Date() }).where(eq(userTable.id, u.id));
    await ctx.auth.api.sendVerificationOTP({ body: { email: newEmail, type: "email-verification" } });
  }
  return { ok: true, email_verification_sent: emailChanges };
}

/** Delete the account and everything on it. The owner's account can't be deleted while OWNER_EMAIL names it. */
export async function deleteAccount(req: Request, ctx: RequestContext, u: CurrentUser, password: string | undefined): Promise<Headers> {
  if (u.owner) throw new HttpError(400, "owner_account", "This is the owner account (OWNER_EMAIL). Change OWNER_EMAIL first to delete it.");
  if ((await signInMethods(ctx, u.id)).password) {
    if (!password || !(await passwordMatches(ctx, u.id, password))) {
      throw new HttpError(400, "wrong_password", "Your password isn't right", null, { field: "password" });
    }
  }
  const out = await ctx.auth.api.signOut({ headers: req.headers, asResponse: true });
  await purgeUserFiles(ctx, searchDeps(ctx.env), u.id);                 // PDFs (R2) and search vectors too
  await ctx.db.delete(userTable).where(eq(userTable.id, u.id));
  return out.headers;
}

export async function countUsers(ctx: RequestContext): Promise<number> {
  const r = await ctx.db.select({ n: sql<number>`count(*)` }).from(userTable).get();
  return Number(r?.n ?? 0);
}
