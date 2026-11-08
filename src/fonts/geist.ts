import localFont from "next/font/local";

// Geist Mono (SIL OFL, see LICENSE-Geist.txt), self-hosted: numbers that tick, timers, keyboard hints and code.
// It defines --font-geist-mono on <html> (see app/layout.tsx and styles/tokens.css).
// Performance pass: the file is subset to Latin, punctuation, arrows, box drawing and ₹ (71 KB -> 40 KB; Cyrillic,
// Greek and Vietnamese dropped: the app is English-only), and it is not preloaded: it only sets small labels, never
// the first big paint, so it no longer competes with the page for bandwidth on every first visit.
export const geistMono = localFont({
  src: "./GeistMono-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-geist-mono",
});
