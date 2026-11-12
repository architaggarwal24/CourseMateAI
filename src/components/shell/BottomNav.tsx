"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Crown, Home, Repeat, ScrollText, Skull, Sparkles, Swords, UserCircle, type IconType } from "@/components/ui/icons";
import { HERO_MENU } from "@/lib/worlds";
import { portalClick, usePortalHref } from "./PortalLink";
import { areaOf, ROUTES } from "@/lib/routes";
import { dueBadge, useReview } from "@/hooks/useReview";
import ReviewBadge from "./ReviewBadge";

/**
 * Phones (hidden from md up): a tab bar along the bottom, where the thumb is; it pads itself clear of the home bar.
 * Each world has its own (the two worlds, Stage 1): Study has Today, Study, Review (with the due count), the portal
 * into the Hero world and Me; Hero has Arena, Quests, Bestiary, Champion and the portal back to Study.
 */
export default function BottomNav() {
  return <Suspense fallback={<Bar tab={null} />}><WithQuery /></Suspense>;
}
function WithQuery() {
  return <Bar tab={useSearchParams().get("tab")} />;
}

function Bar({ tab }: { tab: string | null }) {
  const pathname = usePathname();
  const area = areaOf(pathname);
  const due = useReview((s) => dueBadge(s.stats));
  const hero = area === "hero";
  const toStudy = usePortalHref("study"), toHero = usePortalHref("hero");
  type Tab = { label: string; href: string; Icon: IconType; current: boolean; badge?: boolean; portal?: "hero" | "study" };
  const HERO_ICON: Record<string, IconType> = { arena: Swords, quests: ScrollText, bestiary: Skull, champion: Crown };
  const items: Tab[] = hero
    ? [
      ...HERO_MENU.map((i) => ({ label: i.label, href: i.href, Icon: HERO_ICON[i.id] ?? Sparkles, current: pathname === i.href.split("?")[0] })),
      { label: "Study", href: toStudy, Icon: Sparkles, current: false, portal: "study" as const },
    ]
    : [
      { label: "Today", href: ROUTES.today, Icon: Home, current: pathname === ROUTES.today },
      { label: "Study", href: ROUTES.study, Icon: BookOpen, current: area === "study" && tab !== "review" },
      { label: "Review", href: ROUTES.studyTab("review"), Icon: Repeat, current: area === "study" && tab === "review", badge: true },
      { label: "Hero", href: toHero, Icon: Sparkles, current: false, portal: "hero" as const },
      { label: "Me", href: ROUTES.account, Icon: UserCircle, current: area === "account" },
    ];
  return (
    <nav aria-label="Main" className="bottom" data-world={hero ? "hero" : "study"}>
      {items.map(({ label, href, Icon, current, badge, portal }) => (
        <Link key={label} href={href} aria-current={current ? "page" : undefined} className={`bottom__link${portal ? " bottom__link--portal" : ""}`} data-portal={portal}
          onClick={portal ? portalClick(portal, href) : undefined}>
          <Icon size={22} aria-hidden="true" />
          <span>{label}</span>
          {portal && <span className="sr-only">{portal === "hero" ? ": enter the Hero world" : ": return to Study"}</span>}
          {badge && <ReviewBadge due={due} compact />}
        </Link>
      ))}
    </nav>
  );
}
