import localFont from "next/font/local";

// Press Start 2P (SIL OFL, see LICENSE-PressStart2P.txt): the Play theme's label font, for short labels and numbers only.
// Imported only by ThemeScope and applied only inside data-theme="play"; `preload: false` means a Study page never
// downloads it (the file is fetched the first time a play element actually draws a glyph with it).
export const pixel = localFont({
  src: "./PressStart2P-latin-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-pixel",
});
