import localFont from "next/font/local";

// The Ink fonts, self-hosted (SIL OFL; see LICENSE-Onest.txt, LICENSE-BricolageGrotesque.txt) so the build never
// needs the network. Onest is the interface and reading face; Bricolage Grotesque (with its optical sizes) is for
// headings and big numbers. They define --font-onest / --font-bricolage on <html> (see styles/tokens.css).
export const onest = localFont({
  src: "./Onest-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-onest",
});

export const bricolage = localFont({
  src: "./BricolageGrotesque-Variable.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-bricolage",
  fallback: ["Onest", "system-ui", "sans-serif"],
});
