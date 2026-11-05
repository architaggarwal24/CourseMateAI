import localFont from "next/font/local";

// Geist Sans + Geist Mono (SIL OFL, see LICENSE-Geist.txt), self-hosted variable fonts: the build never needs the
// network. Geist is the body face of BOTH themes; Mono is for numbers, timers, keyboard hints and code.
// They define --font-geist-sans / --font-geist-mono on <html> (see app/layout.tsx and styles/tokens.css).
export const geistSans = localFont({
  src: "./Geist-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-sans",
});

export const geistMono = localFont({
  src: "./GeistMono-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist-mono",
});
