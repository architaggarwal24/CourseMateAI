"use client";

import { useEffect } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { useReview } from "@/hooks/useReview";
import { useRevalidate } from "@/hooks/useRevalidate";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ThemeScope from "@/components/ThemeScope";
import { areaOf } from "@/lib/routes";
import NavSidebar from "./NavSidebar";
import BottomNav from "./BottomNav";
import CommandPalette from "./CommandPaletteLoader";
import dynamic from "next/dynamic";
import CoinRain from "@/components/fx/CoinRain";
import AchievementBanner from "@/components/fx/AchievementBanner";

// the level-up screen draws the champion (the pixel engine): loaded on its own, only for a signed-in player
const LevelUpCeremony = dynamic(() => import("@/components/fx/LevelUpCeremony"), { ssr: false });
import "./shell.css";

/**
 * The frame around Study, Hero and Account: the sectioned sidebar on desktop (it collapses to an icon rail), a tab
 * bar along the bottom on phones, the screen in between. The frame always stays in the Study theme (light or dark, as
 * chosen); in Hero only the screen switches to Play, so the sidebar does not flip from light to dark.
 * It also keeps what the old home page kept for the whole session: the HUD refresh (and the review queue's due count).
 * ⌘K opens the command palette.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const loadHud = useHUDStore((s) => s.load);
  const area = areaOf(usePathname());
  const play = area === "hero";

  // Starts GET /hud at once, alongside the sign-in check (AuthProvider reuses this request instead of asking again
  // after /auth/me answers). Coming in from the login page, a HUD loaded seconds ago is reused.
  useEffect(() => { void loadHud(); }, [loadHud]);

  // The review queue's due count (the Study badge): once signed in, and again when the user comes back to the tab or
  // the network comes back (the badge stays as it was meanwhile).
  const signedIn = !!user;
  const loadReview = () => { void useReview.getState().load(); };
  useEffect(() => { if (signedIn) loadReview(); }, [signedIn]);
  useRevalidate(loadReview, signedIn);

  return (
    <ThemeScope theme="study">
    <div className="app-shell" data-area={area ?? undefined}>
      <NavSidebar />
      <main id="main-content" tabIndex={-1} className="app-main" data-theme={play ? "play" : undefined}>
        {authLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center app-loading">
              <span className="app-loading__orb" aria-hidden="true" />
              <p className="text-fg-muted text-sm mt-5">Loading CourseMateAI…</p>
            </div>
          </div>
        ) : play ? <ThemeScope theme="play">{children}</ThemeScope> /* the Hero area's pixel fonts and look */ : children}
      </main>
      <BottomNav />
      <CommandPalette />
      {/* reward ceremonies, from anywhere in the app (Stage R3) */}
      <CoinRain />
      <AchievementBanner />
      {user && <LevelUpCeremony />}
    </div>
    </ThemeScope>
  );
}
