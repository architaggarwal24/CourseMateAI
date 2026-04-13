"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useHUDStore } from "@/hooks/useHUD";

const Sidebar = dynamic(() => import("@/components/Sidebar"), { ssr: false });
const ChatView = dynamic(() => import("@/components/ChatView"), { ssr: false });
const QuizView = dynamic(() => import("@/components/QuizView"), { ssr: false });
const NotesView = dynamic(() => import("@/components/NotesView"), { ssr: false });
const ArenaView = dynamic(() => import("@/components/ArenaView"), { ssr: false });

export type Mode = "chat" | "quiz" | "notes" | "arena";

export default function Home() {
  const [mode, setMode] = useState<Mode>("chat");
  const [mounted, setMounted] = useState(false);
  const init = useHUDStore((s) => s.init);
  const refresh = useHUDStore((s) => s.refresh);

  useEffect(() => {
    init();
    setMounted(true);
  }, [init]);

  useEffect(() => {
    if (mounted) {
      refresh();
    }
  }, [mounted, refresh]);

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary">
        <div className="text-text-muted text-sm animate-pulse">
          Loading CourseMateAI...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mode={mode} setMode={setMode} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {mode === "chat" && <ChatView />}
        {mode === "quiz" && <QuizView />}
        {mode === "notes" && <NotesView />}
        {mode === "arena" && <ArenaView />}
      </main>
    </div>
  );
}