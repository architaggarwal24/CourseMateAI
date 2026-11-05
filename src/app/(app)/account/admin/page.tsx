"use client";

import AdminPanel from "@/components/account/AdminPanel";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <AdminPanel />;
}
