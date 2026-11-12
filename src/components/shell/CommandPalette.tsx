"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import {
  Backpack, BookOpen, Brain, CornerDownLeft, FileText, Gauge, GraduationCap, History, Home, Layers, LogOut, MessageSquare,
  Crown, Hammer, Network, ScrollText, Repeat, Search, Settings, Shield, ShieldCheck, ShoppingBag, SunMoon, Swords, Trophy, User, UserCircle,
} from "@/components/ui/icons";
import ThemeScope from "@/components/ui/ThemeScope";
import { useAuth } from "@/contexts/AuthContext";
import { useShortcutLabel } from "@/hooks/useShortcutLabel";
import { ROUTES } from "@/lib/routes";
import { toggleMode } from "@/lib/theme";
import { PALETTE_EVENT, isPaletteKey } from "./CommandPaletteLoader";

/** A page to go to (`href`), or an action to run (`run`). */
interface Entry { id: string; label: string; hint?: string; href?: string; run?: "logout" | "theme"; icon: ReactNode; keywords?: string[]; adminOnly?: boolean }

const GROUPS: { heading: string; items: Entry[] }[] = [
  {
    heading: "Study",
    items: [
      { id: "today", label: "Today", hint: "Due reviews, where you left off", href: ROUTES.today, icon: <Home size={16} />, keywords: ["home", "dashboard", "start"] },
      { id: "chat", label: "Chat with your document", href: ROUTES.studyTab("chat"), icon: <MessageSquare size={16} />, keywords: ["ask", "pdf"] },
      { id: "quiz", label: "Generate a quiz", href: ROUTES.studyTab("quiz"), icon: <Brain size={16} />, keywords: ["mcq", "test"] },
      { id: "notes", label: "Study notes", href: ROUTES.studyTab("notes"), icon: <FileText size={16} /> },
      { id: "flashcards", label: "Flashcards", href: ROUTES.studyTab("flashcards"), icon: <Layers size={16} />, keywords: ["cards"] },
      { id: "map", label: "Concept map", hint: "How the ideas connect", href: ROUTES.studyTab("map"), icon: <Network size={16} />, keywords: ["graph", "constellation", "mastery"] },
      { id: "review", label: "Daily review", hint: "Spaced repetition", href: ROUTES.studyTab("review"), icon: <Repeat size={16} />, keywords: ["review", "due", "srs", "spaced", "repetition", "mistakes"] },
      { id: "exam", label: "Mock exam", hint: "Timed test", href: ROUTES.studyTab("exam"), icon: <GraduationCap size={16} />, keywords: ["exam", "test", "mock", "timed", "report"] },
    ],
  },
  {
    heading: "Play",
    items: [
      { id: "arena", label: "Battle Arena", hint: "Fight a boss", href: ROUTES.heroArena, icon: <Swords size={16} />, keywords: ["boss", "fight", "battle", "expedition"] },
      { id: "bestiary", label: "Bestiary", hint: "The book of creatures", href: ROUTES.heroBestiary, icon: <BookOpen size={16} />, keywords: ["creatures", "monsters", "bane", "lore", "book"] },
      { id: "quests", label: "Daily quests", href: ROUTES.heroQuests, icon: <ScrollText size={16} /> },
      { id: "shop", label: "Shop", href: ROUTES.heroShop, icon: <ShoppingBag size={16} />, keywords: ["buy", "gear", "potion"] },
      { id: "inventory", label: "Inventory", href: ROUTES.heroInventory, icon: <Backpack size={16} /> },
      { id: "champion", label: "Champion & skins", href: ROUTES.heroChampion, icon: <User size={16} />, keywords: ["avatar", "skin", "customize", "look", "outfit", "pet"] },
      { id: "forge", label: "Forge", hint: "Upgrade your gear", href: ROUTES.heroTab("forge"), icon: <Hammer size={16} />, keywords: ["upgrade", "tier", "materials", "mount", "saddle"] },
      { id: "achievements", label: "Achievements", href: ROUTES.heroAchievements, icon: <Trophy size={16} /> },
      { id: "mastery", label: "Mastery", hint: "Every champion's progress", href: ROUTES.heroMastery, icon: <Crown size={16} />, keywords: ["challenges", "mastery", "progress", "unlock"] },
    ],
  },
  {
    heading: "Account",
    items: [
      { id: "profile", label: "Profile", href: ROUTES.account, icon: <UserCircle size={16} /> },
      { id: "history", label: "History", href: ROUTES.accountHistory, icon: <History size={16} /> },
      { id: "usage", label: "Plan & usage", hint: "Limits, upgrade, documents", href: ROUTES.accountUsage, icon: <Gauge size={16} />, keywords: ["plan", "upgrade", "billing", "subscription", "invite", "limit"] },
      { id: "settings", label: "Settings", hint: "Appearance, app", href: ROUTES.accountSettings, icon: <Settings size={16} />, keywords: ["theme", "font", "animations", "install"] },
      { id: "security", label: "Security", hint: "Password, two-step", href: ROUTES.accountSecurity, icon: <ShieldCheck size={16} />, keywords: ["password", "2fa", "two-factor", "email"] },
      { id: "admin", label: "Admin", hint: "Accounts, plans, AI spend", href: ROUTES.accountAdmin, icon: <Shield size={16} />, keywords: ["users", "invite", "ban", "cap"], adminOnly: true },
    ],
  },
  {
    heading: "Actions",
    items: [
      { id: "theme", label: "Switch to light mode", run: "theme", icon: <SunMoon size={16} />, keywords: ["theme", "dark", "light", "mode", "appearance"] },
      { id: "logout", label: "Log out", run: "logout", icon: <LogOut size={16} />, keywords: ["log out", "logout", "exit"] },
    ],
  },
];

/** Open the palette from anywhere (the sidebar's search button). Kept here for callers that import it from this file. */
export { openCommandPalette } from "./CommandPaletteLoader";

/**
 * ⌘K / Ctrl+K: jump anywhere in the app by typing. A Radix dialog (focus trap, Escape, focus return) around a cmdk
 * list (fuzzy filter, arrow keys, Enter). Always the Study look, whichever area it was opened from.
 */
export default function CommandPalette({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  // CommandPaletteLoader mounts it on the first ⌘K or search click, already open.
  const [open, setOpen] = useState(defaultOpen);
  const toggleLabel = useShortcutLabel(["mod", "K"]);
  const isAdmin = !!(user as { is_admin?: boolean } | null)?.is_admin;

  useEffect(() => {
    // Another dialog owns the keyboard: two focus traps would fight. (The palette's own dialog may toggle itself.)
    const onKey = (e: KeyboardEvent) => { if (isPaletteKey(e)) { e.preventDefault(); setOpen((o) => !o); } };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(PALETTE_EVENT, onOpen); };
  }, []);

  // Read when the menu opens: what the switch would change to.
  const [lightNow, setLightNow] = useState(false);
  useEffect(() => { if (open) setLightNow(document.documentElement.dataset.mode === "light"); }, [open]);
  const labelOf = (it: Entry) => (it.run === "theme" ? `Switch to ${lightNow ? "dark" : "light"} mode` : it.label);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const choose = (it: Entry) => {
    if (it.href) { go(it.href); return; }
    setOpen(false);
    if (it.run === "logout") void logout();                             // (the same as the account menu's Log out)
    if (it.run === "theme") toggleMode();
  };

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
                    {g.items.filter((it) => !it.adminOnly || isAdmin).map((it) => (
                      <Command.Item key={it.id} value={`${labelOf(it)} ${g.heading}`} keywords={it.keywords} onSelect={() => choose(it)} className="cmdk-item">
                        <span className="cmdk-item__icon" aria-hidden="true">{it.icon}</span>
                        <span className="cmdk-item__label">{labelOf(it)}</span>
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
                <span><kbd className="kbd">{toggleLabel}</kbd> open / close</span>
                <span className="cmdk-foot__brand"><BookOpen size={12} /> CourseMateAI</span>
              </div>
            </Command>
          </Dialog.Content>
        </ThemeScope>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
