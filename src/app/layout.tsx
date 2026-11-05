import type { Metadata, Viewport } from "next";
import { ToastHost } from "@/components/ui/Toast";
import { Providers } from "@/components/Providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { geistMono } from "@/fonts/geist";
import { bricolage, onest } from "@/fonts/brand";
import { THEME_SCRIPT } from "@/lib/theme";
import { SIDEBAR_SCRIPT } from "@/lib/sidebar";
import "@/styles/tokens.css";
import "@/styles/retro.css";
import "@/components/ui/ui.css";
import "@/components/fx/fx.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CourseMateAI",
  description: "AI-powered study companion with gamification",
  appleWebApp: { capable: true, title: "CourseMateAI", statusBarStyle: "black-translucent" },
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
