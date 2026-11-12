"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/Toast";
import { Button } from "@/components/ui";
import { useHeroPrefs } from "@/hooks/useHeroPrefs";
import { dueBadge, useReview } from "@/hooks/useReview";
import { ROUTES } from "@/lib/routes";
import { portalCross } from "./PortalLink";

/** After this long in the Hero world (in one go), the Scribe suggests a study break. */
export const NUDGE_AFTER_MS = 40 * 60 * 1000;
const CHECK_MS = 30_000;

/**
 * The healthy-play nudge (the two worlds, Stage 5): after 40 minutes in the Hero world, the Scribe suggests your
 * reviews, with a way through the portal. Never in the middle of a fight (it waits for the fight to end); once per
 * 40 minutes; off with the Study reminder switch in Options.
 */
export default function HealthyNudge() {
  useEffect(() => {
    let since = Date.now();
    const t = setInterval(() => {
      if (!useHeroPrefs.getState().nudge || Date.now() - since < NUDGE_AFTER_MS) return;
      if (document.querySelector(".arena--battle")) return;                  // a fight on screen: after it
      since = Date.now();
      const due = dueBadge(useReview.getState().stats);
      const href = ROUTES.studyTab("review");
      toast.info(due > 0 ? `Your mind has earned a rest. ${due} ${due === 1 ? "card waits" : "cards wait"} in Study.` : "Your mind has earned a rest. Study is a portal away.", {
        duration: 15000,
        action: <Button size="sm" variant="primary" onClick={() => portalCross("study", due > 0 ? href : ROUTES.today)}>{due > 0 ? "Go review" : "Back to Study"}</Button>,
      });
    }, CHECK_MS);
    return () => clearInterval(t);
  }, []);
  return null;
}
