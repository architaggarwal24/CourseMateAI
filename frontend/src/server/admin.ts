// The /admin page's server side (Stage 4.1): users and their plans, roles, bans, invite codes.
// Rules: only admins get here; only the owner makes or removes admins; nobody can ban, demote or delete the
// owner; an admin can't ban another admin (only the owner can) or themselves.
import { asc, desc, eq, like, or, sql } from "drizzle-orm";
import { isOwner } from "./auth";
import type { CurrentUser, RequestContext } from "./context";
import { session as sessionTable, user as userTable, userPlans } from "./db/schema";
import { HttpError } from "./http";
import { clearPlan, setPlan } from "./invites";
import { TIER_NAMES, isTier, nowIso, tierFor } from "./plans";

const DAY = 86_400_000;

async function target(ctx: RequestContext, id: number) {
  const row = await ctx.db.select().from(userTable).where(eq(userTable.id, id)).get();
  if (!row) throw new HttpError(404, "user_not_found", "There's no such user.");
  return { row, owner: isOwner(row, ctx.settings), admin: isOwner(row, ctx.settings) || row.role === "admin" };
}

export async function adminUserView(ctx: RequestContext, row: typeof userTable.$inferSelect) {
  const owner = isOwner(row, ctx.settings);
  const plan = await ctx.db.select().from(userPlans).where(eq(userPlans.userId, row.id)).get();
  const tier = await tierFor(ctx.db, { id: row.id, owner });
  const bannedNow = !!row.banned && (!row.banExpires || row.banExpires > new Date());
  return {
    user_id: row.id, email: row.email, username: row.displayUsername || row.username, full_name: row.name,
    email_verified: row.emailVerified, role: owner || row.role === "admin" ? "admin" : "user", is_owner: owner,
    banned: bannedNow, ban_reason: bannedNow ? row.banReason : null, ban_expires: bannedNow && row.banExpires ? row.banExpires.toISOString() : null,
    created_at: row.createdAt.toISOString(), tier, tier_name: TIER_NAMES[tier],
    plan: plan ? { tier: plan.tier, source: plan.source, expires_at: plan.expiresAt, started_at: plan.startedAt } : null,
  };
}

export async function listUsers(ctx: RequestContext, { q = "", offset = 0, limit = 25 }: { q?: string; offset?: number; limit?: number }) {
  const term = q.trim().toLowerCase();
  const where = term
    ? or(like(userTable.email, `%${term}%`), like(userTable.username, `%${term}%`), like(sql`lower(${userTable.name})`, `%${term}%`))
    : undefined;
  const lim = Math.min(Math.max(1, limit), 100);
  const rows = await ctx.db.select().from(userTable).where(where).orderBy(desc(userTable.createdAt), asc(userTable.id))
    .limit(lim).offset(Math.max(0, offset)).all();
  const total = Number((await ctx.db.select({ n: sql<number>`count(*)` }).from(userTable).where(where).get())?.n ?? 0);
  return { users: await Promise.all(rows.map((r) => adminUserView(ctx, r))), total, offset, limit: lim };
}

export async function setUserPlan(ctx: RequestContext, actor: CurrentUser, id: number, tier: unknown, days: unknown) {
  const t = await target(ctx, id);
  if (t.owner) throw new HttpError(400, "owner_plan", "The owner is always on the top plan.");
  if (tier === null || tier === "apprentice" && !days) {
    await clearPlan(ctx.db, id);
  } else {
    if (!isTier(tier)) throw new HttpError(400, "invalid_tier", "Choose a plan.", null, { field: "tier" });
    const d = days === null || days === undefined || days === "" ? null : Number(days);
    if (d !== null && (!Number.isInteger(d) || d < 1 || d > 3650)) {
      throw new HttpError(400, "invalid_days", "Days must be a whole number from 1 to 3650, or empty for no end.", null, { field: "days" });
    }
    await setPlan(ctx.db, id, tier, { days: d, source: "admin", ref: `admin:${actor.id}`, grantedBy: actor.id });
  }
  return adminUserView(ctx, (await target(ctx, id)).row);
}

export async function setRole(ctx: RequestContext, actor: CurrentUser, id: number, role: unknown) {
  if (!actor.owner) throw new HttpError(403, "owner_only", "Only the owner can make or remove admins.");
  if (role !== "admin" && role !== "user") throw new HttpError(400, "invalid_role", "A role is admin or user.", null, { field: "role" });
  const t = await target(ctx, id);
  if (t.owner) throw new HttpError(400, "owner_role", "The owner is always an admin.");
  await ctx.db.update(userTable).set({ role, updatedAt: new Date() }).where(eq(userTable.id, id));
  return adminUserView(ctx, (await target(ctx, id)).row);
}

export async function ban(ctx: RequestContext, actor: CurrentUser, id: number, reason: unknown, days: unknown) {
  const t = await target(ctx, id);
  if (t.owner) throw new HttpError(400, "owner_ban", "The owner can't be banned.");
  if (id === actor.id) throw new HttpError(400, "self_ban", "You can't ban yourself.");
  if (t.admin && !actor.owner) throw new HttpError(403, "owner_only", "Only the owner can ban an admin.");
  const d = days === null || days === undefined || days === "" ? null : Number(days);
  if (d !== null && (!Number.isInteger(d) || d < 1 || d > 3650)) {
    throw new HttpError(400, "invalid_days", "Days must be a whole number from 1 to 3650, or empty for good.", null, { field: "days" });
  }
  await ctx.db.update(userTable).set({
    banned: true, banReason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : null,
    banExpires: d ? new Date(Date.now() + d * DAY) : null, updatedAt: new Date(),
  }).where(eq(userTable.id, id));
  await ctx.db.delete(sessionTable).where(eq(sessionTable.userId, id));          // signed out everywhere, now
  return adminUserView(ctx, (await target(ctx, id)).row);
}

export async function unban(ctx: RequestContext, id: number) {
  await target(ctx, id);
  await ctx.db.update(userTable).set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() }).where(eq(userTable.id, id));
  return adminUserView(ctx, (await target(ctx, id)).row);
}

export function inviteView(r: { code: string; tier: string; days: number | null; maxUses: number; uses: number; note: string | null; createdAt: string; expiresAt: string | null; revoked: boolean }) {
  const expired = !!r.expiresAt && new Date(r.expiresAt) <= new Date();
  return {
    code: r.code, tier: r.tier, tier_name: TIER_NAMES[r.tier as keyof typeof TIER_NAMES], days: r.days, max_uses: r.maxUses,
    uses: r.uses, note: r.note, created_at: r.createdAt, expires_at: r.expiresAt, revoked: r.revoked,
    usable: !r.revoked && !expired && r.uses < r.maxUses, now: nowIso(),
  };
}
