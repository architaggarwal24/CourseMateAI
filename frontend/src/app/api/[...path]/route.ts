// Every /api call no route of the Worker's own answers goes on to the Python backend (src/server/proxy.ts).
// A route moved to TypeScript (src/app/api/v1/...) is more specific than this one, so it wins.
import { backendUrl, proxySecret } from "@/server/config";
import { proxyToBackend } from "@/server/proxy";

export const dynamic = "force-dynamic";

function handle(req: Request): Promise<Response> {
  return proxyToBackend(req, { backendUrl: backendUrl(), proxySecret: proxySecret() });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
