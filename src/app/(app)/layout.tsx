import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { NOINDEX } from "@/lib/site";

// The signed-in app (Today, Study, Hero, Account): private to each user, so never indexed (next.config.ts also sends
// X-Robots-Tag). It isn't hidden by robots.txt: crawlers must be able to read the noindex.
export const metadata: Metadata = { robots: NOINDEX };

// Study, Hero and Account share one frame (sidebar / bottom bar). The login page and the full-screen hero forge don't.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
