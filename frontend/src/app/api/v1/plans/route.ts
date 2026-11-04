// Every plan (prices in INR, limits, features) and how sign-up works here. No login needed.
import { plansCatalog } from "@/server/plans";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async () => ({
  plans: plansCatalog(), invite_only: false, managed_ai: true,
  payments_enabled: false, currency: "INR",
}));
