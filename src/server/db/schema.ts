// The D1 (SQLite) schema of the TypeScript backend (Phase 4). Each stage adds the tables it moves over;
// `npm run db:generate` turns a change here into the next file in migrations/.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

/**
 * "You've been upgraded" (src/server/account/plan-notices.ts): a plan went up, or got longer, by an admin, an invite code or a
 * payment. The app shows it once (seen_at), on whichever device opens first. `from_*` is the plan before the first
 * change not yet seen, so a grant followed quickly by a correction shows one window that tells the whole story.
 */
export const planNotices = sqliteTable("plan_notices", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["upgrade", "extend"] }).notNull(),
  tier: text("tier", { enum: ["apprentice", "scholar", "sage", "archmage"] }).notNull(),
  fromTier: text("from_tier", { enum: ["apprentice", "scholar", "sage", "archmage"] }).notNull(),
  fromExpiresAt: text("from_expires_at"),
  source: text("source", { enum: ["admin", "invite", "subscription"] }).notNull(),
  expiresAt: text("expires_at"),
  note: text("note"),
  grantedBy: integer("granted_by"),
  createdAt: text("created_at").notNull(),
  seenAt: text("seen_at"),
}, (t) => [index("plan_notices_user_idx").on(t.userId, t.seenAt)]);

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

// Idempotency keys (src/server/idempotency.ts): the first answer to a record-creating POST, kept for 24 hours, so a
// retry with the same Idempotency-Key gets that answer instead of a second record. `status` is null while it runs.
export const idempotencyKeys = sqliteTable("idempotency_keys", {
  scope: text("scope").notNull(),                                   // "<route>:<user id>"
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: integer("status"),
  body: text("body"),
  createdAt: integer("created_at").notNull(),                       // ms
}, (t) => [primaryKey({ columns: [t.scope, t.key] }), index("idempotency_keys_created_idx").on(t.createdAt)]);

// ── documents and courses (Stage 4.2: src/server/study/documents.ts, courses.ts). The PDF is in R2 (FILES), each chunk's
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

// ── study tools (Stage 4.4: src/server/study/*). `doc_hash` names what was studied: a document's file hash, or
//    "course:<id>" for a course as a whole, so re-uploading the same PDF keeps the history. ─────────────────────
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  mode: text("mode").notNull(),
  actionType: text("action_type").notNull(),
  content: text("content"),
  createdAt: text("created_at").notNull(),
}, (t) => [index("activity_user_idx").on(t.userId, t.createdAt), index("activity_session_idx").on(t.sessionId)]);

/** Generated quizzes, flashcard sets and notes, reused for the same request for a while (GENERATION_CACHE_DAYS). */
export const generationCache = sqliteTable("generation_cache", {
  key: text("key").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (t) => [index("generation_cache_expiry_idx").on(t.expiresAt)]);

export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  topic: text("topic").notNull(),
  questionType: text("question_type").notNull(),
  questionsJson: text("questions_json").notNull(),
  questionCount: integer("question_count").notNull(),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  correctCount: integer("correct_count"),
  accuracy: real("accuracy"),
}, (t) => [index("quizzes_user_idx").on(t.userId)]);

export const quizAnswers = sqliteTable("quiz_answers", {
  quizId: text("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull(),
  answer: text("answer").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  answeredAt: text("answered_at").notNull(),
}, (t) => [primaryKey({ columns: [t.quizId, t.questionId] })]);

/** Every quiz question written for a user's document and topic; a later quiz takes ones they haven't had. */
export const quizBank = sqliteTable("quiz_bank", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  docHash: text("doc_hash").notNull(),
  topicKey: text("topic_key").notNull(),
  questionType: text("question_type").notNull(),
  textKey: text("text_key").notNull(),
  questionJson: text("question_json").notNull(),
  served: integer("served", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("quiz_bank_unique").on(t.userId, t.docHash, t.topicKey, t.questionType, t.textKey)]);

export const conceptMastery = sqliteTable("concept_mastery", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  docHash: text("doc_hash").notNull(),
  conceptKey: text("concept_key").notNull(),
  concept: text("concept").notNull(),
  seen: integer("seen").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  wrongStreak: integer("wrong_streak").notNull().default(0),
  lastSeenAt: text("last_seen_at"),
  lastWrongAt: text("last_wrong_at"),
}, (t) => [primaryKey({ columns: [t.userId, t.docHash, t.conceptKey] })]);

export const missedQuestions = sqliteTable("missed_questions", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  docHash: text("doc_hash").notNull(),
  textKey: text("text_key").notNull(),
  conceptKey: text("concept_key").notNull(),
  concept: text("concept").notNull(),
  source: text("source").notNull(),
  question: text("question").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  explanation: text("explanation"),
  missedAt: text("missed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.docHash, t.textKey] })]);

/** The spaced-repetition queue (FSRS, ts-fsrs). state: 0 new, 1 learning, 2 review, 3 relearning. */
export const reviewItems = sqliteTable("review_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  docHash: text("doc_hash").notNull(),
  itemKey: text("item_key").notNull(),
  source: text("source").notNull(),
  concept: text("concept"),
  conceptKey: text("concept_key"),
  front: text("front").notNull(),
  back: text("back").notNull(),
  explanation: text("explanation"),
  state: integer("state").notNull().default(0),
  step: integer("step").notNull().default(0),
  stability: real("stability").notNull().default(0),
  difficulty: real("difficulty").notNull().default(0),
  elapsedDays: integer("elapsed_days").notNull().default(0),
  scheduledDays: integer("scheduled_days").notNull().default(0),
  due: text("due").notNull(),
  lastReview: text("last_review"),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** Removed from the queue (round 7): hidden until the question is missed again. */
  removedAt: text("removed_at"),
}, (t) => [uniqueIndex("review_items_unique").on(t.userId, t.docHash, t.itemKey), index("review_items_due_idx").on(t.userId, t.due)]);

export const reviewLogs = sqliteTable("review_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => reviewItems.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  wasNew: integer("was_new", { mode: "boolean" }).notNull(),
  reviewedAt: text("reviewed_at").notNull(),
  localDate: text("local_date").notNull(),
  durationMs: integer("duration_ms"),
}, (t) => [index("review_logs_day_idx").on(t.userId, t.localDate)]);

export const exams = sqliteTable("exams", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  docHash: text("doc_hash").notNull(),
  docName: text("doc_name").notNull(),
  length: integer("length").notNull(),
  difficulty: text("difficulty").notNull(),
  topicsJson: text("topics_json").notNull(),
  timeLimitS: integer("time_limit_s").notNull(),
  status: text("status", { enum: ["active", "graded"] }).notNull().default("active"),
  startedAt: text("started_at").notNull(),
  deadline: text("deadline").notNull(),
  submittedAt: text("submitted_at"),
  total: integer("total").notNull(),
  score: integer("score"),
  accuracy: real("accuracy"),
  timeUsedS: integer("time_used_s"),
  breakdownJson: text("breakdown_json"),
  autoSubmitted: integer("auto_submitted", { mode: "boolean" }).notNull().default(false),
}, (t) => [index("exams_user_idx").on(t.userId, t.status)]);

export const examQuestions = sqliteTable("exam_questions", {
  examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  question: text("question").notNull(),
  optionsJson: text("options_json").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  explanation: text("explanation"),
  concept: text("concept").notNull(),
  difficulty: text("difficulty").notNull(),
}, (t) => [primaryKey({ columns: [t.examId, t.idx] })]);

export const examAnswers = sqliteTable("exam_answers", {
  examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  answer: text("answer"),
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  correct: integer("correct", { mode: "boolean" }),
  answeredAt: text("answered_at").notNull(),
}, (t) => [primaryKey({ columns: [t.examId, t.idx] })]);

/** One concept map per document content (file hash) and extractor version. `lease_until`: a build in progress. */
export const conceptMaps = sqliteTable("concept_maps", {
  docHash: text("doc_hash").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: ["queued", "running", "ready", "failed"] }).notNull(),
  stage: text("stage"),
  error: text("error"),
  dataJson: text("data_json"),
  model: text("model"),
  leaseUntil: text("lease_until"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.docHash, t.version] })]);

// ── the game (Stage 4.5: src/server/game/*). XP, coins and level are a cache of the reward_events ledger and change
//    only through it (recordRewardEvent). Days are the player's local dates (user.timezone). ───────────────────
export const userProgress = sqliteTable("user_progress", {
  userId: integer("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  totalXp: integer("total_xp").notNull().default(0),
  currentLevel: integer("current_level").notNull().default(1),
  coins: integer("coins").notNull().default(0),
  streakDays: integer("streak_days").notNull().default(0),
  lastActiveUtc: text("last_active_utc"),
  streakFreezes: integer("streak_freezes").notNull().default(0),
  totalArenaRounds: integer("total_arena_rounds").notNull().default(0),
  totalBossesDefeated: integer("total_bosses_defeated").notNull().default(0),
  totalQuizzesCompleted: integer("total_quizzes_completed").notNull().default(0),
  totalChatQuestions: integer("total_chat_questions").notNull().default(0),
  totalChatBundles: integer("total_chat_bundles").notNull().default(0),
  totalNotesGenerated: integer("total_notes_generated").notNull().default(0),
  totalFlashcardsStudied: integer("total_flashcards_studied").notNull().default(0),
  bestQuizAccuracy: integer("best_quiz_accuracy").notNull().default(0),
  nightmareBossesDefeated: integer("nightmare_bosses_defeated").notNull().default(0),
  /** Two worlds, Stage 5: Insight (0-100), filled by studying; full, it gives your next fight an edge. */
  insight: integer("insight").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rewardEvents = sqliteTable("reward_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  xp: integer("xp").notNull().default(0),
  coins: integer("coins").notNull().default(0),
  sourceId: text("source_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("reward_events_user_idx").on(t.userId, t.id)]);

export const userAvatar = sqliteTable("user_avatar", {
  userId: integer("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  equippedJson: text("equipped_json").notNull().default("{}"),
  ownedJson: text("owned_json").notNull().default("[]"),
  championId: text("champion_id"),
  championSetAt: text("champion_set_at"),
  /** Built-your-own looks per champion ({ kaien: Appearance, ... }, lib/game/appearance.ts). Missing: the champion's own. */
  looksJson: text("looks_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** The Bestiary (Stage B1): what one player has done against each creature. Tiers open from wins (server/game/tome.ts). */
export const bestiaryRecords = sqliteTable("bestiary_records", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  species: text("species").notNull(),
  fights: integer("fights").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  /** Won without losing a heart, on hard or nightmare (gold mastery). */
  flawlessWins: integer("flawless_wins").notNull().default(0),
  nightmareWins: integer("nightmare_wins").notNull().default(0),
  bestSeconds: integer("best_seconds"),
  bestAccuracy: integer("best_accuracy"),
  /** Landed its bane combo before the first win (worked it out from the clue). */
  baneFound: integer("bane_found", { mode: "boolean" }).notNull().default(false),
  baneUses: integer("bane_uses").notNull().default(0),
  /** A topic that would have summoned it while it was still locked (the page's teaser). */
  teaserTopic: text("teaser_topic"),
  firstWinAt: text("first_win_at"),
  lastFoughtAt: text("last_fought_at"),
  /** Mastery already paid out: none | bronze | silver | gold. */
  masteryPaid: text("mastery_paid").notNull().default("none"),
  /** Its lost page was found (a Hunt's reward, Stage Q1): the book shows the extra lore. */
  lostPage: integer("lost_page", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.species] })]);

export const championProgress = sqliteTable("champion_progress", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  championId: text("champion_id").notNull(),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  battles: integer("battles").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.championId] })]);

/**
 * Your hero (game/build.ts): the seventh fighter, built by the player. Level and XP; its look (an appearance,
 * lib/game/appearance.ts); its build (style, passive, ultimate, perks, extra weaknesses); its skill-tree ranks; and the
 * original styles and perks it has bought or earned (champion styles and abilities come from mastery, not stored).
 */
export const heroState = sqliteTable("hero_state", {
  userId: integer("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  xp: integer("xp").notNull().default(0),
  lookJson: text("look_json").notNull().default(""),
  buildJson: text("build_json").notNull().default("{}"),
  treeJson: text("tree_json").notNull().default("{}"),
  ownedJson: text("owned_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * The forge (game/forge.ts): every weapon, outfit, head piece and pet a player owns earns XP when worn in a fight.
 * `xp` is the bar toward the next tier (it starts again after an upgrade); `tier` is I-V (1-5). A pet saddled at
 * tier IV or more can be ridden as a mount.
 */
export const itemProgress = sqliteTable("item_progress", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  xp: integer("xp").notNull().default(0),
  tier: integer("tier").notNull().default(1),
  saddled: integer("saddled", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.itemId] })]);

/** Forge materials dropped by Bestiary creatures (game/forge.ts MATERIALS), per player. */
export const forgeMaterials = sqliteTable("forge_materials", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  materialId: text("material_id").notNull(),
  quantity: integer("quantity").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.materialId] })]);

/** Champion mastery challenges (game/mastery.ts): how far each one is, per player and champion; doneAt once finished. */
export const championChallenges = sqliteTable("champion_challenges", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  championId: text("champion_id").notNull(),
  challengeId: text("challenge_id").notNull(),
  progress: integer("progress").notNull().default(0),
  doneAt: text("done_at"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.championId, t.challengeId] })]);

/**
 * Champions the player may fight as (Stage C1). Kaien needs no row. `source`: tier1..tier4 (a Bestiary tier
 * finished), level (Thorne at player level 25) or kept (picked before champions were locked). The unlock ceremony
 * sets celebrated_at once, with its reward.
 */
export const championUnlocks = sqliteTable("champion_unlocks", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  championId: text("champion_id").notNull(),
  source: text("source").notNull(),
  unlockedAt: text("unlocked_at").notNull(),
  celebratedAt: text("celebrated_at"),
}, (t) => [primaryKey({ columns: [t.userId, t.championId] })]);

/**
 * The quest board's scrolls beyond the daily quests (Stage Q1): weekly trials (period = the week, e.g. 2026-W45),
 * Bestiary hunts and champion story chapters (period = ""). `event` is what moves it on (scrolls.ts); the seal
 * breaks when it is claimed (claimed_at), paid once by its ledger key.
 */
export const questScrolls = sqliteTable("quest_scrolls", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scrollId: text("scroll_id").notNull(),
  period: text("period").notNull().default(""),
  kind: text("kind").notNull(),
  event: text("event").notNull(),
  target: integer("target").notNull(),
  progress: integer("progress").notNull().default(0),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  claimedAt: text("claimed_at"),
}, (t) => [primaryKey({ columns: [t.userId, t.scrollId, t.period] }), index("quest_scrolls_event").on(t.userId, t.event)]);

export const dailyActionCounts = sqliteTable("daily_action_counts", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: text("action_date").notNull(),
  actionType: text("action_type").notNull(),
  count: integer("count").notNull().default(0),
  lastTs: text("last_ts"),
}, (t) => [primaryKey({ columns: [t.userId, t.day, t.actionType] })]);

export const dailyQuests = sqliteTable("daily_quests", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: text("quest_date").notNull(),
  questType: text("quest_type").notNull(),
  targetCount: integer("target_count").notNull(),
  currentCount: integer("current_count").notNull().default(0),
  rewardXp: integer("reward_xp").notNull(),
  rewardCoins: integer("reward_coins").notNull(),
  completed: integer("completed").notNull().default(0),
  claimed: integer("claimed").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day, t.questType] })]);

export const userAchievements = sqliteTable("user_achievements", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  achievementId: text("achievement_id").notNull(),
  unlockedAt: text("unlocked_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.achievementId] })]);

export const userInventory = sqliteTable("user_inventory", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.userId, t.itemId] })]);

export const userBuffs = sqliteTable("user_buffs", {
  userId: integer("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  buffsJson: text("buffs_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

// ── the arena (Stage 4.5b: src/server/game/arena.ts, expedition.ts). The server decides every fight. ────────────
export const arenaBattles = sqliteTable("arena_battles", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  docHash: text("doc_hash").notNull(),
  topic: text("topic").notNull(),
  difficulty: text("difficulty").notNull(),
  boardKey: text("board_key").notNull(),
  bossJson: text("boss_json").notNull(),
  status: text("status").notNull().default("active"),
  phase: integer("phase").notNull().default(1),
  bossHp: integer("boss_hp").notNull(),
  bossMaxHp: integer("boss_max_hp").notNull(),
  playerHp: integer("player_hp").notNull(),
  playerMaxHp: integer("player_max_hp").notNull(),
  combo: integer("combo").notNull().default(0),
  maxCombo: integer("max_combo").notNull().default(0),
  answered: integer("answered").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  healsUsed: integer("heals_used").notNull().default(0),
  fiftyUsed: integer("fifty_used").notNull().default(0),
  activeMs: integer("active_ms").notNull().default(0),
  currentSeq: integer("current_seq"),
  genAttempts1: integer("gen_attempts_1").notNull().default(0),
  genAttempts2: integer("gen_attempts_2").notNull().default(0),
  rewardsJson: text("rewards_json"),
  resultJson: text("result_json"),
  mode: text("mode").notNull().default("quick"),
  runId: text("run_id"),
  /** Stage 6: the Boss Rush / Survival this fight belongs to. */
  gauntletId: text("gauntlet_id"),
  focus: integer("focus").notNull().default(0),
  focusCap: integer("focus_cap").notNull().default(5),
  shield: integer("shield").notNull().default(0),
  intentJson: text("intent_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  finishedAt: text("finished_at"),
}, (t) => [
  index("arena_battles_user_idx").on(t.userId, t.createdAt), index("arena_battles_run_idx").on(t.runId), index("arena_battles_gauntlet_idx").on(t.gauntletId),
  uniqueIndex("arena_battles_active_idx").on(t.userId, t.sessionId).where(sql`status = 'active'`),
]);

export const arenaQuestions = sqliteTable("arena_questions", {
  battleId: text("battle_id").notNull().references(() => arenaBattles.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  phase: integer("phase").notNull(),
  conceptKey: text("concept_key").notNull(),
  textKey: text("text_key").notNull(),
  questionJson: text("question_json").notNull(),
  status: text("status").notNull().default("queued"),
  optionsJson: text("options_json"),
  removedJson: text("removed_json"),
  issuedAt: text("issued_at"),
  deadlineAt: text("deadline_at"),
  answer: text("answer"),
  correct: integer("correct"),
  timedOut: integer("timed_out"),
  answeredAt: text("answered_at"),
  outcomeJson: text("outcome_json"),
  move: text("move"),
  timewarped: integer("timewarped").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.battleId, t.seq] }), index("arena_questions_pool_idx").on(t.battleId, t.phase, t.status)]);

export const arenaScores = sqliteTable("arena_scores", {
  battleId: text("battle_id").primaryKey().references(() => arenaBattles.id, { onDelete: "cascade" }),
  boardKey: text("board_key").notNull(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  topic: text("topic").notNull(),
  topicKey: text("topic_key").notNull(),
  difficulty: text("difficulty").notNull(),
  docHash: text("doc_hash").notNull(),
  grade: text("grade").notNull(),
  accuracy: integer("accuracy").notNull(),
  timeSeconds: integer("time_seconds").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("arena_scores_board_idx").on(t.topicKey, t.difficulty, t.docHash, t.accuracy, t.timeSeconds),
           index("arena_scores_global_idx").on(t.difficulty, t.createdAt)]);

export const arenaPersonalBests = sqliteTable("arena_personal_bests", {
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  boardKey: text("board_key").notNull(),
  battleId: text("battle_id").notNull(),
  grade: text("grade").notNull(),
  accuracy: integer("accuracy").notNull(),
  timeSeconds: integer("time_seconds").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.boardKey] })]);

export const arenaRuns = sqliteTable("arena_runs", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  docHash: text("doc_hash").notNull(),
  difficulty: text("difficulty").notNull(),
  seed: integer("seed").notNull(),
  actsJson: text("acts_json").notNull(),
  mapJson: text("map_json").notNull(),
  nemesisOk: integer("nemesis_ok").notNull().default(0),
  status: text("status").notNull().default("active"),
  act: integer("act").notNull().default(1),
  nodeId: text("node_id"),
  visitedJson: text("visited_json").notNull().default("[]"),
  hearts: integer("hearts").notNull(),
  maxHearts: integer("max_hearts").notNull(),
  gold: integer("gold").notNull().default(0),
  relicsJson: text("relics_json").notNull().default("[]"),
  flagsJson: text("flags_json").notNull().default("{}"),
  focusCap: integer("focus_cap").notNull().default(5),
  actFocusBonus: integer("act_focus_bonus").notNull().default(0),
  pendingJson: text("pending_json"),
  battleId: text("battle_id"),
  depth: integer("depth").notNull().default(0),
  battlesWon: integer("battles_won").notNull().default(0),
  answered: integer("answered").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  score: integer("score").notNull().default(0),
  rewardsJson: text("rewards_json"),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  finishedAt: text("finished_at"),
}, (t) => [
  index("arena_runs_user_idx").on(t.userId, t.createdAt), index("arena_runs_board_idx").on(t.docHash, t.status, t.score),
  index("arena_runs_finished_idx").on(t.finishedAt, t.score),
  uniqueIndex("arena_runs_active_idx").on(t.userId, t.sessionId).where(sql`status = 'active'`),
]);

// ── Boss Rush and Survival (Stage 6: src/server/game/gauntlet.ts). Fights in a row, hearts carried over; Boss Rush is
//    the three strongest creatures you've hunted, Survival bosses without end, matched to your power level. ──────────
export const arenaGauntlets = sqliteTable("arena_gauntlets", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  docHash: text("doc_hash").notNull(),
  kind: text("kind").notNull(),
  topic: text("topic").notNull(),
  status: text("status").notNull().default("active"),
  /** The power level when it started (the bosses are matched to it). */
  power: integer("power").notNull(),
  /** Bosses beaten so far. */
  stage: integer("stage").notNull().default(0),
  /** Boss Rush: the three bosses, in order ({species, difficulty, hp_scale, power}). */
  planJson: text("plan_json").notNull().default("[]"),
  hearts: integer("hearts").notNull(),
  maxHearts: integer("max_hearts").notNull(),
  battleId: text("battle_id"),
  score: integer("score").notNull().default(0),
  answered: integer("answered").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  /** The chests won ({at, size, coins, xp, items}). */
  chestsJson: text("chests_json").notNull().default("[]"),
  lastSpecies: text("last_species"),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  finishedAt: text("finished_at"),
}, (t) => [
  index("arena_gauntlets_user_idx").on(t.userId, t.createdAt), index("arena_gauntlets_board_idx").on(t.kind, t.status, t.score),
  uniqueIndex("arena_gauntlets_active_idx").on(t.userId, t.sessionId).where(sql`status = 'active'`),
]);

// ── billing (Stage 4.6: src/server/account/billing.ts). Razorpay subscriptions; each webhook event handled once. ────────
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  tier: text("tier").notNull(),
  period: text("period").notNull(),
  status: text("status").notNull(),
  shortUrl: text("short_url"),
  currentStart: text("current_start"),
  currentEnd: text("current_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("subscriptions_user_idx").on(t.userId, t.createdAt)]);

export const paymentEvents = sqliteTable("payment_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  event: text("event").notNull(),
  subscriptionId: text("subscription_id"),
  receivedAt: text("received_at").notNull(),
});
