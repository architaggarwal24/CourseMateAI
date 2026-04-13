"use client";

import { Home } from "lucide-react";
import { useRouter } from "next/navigation";

export default function HomeButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push("/")}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-card hover:bg-bg-hover border border-border hover:border-accent-gold/50 text-text-secondary hover:text-text-primary transition-all group"
    >
      <Home size={18} className="group-hover:text-accent-gold transition-colors" />
      <span className="text-sm font-medium">Home</span>
    </button>
  );
}