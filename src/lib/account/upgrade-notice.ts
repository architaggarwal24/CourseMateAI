// After an invite code or a payment on this screen: show the "you've been upgraded" window now (it replaces the
// success toast). If there's nothing to celebrate (the plan didn't change), the toast says what happened instead.
import { rawApi } from "@/lib/api/client";
import { useHUDStore } from "@/hooks/useHUD";
import type { PlanNotice } from "@/lib/account/plan-notice";
import { toast } from "@/components/ui";

export async function showUpgradeNow(fallback: string): Promise<void> {
  try {
    const { data } = await rawApi.GET("/account/plan-notice");
    const notice = (data?.plan_notice ?? null) as PlanNotice | null;
    if (notice) { useHUDStore.setState({ planNotice: notice }); return; }
  } catch { /* offline: the toast below, and the window next time the app asks */ }
  if (fallback) toast.success(fallback);
}
