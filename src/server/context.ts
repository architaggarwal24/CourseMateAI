// What a Worker route needs for one request: the bindings, the database, Better Auth, and who is signed in.
import { eq } from "drizzle-orm";
import { createAuth, isOwner, type Auth, type AuthSettings } from "./auth";
import { createMailer, type Mailer } from "./auth/mailer";
import { getDb, type Db } from "./db";
import { user as userTable } from "./db/schema";
import { getEnv } from "./env";
import { HttpError } from "./http";

let testMailer: Mailer | null = null;
/** Tests read the codes a fake mailer "sent" (src/server/test/auth-helpers.ts). */
export function setMailerForTests(m: Mailer | null): void {
  testMailer = m;
}

export function authSettings(env: Record<string, unknown> = process.env): AuthSettings {
  const s = (k: string) => (typeof env[k] === "string" ? (env[k] as string) : undefined);
  return {
    BETTER_AUTH_SECRET: s("BETTER_AUTH_SECRET"), BETTER_AUTH_URL: s("BETTER_AUTH_URL"), OWNER_EMAIL: s("OWNER_EMAIL"),
    GOOGLE_CLIENT_ID: s("GOOGLE_CLIENT_ID"), GOOGLE_CLIENT_SECRET: s("GOOGLE_CLIENT_SECRET"),
    PASSWORD_HASH_ITERATIONS: s("PASSWORD_HASH_ITERATIONS"), EMAIL_FROM: s("EMAIL_FROM"), RESEND_API_KEY: s("RESEND_API_KEY"),
    NODE_ENV: s("NODE_ENV"),
  };
}

export interface RequestContext {
  env: CloudflareEnv;
  db: Db;
  auth: Auth;
  settings: AuthSettings;
  mailer: Mailer;
}

export async function requestContext(req: Request): Promise<RequestContext> {
  const env = await getEnv();
  if (!env?.DB) throw new HttpError(503, "database_unavailable", "The database isn't connected. Please try again in a minute.", "retry");
  const settings = authSettings();
  const email = (env as unknown as { EMAIL?: MailerBinding }).EMAIL;
  const mailer = testMailer ?? createMailer({ ...settings, EMAIL: email });
  const auth = createAuth(env.DB, settings, { origin: new URL(req.url).origin, mailer });
  return { env, db: getDb(env.DB), auth, settings, mailer };
}
type MailerBinding = Parameters<typeof createMailer>[0]["EMAIL"];

export type UserRow = typeof userTable.$inferSelect;
export interface CurrentUser {
  id: number;
  row: UserRow;
  owner: boolean;
  admin: boolean;
}

export async function currentUser(req: Request, ctx: RequestContext): Promise<CurrentUser | null> {
  const s = await ctx.auth.api.getSession({ headers: req.headers });
  if (!s?.user) return null;
  const row = await ctx.db.select().from(userTable).where(eq(userTable.id, Number(s.user.id))).get();
  if (!row) return null;
  const owner = isOwner(row, ctx.settings);
  return { id: row.id, row, owner, admin: owner || row.role === "admin" };
}

export async function requireUser(req: Request, ctx: RequestContext): Promise<CurrentUser> {
  const u = await currentUser(req, ctx);
  if (!u) throw new HttpError(401, "unauthenticated", "Please log in to continue.", "relogin");
  return u;
}

export async function requireAdmin(req: Request, ctx: RequestContext): Promise<CurrentUser> {
  const u = await requireUser(req, ctx);
  if (!u.admin) throw new HttpError(403, "forbidden", "Only admins can do that.");
  return u;
}
