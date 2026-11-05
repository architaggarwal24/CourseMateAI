import { slotTarget } from "./ai/models";
// GET /api/system/status: is everything the Worker needs wired up? Only yes/no answers, nothing secret.
export interface PartStatus { ok: boolean; detail?: string }
export interface SystemStatus {
  ok: boolean;
  runtime: "cloudflare" | "node";
  database?: PartStatus;
  storage?: PartStatus;
  /** Search: Workers AI (AI) and Vectorize (VECTORS) bound. */
  search?: PartStatus;
  /** The server's AI: at least one API model (LLM_FAST + its key); Workers AI alone also works. */
  ai?: PartStatus;
  /** Accounts: BETTER_AUTH_SECRET set (and OWNER_EMAIL, so there is an admin). */
  accounts?: PartStatus;
}

type Bindings = Pick<CloudflareEnv, "DB" | "FILES"> & Partial<Pick<CloudflareEnv, "AI" | "VECTORS">>;

async function checkDatabase(db: D1Database | undefined): Promise<PartStatus> {
  if (!db) return { ok: false, detail: "no D1 binding named DB" };
  try {
    const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").first();
    return row ? { ok: true } : { ok: false, detail: "not migrated: run npm run db:migrate:remote" };
  } catch {
    return { ok: false, detail: "the database did not answer" };
  }
}

export function checkAccounts(settings: Record<string, string | undefined>): PartStatus {
  if ((settings.BETTER_AUTH_SECRET || "").trim().length < 32) return { ok: false, detail: "set BETTER_AUTH_SECRET (32+ characters)" };
  if (!(settings.OWNER_EMAIL || "").trim()) return { ok: true, detail: "no OWNER_EMAIL: nobody is the admin" };
  return { ok: true };
}

export function checkAi(settings: Record<string, string | undefined>): PartStatus {
  const api = slotTarget("fast", settings) ?? slotTarget("strong", settings) ?? slotTarget("premium", settings);
  return api ? { ok: true, detail: `${api.provider}:${api.model}` }
    : { ok: true, detail: "Workers AI only: set LLM_FAST (e.g. gemini:gemini-3.5-flash-lite) and its key for better answers" };
}

export async function systemStatus(
  env: Bindings | null,
  { settings = process.env }: { settings?: Record<string, string | undefined> } = {},
): Promise<SystemStatus> {
  if (!env) return { ok: false, runtime: "node" };
  const database = await checkDatabase(env.DB);
  const storage: PartStatus = env.FILES ? { ok: true } : { ok: false, detail: "no R2 binding named FILES" };
  const accounts = checkAccounts(settings);
  const ai = checkAi(settings);
  const search: PartStatus = env.AI && env.VECTORS ? { ok: true }
    : { ok: false, detail: "bind Workers AI (AI) and the Vectorize index (VECTORS): see docs/deploy-cloudflare.md" };
  return { ok: database.ok && storage.ok && accounts.ok && search.ok, runtime: "cloudflare", database, storage, search, ai, accounts };
}
