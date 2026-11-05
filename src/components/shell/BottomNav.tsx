"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { areaOf } from "@/lib/routes";
import { dueBadge, useReview } from "@/hooks/useReview";
import { NAV_ITEMS } from "./nav-items";
import ReviewBadge from "./ReviewBadge";

/** Mobile: the same three areas as a floating glass dock along the bottom. Hidden from md up. */
export default function BottomNav() {
  const area = areaOf(usePathname());
  const due = useReview((s) => dueBadge(s.stats));
  return (
    <nav aria-label="Main" className="bottom" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}>
      <div className="bottom__dock">
        {NAV_ITEMS.map(({ id, label, href, Icon }) => (
          <Link key={id} href={href} aria-current={area === id ? "page" : undefined} className="bottom__link">
            {area === id && <motion.span layoutId="bottom-dot" className="bottom__dot" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
            {id === "study" && <ReviewBadge due={due} compact />}
          </Link>
        ))}
      </div>
    </nav>
  );
}
