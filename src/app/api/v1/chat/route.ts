// A question about the open document (or course), answered with numbered citations. /chat/stream streams it.
import { afterAnswer, answerJob, answerMessages, answerTemperature, finalPayload, planChat } from "@/server/chat";
import { generate } from "@/server/ai/run";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `chat:${u.id}`, 30, 60);
  const plan = await planChat(ctx, u, await readJson(req));
  const { text } = await generate(ctx, plan.caller, answerJob(plan), answerMessages(plan), { temperature: answerTemperature(plan) });
  return { ...finalPayload(plan, false, await afterAnswer(ctx, plan, text)), content: text };
});
