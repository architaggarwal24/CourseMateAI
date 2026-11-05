// Better Auth's own endpoints (sign-up, sign-in, codes, Google, two-step): src/server/auth.
import { requestContext } from "@/server/context";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

function auth(req: Request): Promise<Response> {
  return handle(async () => (await requestContext(req)).auth.handler(req));
}

export { auth as GET, auth as POST };
