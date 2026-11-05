// Account -> Plan & usage: the plan, its limits and what has been used (documents, courses, AI calls, tokens).
import { usageHistory, usedThisMonth, usedToday } from "./ai/usage";
import type { CurrentUser, RequestContext } from "./context";
import { courseCount } from "./courses";
import { documentCount } from "./documents";
import { usageSummary } from "./plans";

export async function accountUsage(ctx: RequestContext, u: CurrentUser) {
  const [documents, courses, today, month, history] = await Promise.all([
    documentCount(ctx, u.id), courseCount(ctx, u.id), usedToday(ctx.db, u.id), usedThisMonth(ctx.db, u.id), usageHistory(ctx.db, u.id),
  ]);
  return usageSummary(ctx.db, { id: u.id, owner: u.owner }, { documents, courses, ai_calls_day: today.ai_calls, tokens_month: month.tokens, history });
}
