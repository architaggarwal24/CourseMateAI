"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { Trophy } from "@/components/ui/icons";
import { useCelebrate } from "@/lib/fx/celebrate";

/**
 * Achievement unlocked (Stage R3): a banner drops from the top, one achievement at a time, and leaves after a few
 * seconds (or when tapped). Mounted once in the app shell; announced with announceAchievements().
 */
export default function AchievementBanner() {
  const banners = useCelebrate((s) => s.banners);
  const dismiss = useCelebrate((s) => s.dismissBanner);
  const reduced = !!useReducedMotionConfig();
  const top = banners[0];
  useEffect(() => {
    if (!top) return;
    const t = setTimeout(() => dismiss(top.key), 4200);
    return () => clearTimeout(t);
  }, [top, dismiss]);
  return (
    <div className="fx-ach" role="status" aria-live="polite">
      <AnimatePresence>
        {top && (
          <motion.button key={top.key} type="button" className="fx-ach__card" onClick={() => dismiss(top.key)}
            initial={reduced ? { opacity: 0 } : { y: -90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { y: -90, opacity: 0 }}
            transition={{ type: "tween", ease: [0.7, 0, 0.3, 1], duration: reduced ? 0.01 : 0.3 }}>
            <span className="fx-ach__medal" aria-hidden="true"><Trophy size={22} /></span>
            <span className="fx-ach__text">
              <span className="fx-ach__label">Achievement unlocked</span>
              <span className="fx-ach__name">{top.name}</span>
              {top.description && <span className="fx-ach__desc">{top.description}</span>}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
