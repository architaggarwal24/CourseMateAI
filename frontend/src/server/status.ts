// GET /api/system/status: is everything the Worker needs wired up? Only yes/no answers, nothing secret.
export interface PartStatus { ok: boolean; detail?: string }
export interface SystemStatus {
  ok: boolean;
  runtime: "cloudflare" | "node";
  database?: PartStatus;
  storage?: PartStatus;
  /** Search: Workers AI (AI) and Vectorize (VECTORS) bound. */
  search?: PartStatus;
  /** Accounts: BETTER_AUTH_SECRET set (and OWNER_EMAIL, so there is an admin). */
  accounts?: PartStatus;
  backend: { configured: boolean; ok: boolean };
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

async function checkBackend(url: string, fetchImpl: typeof fetch): Promise<SystemStatus["backend"]> {
  if (!url) return { configured: false, ok: false };
  try {
    const res = await fetchImpl(`${url}/api/v1/health`, { signal: AbortSignal.timeout(5_000) });
    return { configured: true, ok: res.ok };
  } catch {
    return { configured: true, ok: false };
  }
}

export function checkAccounts(settings: Record<string, string | undefined>): PartStatus {
  if ((settings.BETTER_AUTH_SECRET || "").trim().length < 32) return { ok: false, detail: "set BETTER_AUTH_SECRET (32+ characters)" };
  if (!(settings.OWNER_EMAIL || "").trim()) return { ok: true, detail: "no OWNER_EMAIL: nobody is the admin" };
  return { ok: true };
}

export async function systemStatus(
  env: Bindings | null,
  { backendUrl, fetchImpl = fetch, settings = process.env }: { backendUrl: string; fetchImpl?: typeof fetch; settings?: Record<string, string | undefined> },
): Promise<SystemStatus> {
  const backend = await checkBackend(backendUrl, fetchImpl);
  if (!env) return { ok: backend.ok, runtime: "node", backend };
  const database = await checkDatabase(env.DB);
  const storage: PartStatus = env.FILES ? { ok: true } : { ok: false, detail: "no R2 binding named FILES" };
  const accounts = checkAccounts(settings);
  const search: PartStatus = env.AI && env.VECTORS ? { ok: true }
    : { ok: false, detail: "bind Workers AI (AI) and the Vectorize index (VECTORS): see docs/deploy-cloudflare.md" };
  // The backend is on its way out, so it doesn't decide whether the Worker is healthy.
  return { ok: database.ok && storage.ok && accounts.ok && search.ok, runtime: "cloudflare", database, storage, search, accounts, backend };
}
