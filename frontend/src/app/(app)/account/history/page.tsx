"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ROUTES, isStudyTab } from "@/lib/routes";

const HistoryView = dynamic(() => import("@/components/HistoryView"), { ssr: false });

export default function HistoryPage() {
  const router = useRouter();
  // Opening a saved session reopens it in its Study tab.
  return (
    <HistoryView
      onNavigate={(mode, sessionId) => router.push(ROUTES.studyTab(isStudyTab(mode) ? mode : "chat", sessionId))}
    />
  );
}
