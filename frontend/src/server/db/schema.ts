// The D1 (SQLite) schema of the TypeScript backend (Phase 4). Each stage adds the tables it moves over;
// `npm run db:generate` turns a change here into the next file in migrations/.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Switches the owner can flip without a deploy (the global AI spend cap, maintenance notices, ...). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

// ── accounts (Better Auth, Stage 4.1: src/server/auth). Column set fixed by Better Auth and its plugins
//    (username, email-otp, two-factor, admin); ids are integers ("serial"). ─────────────────────────────────────
export const user = sqliteTable("user", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
  timezone: text("timezone"),
});

export const session = sqliteTable("session", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(() => new Date()).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
}, (t) => [index("session_userId_idx").on(t.userId)]);

export const account = sqliteTable("account", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(() => new Date()).notNull(),
}, (t) => [index("account_userId_idx").on(t.userId)]);

export const verification = sqliteTable("verification", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).$onUpdate(() => new Date()).notNull(),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

export const twoFactor = sqliteTable("two_factor", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: integer("verified", { mode: "boolean" }).default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
}, (t) => [index("twoFactor_secret_idx").on(t.secret), index("twoFactor_userId_idx").on(t.userId)]);

/** Better Auth's rate limits (sign-in, codes), kept in D1 so every Worker instance shares them. */
export const rateLimit = sqliteTable("rate_limit", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// ── plans and invite codes (Stage 4.1; the same rules as backend/services/entitlements.py, invite_service.py) ──
/** The plan a user is on when it isn't the default (Free): from an admin, an invite code, or (4.6) a subscription. */
export const userPlans = sqliteTable("user_plans", {
  userId: integer("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  tier: text("tier", { enum: ["apprentice", "scholar", "sage", "archmage"] }).notNull(),
  source: text("source", { enum: ["admin", "invite", "subscription"] }).notNull(),
  sourceRef: text("source_ref"),
  grantedBy: integer("granted_by"),
  startedAt: text("started_at").notNull(),
  expiresAt: text("expires_at"),
  updatedAt: text("updated_at").notNull(),
});

export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  tier: text("tier", { enum: ["apprentice", "scholar", "sage", "archmage"] }).notNull(),
  days: integer("days"),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  note: text("note"),
  createdBy: integer("created_by"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

export const inviteRedemptions = sqliteTable("invite_redemptions", {
  code: text("code").notNull().references(() => inviteCodes.code, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  redeemedAt: text("redeemed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.code, t.userId] }), index("invite_redemptions_user_idx").on(t.userId)]);

/** Fixed-window counters for the Worker's own routes (redeeming codes, account changes, admin actions). */
export const apiRateLimits = sqliteTable("api_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

// ── documents and courses (Stage 4.2: src/server/documents.ts, courses.ts). The PDF is in R2 (FILES), each chunk's
//    text here, its embedding in Vectorize (VECTORS, id "<document id>:<chunk index>"). ───────────────────────────
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  fileHash: text("file_hash").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  pages: integer("pages").notNull(),
  status: text("status", { enum: ["queued", "reading", "indexing", "ready", "failed"] }).notNull(),
  error: text("error"),
  chunks: integer("chunks").notNull().default(0),
  indexedPages: integer("indexed_pages").notNull().default(0),
  embeddingModel: text("embedding_model").notNull(),
  pdfStored: integer("pdf_stored", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastUsedAt: text("last_used_at").notNull(),
}, (t) => [index("documents_user_idx").on(t.userId), index("documents_hash_idx").on(t.fileHash)]);

export const documentChunks = sqliteTable("document_chunks", {
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  page: integer("page").notNull(),
  text: text("text").notNull(),
}, (t) => [primaryKey({ columns: [t.documentId, t.idx] })]);

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("courses_user_idx").on(t.userId)]);

export const courseDocuments = sqliteTable("course_documents", {
  courseId: text("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  addedAt: text("added_at").notNull(),
}, (t) => [primaryKey({ columns: [t.courseId, t.documentId] }), index("course_documents_doc_idx").on(t.documentId)]);

// ── AI use (Stage 4.3: src/server/ai). Per user per UTC day (the plan's quotas, Plan & usage), and per model per
//    day (costs, the global daily spend cap). Cost in millionths of a US dollar. ────────────────────────────────
export const usageDaily = sqliteTable("usage_daily", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  aiCalls: integer("ai_calls").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

export const aiUsage = sqliteTable("ai_usage", {
  day: text("day").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  job: text("job").notNull(),
  calls: integer("calls").notNull().default(0),
  fallbacks: integer("fallbacks").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costMicroUsd: integer("cost_micro_usd").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.provider, t.model, t.job] })]);
