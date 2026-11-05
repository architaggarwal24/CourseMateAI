// Is the Worker wired up? (database, file storage, search, AI, accounts)
import { getEnv } from "@/server/env";
import { systemStatus } from "@/server/status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const status = await systemStatus(await getEnv());
  return Response.json(status, { status: status.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
