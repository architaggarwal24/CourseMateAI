// Razorpay's events. No login and no same-site check (Razorpay calls it): the X-Razorpay-Signature is the proof.
import { webhook } from "@/server/billing";
import { requestContext } from "@/server/context";
import { clientIp, handle, rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => handle(async () => {
  const ctx = await requestContext(req);
  await rateLimit(ctx.db, `billing-webhook:${clientIp(req)}`, 300, 60);
  const body = new Uint8Array(await req.arrayBuffer());
  const out = await webhook(ctx, body, req.headers.get("x-razorpay-signature") ?? "", req.headers.get("x-razorpay-event-id") ?? "");
  return Response.json(out, { headers: { "cache-control": "no-store" } });
});
