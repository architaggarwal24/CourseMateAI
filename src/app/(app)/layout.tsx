import type { Metadata } from "next";
import { preload } from "react-dom";
import AppShell from "@/components/shell/AppShell";
import { NOINDEX } from "@/lib/site";

// The signed-in app (Today, Study, Hero, Account): private to each user, so never indexed (next.config.ts also sends
// X-Robots-Tag). It isn't hidden by robots.txt: crawlers must be able to read the noindex.
export const metadata: Metadata = { robots: NOINDEX };

/**
 * Who you are (GET /auth/me) and your level and coins (GET /hud) are asked for by the HTML itself, while the
 * JavaScript is still downloading: the app's own fetches then pick up the answers already on their way. Every app
 * screen waited for the script and then for these two, one after the other (about 5 s on a slow phone: the speed
 * pass, after the BreakingBreach performance toolkit, fix 16 "run independent requests in parallel").
 */
const EARLY_FETCHES = ["/api/v1/auth/me", "/api/v1/hud"] as const;

// Study, Hero and Account share one frame (sidebar / bottom bar). The login page and the full-screen hero forge don't.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  for (const href of EARLY_FETCHES) preload(href, { as: "fetch", crossOrigin: "use-credentials" });
  return <AppShell>{children}</AppShell>;
}
