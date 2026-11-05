"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ChevronsUpDown, LogIn, LogOut, Settings, Sparkles, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useHUDStore } from "@/hooks/useHUD";
import ChampionAvatar from "@/components/champion/ChampionAvatar";
import ThemeScope from "@/components/ThemeScope";
import { useChampion } from "@/hooks/useChampion";
import { useHeroStore } from "@/hooks/useHero";
import { heroById } from "@/lib/pixel/heroes";
import { ROUTES } from "@/lib/routes";

/**
 * The signed-in user at the foot of the sidebar: their pixel champion, name, level and XP progress. Opens an account
 * menu (Radix dropdown: arrow keys, Escape, focus return) with Champion, Settings and Log out. A visitor gets a
 * log-in row. Mounting it (it is always in the shell) loads the account's champion and skins.
 */
export default function UserMenu() {
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const level = useHUDStore((s) => s.level);
  const loadChampion = useChampion((s) => s.load);
  const championName = useChampion((s) => heroById(s.championId).name);
  const xpInto = useHUDStore((s) => s.xpInto);
  const xpToNext = useHUDStore((s) => s.xpToNext);

  useEffect(() => {
    if (authLoading) return;
    void loadChampion({ signedIn: !!user, force: true });
    if (user && !useHeroStore.getState().shop) void useHeroStore.getState().loadShop();   // the skins it wears
  }, [user, loadChampion, authLoading]);

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
  const face = <ChampionAvatar size={40} />;

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
              <span className="umenu__face umenu__face--lg" aria-hidden="true"><ChampionAvatar size={48} /></span>
              <span className="min-w-0">
                <span className="block text-xs text-fg-muted">Signed in as</span>
                <span className="block truncate text-sm font-semibold text-fg">{name}</span>
                {user.username && <span className="block truncate text-xs text-fg-muted">@{user.username}</span>}
                <span className="block truncate text-xs text-fg-2">Champion: {championName}</span>
              </span>
            </div>
            <DropdownMenu.Item className="umenu__item" onSelect={() => router.push(ROUTES.account)}>
              <User size={16} aria-hidden="true" />Profile
            </DropdownMenu.Item>
            <DropdownMenu.Item className="umenu__item" onSelect={() => router.push(ROUTES.heroChampion)}>
              <Sparkles size={16} aria-hidden="true" />Champion
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
