"use client";

import { useEffect } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ThemeScope from "@/components/ThemeScope";
import { Aurora, Starfield } from "@/components/fx";
import { areaOf } from "@/lib/routes";
import NavSidebar from "./NavSidebar";
import BottomNav from "./BottomNav";
import CommandPalette from "./CommandPalette";
import "./shell.css";

/**
 * The frame around Study, Hero and Account: a frosted sidebar on desktop, a floating dock on mobile, the screen in
 * between, over an ambient backdrop (aurora in Study; aurora + starfield in the Hero area's Play theme).
 * It also keeps what the old home page kept for the whole session: the HUD refresh. ⌘K opens the command palette.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { loading: authLoading } = useAuth();
  const refresh = useHUDStore((s) => s.refresh);
  const area = areaOf(usePathname());
  const play = area === "hero";

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemeScope theme={play ? "play" : "study"}>
    <div className="app-shell" data-area={area ?? undefined}>
      <div className="app-backdrop" aria-hidden="true">
        <Aurora grid={!play} />
        {play && <Starfield />}
      </div>
      <NavSidebar />
      <main id="main-content" tabIndex={-1} className="app-main">
        {authLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center app-loading">
              <span className="app-loading__orb" aria-hidden="true" />
              <p className="text-fg-muted text-sm mt-5">Loading CourseMateAI…</p>
            </div>
          </div>
        ) : children}
      </main>
      <BottomNav />
      <CommandPalette />
    </div>
    </ThemeScope>
  );
}
