"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ChevronsUpDown, LogIn, LogOut, Settings, Sparkles, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useHUDStore } from "@/hooks/useHUD";
import { HeroFace } from "@/components/avatar";
import ThemeScope from "@/components/ThemeScope";
import { lookFromEquipped } from "@/lib/avatar/look";
import { rawApi } from "@/lib/api";
import { ROUTES } from "@/lib/routes";

/**
 * The signed-in user at the foot of the sidebar: their face, name, level and XP progress. Opens an account menu
 * (Radix dropdown: arrow keys, Escape, focus return) with Avatar, Settings and Log out. A visitor gets a log-in row.
 */
export default function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [equipped, setEquipped] = useState<Record<string, string> | null>(null);
  const level = useHUDStore((s) => s.level);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    rawApi.GET("/shop").then(({ data, response }) => {
      if (alive && response.ok) setEquipped((data as { equipped?: Record<string, string> } | undefined)?.equipped ?? {});
    }).catch(() => { /* the face is optional: the initial shows instead */ });
    return () => { alive = false; };
  }, [user]);

  if (!user) {
    return (
      <button type="button" onClick={() => router.push(ROUTES.login)} className="umenu umenu--guest">
        <span className="umenu__face umenu__face--guest" aria-hidden="true"><LogIn size={18} /></span>
        <span className="umenu__who">
          <span className="umenu__name">Log in / Sign up</span>
          <span className="umenu__handle">Save your progress</span>
        </span>
      </button>
    );
  }

  const name = user.full_name || user.username || user.email;
  const pct = xpToNext > 0 ? Math.min(100, Math.round((xpInto / xpToNext) * 100)) : 0;
  const face = equipped
    ? <HeroFace look={lookFromEquipped(equipped)} diameter={40} />
    : <span className="umenu__initial">{(user.username?.[0] ?? "U").toUpperCase()}</span>;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="umenu">
        <span className="umenu__face" aria-hidden="true">{face}</span>
        <span className="umenu__who">
          <span className="umenu__name">{name}</span>
          <span className="umenu__handle">
            <span className="umenu__lvl">Lv {level}</span>
            <span className="umenu__xp" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
          </span>
        </span>
        <span className="sr-only">: account menu</span>
        <ChevronsUpDown size={15} className="umenu__chev" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <ThemeScope theme="study">
          <DropdownMenu.Content side="top" align="start" sideOffset={8} className="umenu__menu">
            <div className="umenu__head">
              <span className="umenu__face umenu__face--lg" aria-hidden="true">{equipped ? <HeroFace look={lookFromEquipped(equipped)} diameter={48} /> : face}</span>
              <span className="min-w-0">
                <span className="block text-xs text-fg-muted">Signed in as</span>
                <span className="block truncate text-sm font-semibold text-fg">{name}</span>
                {user.username && <span className="block truncate text-xs text-fg-muted">@{user.username}</span>}
              </span>
            </div>
            <DropdownMenu.Item className="umenu__item" onSelect={() => router.push(ROUTES.account)}>
              <User size={16} aria-hidden="true" />Profile
            </DropdownMenu.Item>
            <DropdownMenu.Item className="umenu__item" onSelect={() => router.push(ROUTES.heroAvatar)}>
              <Sparkles size={16} aria-hidden="true" />Avatar
            </DropdownMenu.Item>
            <DropdownMenu.Item className="umenu__item" onSelect={() => router.push(ROUTES.accountSettings)}>
              <Settings size={16} aria-hidden="true" />Settings
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="umenu__sep" />
            <DropdownMenu.Item className="umenu__item umenu__item--danger" onSelect={() => logout()}>
              <LogOut size={16} aria-hidden="true" />Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </ThemeScope>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
