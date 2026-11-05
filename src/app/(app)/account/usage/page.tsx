"use client";

import PlanUsage from "@/components/account/PlanUsage";
import { useAuth } from "@/contexts/AuthContext";

export default function UsagePage() {
  const { user } = useAuth();
  if (!user) return null;
  return <PlanUsage />;
}
