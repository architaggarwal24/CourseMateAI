import type { Metadata, Viewport } from "next";
import { ToastHost } from "@/components/ui/Toast";
import { Providers } from "@/components/shell/Providers";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { geistMono } from "@/fonts/geist";
import { bricolage, onest } from "@/fonts/brand";
import { THEME_SCRIPT } from "@/lib/theme";
import { SIDEBAR_SCRIPT } from "@/lib/sidebar";
import { SHARE_IMAGE, SITE_NAME, siteOrigin } from "@/lib/site";
import "@/styles/tokens.css";
import "@/styles/accents.css";
import "@/styles/retro.css";
import "@/components/ui/ui.css";
import "@/components/fx/fx.css";
import "./globals.css";

// Every page inherits these; public pages set their own title, description, canonical and social tags
// (src/lib/site.ts pageMetadata), private ones noindex. The canonical origin is NEXT_PUBLIC_SITE_URL (validated).
export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  applicationName: SITE_NAME,
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: "Turn your PDFs into a study companion: a tutor that cites the page, quizzes, flashcards, notes, spaced-repetition review and a pixel hero that levels up as you study.",
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_IN", images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "dark light",
  // Draw under the notch and home bar (with statusBarStyle "black-translucent"); edges pad by --safe-* (globals.css).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="dark" className={`${onest.variable} ${bricolage.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + SIDEBAR_SCRIPT }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Providers>
          <ToastHost />
          {/* Top-level boundary — uses built-in fallback with its own refresh button */}
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
