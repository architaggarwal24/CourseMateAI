"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleQuota = (e: Event) => {
      const { message, usageUrl, provider } = (e as CustomEvent).detail ?? {};

      // Persist so Settings page can show the banner even after navigation
      try {
        localStorage.setItem("cmai_quota_hit", JSON.stringify({
          provider: provider || "",
          usageUrl: usageUrl || "",
          ts: Date.now(),
        }));
      } catch (_) {}

      if (usageUrl) {
        toast.error(
          () => (
            <span>
              {message || "API quota exceeded."}{" "}
              <a
                href={usageUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#D4AF37", textDecoration: "underline", marginLeft: 4 }}
              >
                Check usage →
              </a>
            </span>
          ),
          { duration: 8000 }
        );
      } else {
        toast.error(message || "API quota exceeded. Check your provider's usage dashboard.", {
          duration: 8000,
        });
      }
    };

    window.addEventListener("cmai:quota", handleQuota);
    return () => window.removeEventListener("cmai:quota", handleQuota);
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}