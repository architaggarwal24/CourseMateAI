// The answer as Server-Sent Events: `token` {text} as it is written, then `sources` {mode, sources, citations,
// blocked, needs_clarification, rewards}; a failure after the first token is an `error` event in the API's error
// shape. Before the first token, failures are ordinary HTTP errors.
import { afterAnswer, answerMessages, blockedText, finalPayload, planChat } from "@/server/chat";
import { stream } from "@/server/ai/run";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

const HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" };
const frame = (event: string, data: unknown) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `chat:${u.id}`, 30, 60);
  const plan = await planChat(ctx, u, await readJson(req));
  if (plan.quality.blocked) {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("token", { text: blockedText(plan.question) }));
        c.enqueue(frame("sources", finalPayload(plan, true)));
        c.close();
      },
    });
    return new Response(body, { headers: HEADERS });
  }
  const answer = await stream(ctx, plan.caller, "strong", answerMessages(plan), { temperature: 0.3 });
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      try {
        let text = "";
        for await (const piece of answer.pieces) { text += piece; c.enqueue(frame("token", { text: piece })); }
        c.enqueue(frame("sources", finalPayload(plan, false, await afterAnswer(ctx, plan, text))));
      } catch {
        c.enqueue(frame("error", { error: { code: "ai_request_failed", message: "The answer stopped part-way. Please try again.", action: "retry", details: null } }));
      } finally {
        c.close();
      }
    },
  });
  return new Response(body, { headers: HEADERS });
});
