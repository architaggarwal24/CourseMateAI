import type { ReactNode } from "react";
import { pixel } from "@/fonts/pixel";

export type Theme = "study" | "play";

/**
 * Switches the design tokens (src/styles/tokens.css) for everything inside it.
 * The page root is the Study theme; wrap a Play screen (Hero area, arena) in <ThemeScope theme="play">.
 * The pixel font is only wired up inside a play scope, so Study screens never use (or download) it.
 * The scope adds no layout box (display: contents).
 */
export default function ThemeScope({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div data-theme={theme} className={theme === "play" ? `theme-scope ${pixel.variable}` : "theme-scope"}>
      {children}
    </div>
  );
}
