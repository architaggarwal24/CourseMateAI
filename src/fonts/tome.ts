import localFont from "next/font/local";

// IM Fell English (SIL OFL, see LICENSE-IMFell.txt): the Fell types, cut in the 1670s and given to Oxford by Bishop
// John Fell. The Bestiary book only (Stage B3): imported by the book, which is loaded on its own, and `preload:
// false`, so no other page fetches it.
export const tome = localFont({
  src: [
    { path: "./IMFellEnglish-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./IMFellEnglish-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-tome",
});

/** The same types in small capitals (headings, the contents, folios). */
export const tomeCaps = localFont({
  src: "./IMFellEnglishSC-latin-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-tome-sc",
});
