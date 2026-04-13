import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "CourseMateAI",
  description: "AI-powered study companion with gamification",
  icons: { icon: "/favicon.ico" },
};

const appearanceScript = `(function(){try{var p=JSON.parse(localStorage.getItem('cmai_appearance')||'{}');if(p.fontSize==='large')document.documentElement.classList.add('text-lg-mode');if(p.reduceAnimations)document.documentElement.classList.add('reduce-animations');}catch(e){try{localStorage.removeItem('cmai_appearance');}catch(e2){}}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <Providers>
          <Toaster
            position="top-right"
            theme="dark"
            toastOptions={{
              style: { background: "#0d0d0d", border: "1px solid #2a2a2a", color: "#ededed" },
            }}
          />
          {/* Top-level boundary — uses built-in fallback with its own refresh button */}
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}