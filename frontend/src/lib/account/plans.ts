// Plans, usage and invite codes (backend routers/account.py; docs/archive/plans.md).
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/generated/schema";

export type Plan = components["schemas"]["PlanOut"];
export type PlansInfo = components["schemas"]["PlansResponse"];
export type Usage = components["schemas"]["UsageResponse"];
export type Tier = "apprentice" | "scholar" | "sage" | "archmage";
export const TIERS: Tier[] = ["apprentice", "scholar", "sage", "archmage"];

let plansOnce: Promise<PlansInfo> | null = null;

/** Every plan and how signup works on this server. Public; asked once per page load. */
export function fetchPlans(force = false): Promise<PlansInfo> {
  if (!plansOnce || force) {
    plansOnce = api.GET("/plans").then(({ data }) => data as PlansInfo);
    plansOnce.catch(() => { plansOnce = null; });
  }
  return plansOnce;
}

/** For tests: ask the server again next time. */
export function resetPlansCache() { plansOnce = null; }

export async function fetchUsage(): Promise<Usage> {
  const { data } = await api.GET("/account/usage");
  return data as Usage;
}

export async function redeemCode(code: string): Promise<Usage> {
  const { data } = await api.POST("/account/redeem", { body: { code } });
  return data as Usage;
}

export async function deleteDocument(id: string): Promise<void> {
  await api.DELETE("/documents/{document_id}", { params: { path: { document_id: id } } });
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatInr = (n: number) => inr.format(n);
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const formatCount = (n: number) => (n < 10_000 ? n.toLocaleString("en-US") : compact.format(n));

/** How full a meter is: ok below 80%, near at 80%+, full at 100%. */
export function fill(used: number, allowed: number): { share: number; state: "ok" | "near" | "full" } {
  if (allowed <= 0) return { share: used > 0 ? 1 : 0, state: used > 0 ? "full" : "ok" };
  const share = Math.min(1, used / allowed);
  return { share, state: share >= 1 ? "full" : share >= 0.8 ? "near" : "ok" };
}

/** "in 5 h" / "in 12 min" / "on 1 Dec" until a reset. */
export function untilText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${h} h`;
  return `on ${new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}
