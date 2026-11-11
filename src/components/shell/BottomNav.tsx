"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Crown, Home, Repeat, Swords, UserCircle, type IconType } from "@/components/icons";
import { areaOf, ROUTES } from "@/lib/routes";
import { dueBadge, useReview } from "@/hooks/useReview";
import ReviewBadge from "./ReviewBadge";

/**
 * Phones (hidden from md up): a flat tab bar along the bottom, where the thumb is. Today, Study, Review (with the
 * due count), Arena, Champion and Me. It pads itself clear of the home bar.
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
  const items: { label: string; href: string; Icon: IconType; current: boolean; badge?: boolean }[] = [
    { label: "Today", href: ROUTES.today, Icon: Home, current: pathname === ROUTES.today },
    { label: "Study", href: ROUTES.study, Icon: BookOpen, current: area === "study" && tab !== "review" },
    { label: "Review", href: ROUTES.studyTab("review"), Icon: Repeat, current: area === "study" && tab === "review", badge: true },
    { label: "Arena", href: ROUTES.heroArena, Icon: Swords, current: pathname === ROUTES.heroArena },
    // Champion stands for the rest of play too (Quests and Bestiary are linked from the pages themselves and the menu)
    { label: "Champion", href: ROUTES.champion, Icon: Crown, current: area === "hero" && pathname !== ROUTES.heroArena },
    { label: "Me", href: ROUTES.account, Icon: UserCircle, current: area === "account" },
  ];
  return (
    <nav aria-label="Main" className="bottom">
      {items.map(({ label, href, Icon, current, badge }) => (
        <Link key={label} href={href} aria-current={current ? "page" : undefined} className="bottom__link">
          <Icon size={22} aria-hidden="true" />
          <span>{label}</span>
          {badge && <ReviewBadge due={due} compact />}
        </Link>
      ))}
    </nav>
  );
}
