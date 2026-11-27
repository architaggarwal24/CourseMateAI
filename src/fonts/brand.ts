import localFont from "next/font/local";

// The Ink fonts, self-hosted (SIL OFL; see LICENSE-Onest.txt, LICENSE-Fraunces.txt, LICENSE-BricolageGrotesque.txt)
// so the build never needs the network. They define --font-onest / --font-fraunces / --font-wordmark on <html>
// (see styles/tokens.css).

/** The interface and reading face. */
export const onest = localFont({
  src: "./Onest-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-onest",
});

/** Headings and big numbers (redesign Stage 1): an editorial serif with optical sizes (Latin, opsz + wght axes). */
export const fraunces = localFont({
  src: "./Fraunces-latin-opsz-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-fraunces",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

/**
 * The logo's wordmark keeps its own face: Bricolage Grotesque, cut down to the 11 letters of "CourseMateAI" (4 KB),
 * so the logo stays as it was while headings move to Fraunces.
 */
export const wordmark = localFont({
  src: "./BricolageGrotesque-wordmark.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-wordmark",
  fallback: ["Onest", "system-ui", "sans-serif"],
});
