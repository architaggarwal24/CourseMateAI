import { acceptTerms } from "@/server/auth/account";
import { requireUser } from "@/server/context";
import { readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

/** Accept the current Terms of Service and Privacy Policy (recorded with the date and version). */
export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  const body = await readJson<{ version?: unknown }>(req).catch(() => ({} as { version?: unknown }));
  return acceptTerms(ctx, u, body.version);
});
