"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useHUDStore } from "@/hooks/useHUD";
import { useAuth } from "@/contexts/AuthContext";

const Sidebar = dynamic(() => import("@/components/Sidebar"), { ssr: false });
const ChatView = dynamic(() => import("@/components/ChatView"), { ssr: false });
const QuizView = dynamic(() => import("@/components/QuizView"), { ssr: false });
const NotesView = dynamic(() => import("@/components/NotesView"), { ssr: false });
const ArenaView = dynamic(() => import("@/components/ArenaView"), { ssr: false });
const FlashcardView = dynamic(() => import("@/components/FlashcardView"), { ssr: false });
const HistoryView = dynamic(() => import("@/components/HistoryView"), { ssr: false });
const AchievementsView = dynamic(() => import("@/components/AchievementsView"), { ssr: false });

export type Mode = "chat" | "quiz" | "notes" | "arena" | "flashcards" | "history" | "achievements";

export default function Home() {
  const [mode, setMode] = useState<Mode>("chat");
  const [restoreSessionId, setRestoreSessionId] = useState<string | undefined>(undefined);
  const [mounted, setMounted] = useState(false);
  const { refresh, refreshIfStale } = useHUDStore((s) => ({ refresh: s.refresh, refreshIfStale: s.refreshIfStale }));
  const { loading: authLoading } = useAuth();

  // Single mount effect: initialise HUD and attach arena reward listener
  useEffect(() => {
    refresh();
    setMounted(true);

    // Listen for arena battle reward messages posted from arena.html (separate tab)
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "CMAI_BATTLE_REWARDS") {
        toast.success(`+${e.data.xp_gained} XP | +${e.data.coins_gained} Coins`, { icon: "⚔️" });
        refreshIfStale(0); // force refresh after battle completes
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHistoryNavigate = (targetMode: Mode, sessionId: string) => {
    // Store the session ID so the target view can restore it, then switch mode
    setRestoreSessionId(sessionId);
    setMode(targetMode);
  };

  // Clear restoreSessionId whenever user manually changes mode (not from history)
  const handleSetMode = (newMode: Mode) => {
    setRestoreSessionId(undefined);
    setMode(newMode);
  };

  if (authLoading || !mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-accent-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted text-sm">Loading CourseMateAI...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mode={mode} setMode={handleSetMode} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {mode === "chat"       && <ChatView       restoreSessionId={restoreSessionId} />}
        {mode === "quiz"       && <QuizView       restoreSessionId={restoreSessionId} />}
        {mode === "flashcards" && <FlashcardView  restoreSessionId={restoreSessionId} />}
        {mode === "notes"      && <NotesView      restoreSessionId={restoreSessionId} />}
        {mode === "arena"      && <ArenaView />}
        {mode === "history"       && <HistoryView onNavigate={handleHistoryNavigate} />}
        {mode === "achievements"  && <AchievementsView />}
      </main>
    </div>
  );
}