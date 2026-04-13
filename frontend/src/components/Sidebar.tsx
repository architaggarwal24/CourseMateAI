"use client";

import { Clock, MessageSquare, HelpCircle, FileText, Swords, ShoppingBag, Package, Flame, Layers, Trophy } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import HUD from "./HUD";
import QuestPanel from "./QuestPanel";
import ActiveBuffsSidebar from "./ActiveBuffsSidebar";
import UserMenu from "./UserMenu";
import { useHUDStore } from "@/hooks/useHUD";

export type Mode = "chat" | "quiz" | "flashcards" | "notes" | "arena" | "history" | "achievements";

interface SidebarProps {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

export default function Sidebar({ mode, setMode }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const streakDays = useHUDStore((s) => s.streakDays);
  const streakFreezes = useHUDStore((s) => s.streakFreezes);

  const isShopPage = pathname === "/shop";
  const isInventoryPage = pathname === "/inventory";

  const navigationItems = [
    { id: "chat", icon: MessageSquare, label: "Chat" },
    { id: "quiz", icon: HelpCircle, label: "Quiz" },
    { id: "flashcards", icon: Layers, label: "Flashcards" },
    { id: "notes", icon: FileText, label: "Notes" },
    { id: "arena", icon: Swords, label: "Arena" },
  ];

  const handleNavClick = (id: string) => {
    if (pathname !== "/") router.push("/");
    setMode(id as Mode);
  };

  return (
    <aside className="w-80 bg-bg-secondary border-r-4 border-border-subtle flex flex-col retro-panel">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll flex flex-col">

        {/* Header — centred */}
        <div className="px-4 pt-5 pb-4 border-b-4 border-border-subtle bg-gradient-to-b from-accent-purple/10 to-transparent">
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-gradient-to-br from-accent-gold to-accent-purple rounded-xl flex items-center justify-center border-2 border-accent-gold/50 shadow-lg shadow-accent-gold/20">
              <span className="text-white font-black pixel-font text-sm">CM</span>
            </div>
            <h1 className="text-xl font-black text-text-primary pixel-font tracking-wide">CourseMateAI</h1>
          </div>
        </div>

        {/* HUD */}
        <HUD />

        {/* Streak row */}
        <div className="px-4 py-2.5 border-b-4 border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame size={16} className={streakDays > 0 ? "text-orange-400" : "text-text-muted"} />
            <span className={`text-sm font-bold pixel-font ${streakDays > 0 ? "text-orange-400" : "text-text-muted"}`}>
              {streakDays} day streak
            </span>
          </div>
          {streakFreezes > 0 && (
            <span
              className="text-xs text-accent-blue flex items-center gap-1 cursor-help"
              title="Streak Shield — automatically used when you miss a day. No action needed."
            >
              🧊 ×{streakFreezes}
            </span>
          )}
        </div>

        {/* Active Buffs — below streak */}
        <div className="px-4 py-2 border-b-4 border-border-subtle">
          <ActiveBuffsSidebar />
        </div>

        {/* Study Modes */}
        <div className="px-4 py-3 border-b-4 border-border-subtle">
          <p className="text-xs text-text-muted mb-2 pixel-font uppercase tracking-wide">Study Modes</p>
          <div className="space-y-1">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = !isShopPage && !isInventoryPage && mode === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all border-2 pixel-font text-sm ${
                    isActive
                      ? "bg-accent-gold/20 border-accent-gold text-accent-gold shadow-lg"
                      : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary hover:border-border"
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* History & Achievements */}
        <div className="px-4 py-3 border-b-4 border-border-subtle space-y-1">
          <p className="text-xs text-text-muted mb-2 pixel-font uppercase tracking-wide">Progress</p>
          <button
            onClick={() => handleNavClick("history")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all border-2 pixel-font text-sm ${
              !isShopPage && !isInventoryPage && mode === "history"
                ? "bg-accent-gold/20 border-accent-gold text-accent-gold shadow-lg"
                : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary hover:border-border"
            }`}
          >
            <Clock size={18} /><span>Session History</span>
          </button>
          <button
            onClick={() => handleNavClick("achievements")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all border-2 pixel-font text-sm ${
              !isShopPage && !isInventoryPage && mode === "achievements"
                ? "bg-accent-gold/20 border-accent-gold text-accent-gold shadow-lg"
                : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary hover:border-border"
            }`}
          >
            <Trophy size={18} /><span>Achievements</span>
          </button>
        </div>

        {/* Gear & Items */}
        <div className="px-4 py-3 border-b-4 border-border-subtle">
          <p className="text-xs text-text-muted mb-2 pixel-font uppercase tracking-wide">Gear & Items</p>
          <div className="space-y-1">
            <button
              onClick={() => router.push("/shop")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all border-2 pixel-font text-sm ${
                isShopPage
                  ? "bg-accent-gold/20 border-accent-gold text-accent-gold shadow-lg"
                  : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary hover:border-border"
              }`}
            >
              <ShoppingBag size={18} /><span>Shop</span>
            </button>
            <button
              onClick={() => router.push("/inventory")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all border-2 pixel-font text-sm ${
                isInventoryPage
                  ? "bg-accent-purple/20 border-accent-purple text-accent-purple shadow-lg"
                  : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary hover:border-border"
              }`}
            >
              <Package size={18} /><span>Inventory</span>
            </button>
          </div>

        </div>

        {/* Daily Quests */}
        <div className="flex-1">
          <div className="border-b-4 border-border-subtle">
            <details className="group" open>
              <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between hover:bg-bg-hover transition-colors">
                <span className="text-xs text-text-muted pixel-font uppercase tracking-wide">Daily Quests</span>
                <span className="text-text-muted text-xs group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <QuestPanel />
            </details>
          </div>
        </div>
      </div>

      {/* Profile — pinned bottom */}
      <div className="border-t-4 border-border-subtle">
        <UserMenu />
      </div>
    </aside>
  );
}