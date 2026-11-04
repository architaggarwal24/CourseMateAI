// Is the Worker wired up? (database, file storage, the Python backend still being moved)
import { backendUrl } from "@/server/config";
import { getEnv } from "@/server/env";
import { systemStatus } from "@/server/status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const status = await systemStatus(await getEnv(), { backendUrl: backendUrl() });
  return Response.json(status, { status: status.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
