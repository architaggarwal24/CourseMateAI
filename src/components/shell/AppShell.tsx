"use client";

import { useEffect } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { useReview } from "@/hooks/useReview";
import { useRevalidate } from "@/hooks/useRevalidate";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ThemeScope from "@/components/ui/ThemeScope";
import { areaOf, ROUTES } from "@/lib/routes";
import NavSidebar from "./NavSidebar";
import HeroSidebar from "./HeroSidebar";
import PortalTransition from "./PortalTransition";
import PauseMenu from "./PauseMenu";
import HeroWorldFx from "./HeroWorldFx";
import HealthyNudge from "./HealthyNudge";
import FocusBar from "./FocusBar";
import TermsGate from "@/components/legal/TermsGate";
import { useFocusMode } from "@/hooks/useFocusMode";
import { rememberPage } from "@/lib/worlds";
import BottomNav from "./BottomNav";
import CommandPalette from "./CommandPaletteLoader";
import dynamic from "next/dynamic";
import CoinRain from "@/components/fx/CoinRain";
import LoreTip from "@/components/fx/LoreTip";
import AchievementBanner from "@/components/fx/AchievementBanner";

// the level-up screen draws the champion (the pixel engine): loaded on its own, only for a signed-in player
const LevelUpCeremony = dynamic(() => import("@/components/fx/LevelUpCeremony"), { ssr: false });
// "you've been upgraded": a plan given by an admin, an invite code or a payment, shown once
const UpgradeCeremony = dynamic(() => import("@/components/fx/UpgradeCeremony"), { ssr: false });
import "./shell.css";
import "./worlds.css";

/**
 * The frame around Study, Hero and Account: the sidebar on desktop (it collapses to an icon rail), a tab bar along the
 * bottom on phones, the screen in between. Two worlds (the two-worlds UI): Study and Account keep the Study frame
 * (light or dark, as chosen); the play pages are the Hero world, whose whole frame turns to Play - its own pixel
 * pause-menu panel (HeroSidebar), its own tab bar, the darker Ink - as if you stepped into another dimension.
 * It also keeps what the old home page kept for the whole session: the HUD refresh (and the review queue's due count).
 * ⌘K opens the command palette.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { loading: authLoading, user, unreachable } = useAuth();
  const loadHud = useHUDStore((s) => s.load);
  const area = areaOf(usePathname());
  const play = area === "hero";
  const pathname = usePathname();
  // Study's focus mode (two worlds, Stage 6): only in Study; crossing into the Hero world ends it
  const focusOn = useFocusMode((s) => s.on) && !play;
  useEffect(() => { if (play && useFocusMode.getState().on) useFocusMode.getState().exit(); }, [play]);
  // each world remembers the page you were on (the portal goes back there)
  useEffect(() => { rememberPage(play ? "hero" : "study", window.location.pathname + window.location.search); }, [pathname, play]);
  const router = useRouter();

  // The app needs an account: signed out (never signed in, logged out elsewhere, or the session expired), go to the
  // login page and come back here afterwards. The loading screen stays up meanwhile, so nothing flashes.
  // (Offline is not signed out: the screen shows what it can, and the login page waits for a real "no".)
  const signedOut = !authLoading && !user && !unreachable;
  useEffect(() => {
    if (signedOut) router.replace(ROUTES.loginNext(window.location.pathname + window.location.search));
  }, [signedOut, router]);

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
    <ThemeScope theme={play ? "play" : "study"}>
    <div className="app-shell" data-area={area ?? undefined} data-world={play ? "hero" : "study"} data-focus={focusOn || undefined}>
      {focusOn && <FocusBar />}
      {play ? <HeroSidebar /> : <NavSidebar />}
      <main id="main-content" tabIndex={-1} className="app-main" data-theme={play ? "play" : undefined}>
        {authLoading && !signedOut && !play ? (
          // Study: the page's shape while you're recognised (a heading and three cards), not a spinner in the middle
          <div className="app-skeleton" role="status" aria-busy="true">
            <span className="sr-only">Loading CourseMateAI…</span>
            <span className="app-skeleton__title" aria-hidden="true" />
            <span className="app-skeleton__line" aria-hidden="true" />
            <span className="app-skeleton__grid" aria-hidden="true"><span /><span /><span /></span>
          </div>
        ) : authLoading || signedOut ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center app-loading" data-world={play ? "hero" : "study"}>
              <span className="app-loading__orb" aria-hidden="true" />
              <p className="text-fg-muted text-sm mt-5">{signedOut ? "Taking you to the login page…" : "Opening the Hero world…"}</p>
              {play && !signedOut && <LoreTip />}
            </div>
          </div>
        ) : children}
      </main>
      <BottomNav />
      <CommandPalette />
      <PortalTransition world={play ? "hero" : "study"} />
      {play && user && <PauseMenu />}
      {play && <HeroWorldFx />}
      {play && user && <HealthyNudge />}
      {/* reward ceremonies, from anywhere in the app (Stage R3) */}
      <CoinRain />
      <AchievementBanner />
      {user && <LevelUpCeremony />}
      {user && <UpgradeCeremony />}
      {/* the Terms / Privacy Policy, accepted once (legal and trust pass) */}
      <TermsGate />
    </div>
    </ThemeScope>
  );
}
