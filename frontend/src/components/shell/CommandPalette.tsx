"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import {
  Backpack, BookOpen, Brain, CornerDownLeft, FileText, History, Layers, MessageSquare, Paintbrush, ScrollText,
  Search, Settings, ShoppingBag, Swords, Trophy, User, UserCircle,
} from "lucide-react";
import ThemeScope from "@/components/ThemeScope";
import { ROUTES } from "@/lib/routes";

interface Entry { id: string; label: string; hint?: string; href: string; icon: ReactNode; keywords?: string[] }

const GROUPS: { heading: string; items: Entry[] }[] = [
  {
    heading: "Study",
    items: [
      { id: "chat", label: "Chat with your document", href: ROUTES.studyTab("chat"), icon: <MessageSquare size={16} />, keywords: ["ask", "pdf"] },
      { id: "quiz", label: "Generate a quiz", href: ROUTES.studyTab("quiz"), icon: <Brain size={16} />, keywords: ["mcq", "test"] },
      { id: "notes", label: "Study notes", href: ROUTES.studyTab("notes"), icon: <FileText size={16} /> },
      { id: "flashcards", label: "Flashcards", href: ROUTES.studyTab("flashcards"), icon: <Layers size={16} />, keywords: ["cards", "review"] },
    ],
  },
  {
    heading: "Hero",
    items: [
      { id: "arena", label: "Battle Arena", hint: "Fight a boss", href: ROUTES.heroArena, icon: <Swords size={16} />, keywords: ["boss", "fight", "battle", "expedition"] },
      { id: "quests", label: "Daily quests", href: ROUTES.heroQuests, icon: <ScrollText size={16} /> },
      { id: "shop", label: "Shop", href: ROUTES.heroShop, icon: <ShoppingBag size={16} />, keywords: ["buy", "gear", "potion"] },
      { id: "inventory", label: "Inventory", href: ROUTES.heroInventory, icon: <Backpack size={16} /> },
      { id: "avatar", label: "Avatar", href: ROUTES.heroAvatar, icon: <User size={16} /> },
      { id: "forge", label: "Hero Forge", href: ROUTES.heroForge, icon: <Paintbrush size={16} />, keywords: ["customize", "look"] },
      { id: "achievements", label: "Achievements", href: ROUTES.heroAchievements, icon: <Trophy size={16} /> },
    ],
  },
  {
    heading: "Account",
    items: [
      { id: "profile", label: "Profile", href: ROUTES.account, icon: <UserCircle size={16} /> },
      { id: "history", label: "History", href: ROUTES.accountHistory, icon: <History size={16} /> },
      { id: "settings", label: "Settings", hint: "API key, appearance", href: ROUTES.accountSettings, icon: <Settings size={16} />, keywords: ["key", "provider", "theme"] },
    ],
  },
];

/** Open the palette from anywhere (the sidebar's search button). */
export const openCommandPalette = () => window.dispatchEvent(new Event("cmai:command-palette"));

/**
 * ⌘K / Ctrl+K: jump anywhere in the app by typing. A Radix dialog (focus trap, Escape, focus return) around a cmdk
 * list (fuzzy filter, arrow keys, Enter). Always the Study look, whichever area it was opened from.
 */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      // Another dialog owns the keyboard: two focus traps would fight. (The palette's own dialog may toggle itself.)
      const other = document.querySelector('[aria-modal="true"]:not(.cmdk-dialog)');
      if (other) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("cmai:command-palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("cmai:command-palette", onOpen); };
  }, []);

  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <ThemeScope theme="study">
          <Dialog.Overlay className="cmdk-overlay" />
          <Dialog.Content className="cmdk-dialog" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Go to</Dialog.Title>
            <Command label="Go to" loop>
              <div className="cmdk-input-row">
                <Search size={16} aria-hidden="true" />
                <Command.Input className="cmdk-input" placeholder="Where to? Try “quiz”, “arena”, “settings”…" autoFocus />
                <kbd className="kbd">Esc</kbd>
              </div>
              <Command.List className="cmdk-list">
                <Command.Empty className="cmdk-empty">Nothing matches that.</Command.Empty>
                {GROUPS.map((g) => (
                  <Command.Group key={g.heading} heading={g.heading} className="cmdk-group">
                    {g.items.map((it) => (
                      <Command.Item key={it.id} value={`${it.label} ${g.heading}`} keywords={it.keywords} onSelect={() => go(it.href)} className="cmdk-item">
                        <span className="cmdk-item__icon" aria-hidden="true">{it.icon}</span>
                        <span className="cmdk-item__label">{it.label}</span>
                        {it.hint && <span className="cmdk-item__hint">{it.hint}</span>}
                        <CornerDownLeft size={14} className="cmdk-item__enter" aria-hidden="true" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
              <div className="cmdk-foot" aria-hidden="true">
                <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
                <span><kbd className="kbd">↵</kbd> open</span>
                <span className="cmdk-foot__brand"><BookOpen size={12} /> CourseMateAI</span>
              </div>
            </Command>
          </Dialog.Content>
        </ThemeScope>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
