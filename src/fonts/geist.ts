import localFont from "next/font/local";

// Geist Mono (SIL OFL, see LICENSE-Geist.txt), self-hosted: numbers that tick, timers, keyboard hints and code.
// It defines --font-geist-mono on <html> (see app/layout.tsx and styles/tokens.css).
export const geistMono = localFont({
  src: "./GeistMono-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-mono",
});
