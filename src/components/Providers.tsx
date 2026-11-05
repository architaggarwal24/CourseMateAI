"use client";

import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { AuthProvider } from "@/contexts/AuthContext";
import { initMonitoring } from "@/lib/monitoring";
import { startPwa } from "@/lib/pwa";
import { applyThemePref, watchSystemMode } from "@/lib/theme";

/** True while <html> has the in-app "Reduce animations" class (Settings → Appearance), kept live as it is toggled. */
function useAppReduceAnimations() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setOn(html.classList.contains("reduce-animations"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return on;
}

/**
 * Every motion/react animation follows the visitor's preference: the OS setting ("user"), or the app's own
 * Reduce animations switch ("always"). CSS animations follow both through globals.css.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const reduce = useAppReduceAnimations();
  // Once per page: error monitoring (when a DSN is configured) and the installable app.
  useEffect(() => { void initMonitoring(); startPwa(); }, []);
  // Light / dark: keep <html data-mode> on the saved choice, and follow the device while the choice is System.
  useEffect(() => { applyThemePref(); return watchSystemMode(); }, []);
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      <AuthProvider>{children}</AuthProvider>
    </MotionConfig>
  );
}
