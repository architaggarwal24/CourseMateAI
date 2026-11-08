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

// Pixelify Sans (SIL OFL, see LICENSE-PixelifySans.txt): a readable pixel face for running text in the Hero area
// (Stage P3), so descriptions match the sprites without the strain of Press Start 2P. Play scope only, not preloaded.
export const pixelBody = localFont({
  src: "./PixelifySans-latin-variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-pixel-body",
});
