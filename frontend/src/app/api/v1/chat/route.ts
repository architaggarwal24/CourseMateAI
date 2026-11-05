// A question about the open document (or course), answered with numbered citations. /chat/stream streams it.
import { answerMessages, blockedText, finalPayload, logAnswer, planChat } from "@/server/chat";
import { generate } from "@/server/ai/run";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `chat:${u.id}`, 30, 60);
  const plan = await planChat(ctx, u, await readJson(req));
  if (plan.quality.blocked) return { ...finalPayload(plan, true), content: blockedText(plan.question) };
  const { text } = await generate(ctx, plan.caller, "strong", answerMessages(plan), { temperature: 0.3 });
  await logAnswer(ctx, plan, text);
  return { ...finalPayload(plan), content: text };
});
