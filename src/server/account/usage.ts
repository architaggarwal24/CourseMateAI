// Account -> Plan & usage: the plan, its limits and what has been used (documents, courses, AI calls, tokens), today's
// AI budget and the Mana wallet with the packs on sale.
import { usageHistory, usageToday, usedThisMonth } from "../ai/usage";
import { OCR_PAGES_DAY } from "../study/ocr-limits";
import type { CurrentUser, RequestContext } from "../context";
import { courseCount } from "../study/courses";
import { documentCount } from "../study/documents";
import { usageSummary } from "./plans";
import { allowanceToday } from "../ai/budget";
import { provider } from "./billing";
import { PACKS, toMana } from "./wallet";

export async function accountUsage(ctx: RequestContext, u: CurrentUser) {
  const [documents, courses, today, month, history] = await Promise.all([
    documentCount(ctx, u.id), courseCount(ctx, u.id), usageToday(ctx.db, u.id), usedThisMonth(ctx.db, u.id), usageHistory(ctx.db, u.id),
  ]);
  const summary = await usageSummary(ctx.db, { id: u.id, owner: u.owner }, { documents, courses, ai_calls_day: today.ai_calls, tokens_month: month.tokens, history });
  const allowance = await allowanceToday(ctx.db, { id: u.id, owner: u.owner, tier: summary.tier });
  return {
    ...summary,
    // today's AI budget (ai/budget.ts) as a share, not dollars; past it a lighter model answers, or Mana pays
    ai_budget: { limited: allowance.limit_usd !== null, share: allowance.share, resets_at: summary.resets.ai_calls_day },
    // scanned pages and photos the AI read today (study/ocr.ts); null allowed: no cap (the owner)
    ocr: { used: today.ocr_pages, allowed: u.owner ? null : OCR_PAGES_DAY[summary.tier], resets_at: summary.resets.ai_calls_day },
    mana: {
      balance: toMana(allowance.wallet_micro),
      can_buy: summary.tier !== "apprentice",
      payments_enabled: !!provider(),
      packs: PACKS.map((p) => ({ id: p.id, name: p.name, inr: p.inr, mana: p.mana })),
    },
  };
}
