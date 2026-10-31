import type { Metadata, Viewport } from "next";
import { ToastHost } from "@/components/ui/Toast";
import { Providers } from "@/components/Providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { geistMono, geistSans } from "@/fonts/geist";
import "@/styles/tokens.css";
import "@/styles/retro.css";
import "@/components/ui/ui.css";
import "@/components/fx/fx.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CourseMateAI",
  description: "AI-powered study companion with gamification",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: "#101117",
  colorScheme: "dark",
};

const appearanceScript = `(function(){try{var p=JSON.parse(localStorage.getItem('cmai_appearance')||'{}');if(p.fontSize==='large')document.documentElement.classList.add('text-lg-mode');if(p.reduceAnimations)document.documentElement.classList.add('reduce-animations');}catch(e){try{localStorage.removeItem('cmai_appearance');}catch(e2){}}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
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
