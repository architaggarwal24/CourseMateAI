"use client";

import { LogOut, User, Sparkles, Settings, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AvatarFace from "./AvatarFace";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [shopData, setShopData] = useState<any>(null);

  useEffect(() => {
    if (user) loadAvatar();
  }, [user]);

  const loadAvatar = async () => {
    try {
      const res = await fetch("http://localhost:8000/shop", { credentials: "include" });
      if (res.ok) setShopData(await res.json());
    } catch (e) { console.error("Avatar load error:", e); }
  };

  // ── Guest state ──────────────────────────────────────────
  if (!user) {
    return (
      <button
        onClick={() => router.push("/login")}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-bg-hover transition-colors group"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-gold/40 to-accent-purple/40 border-2 border-accent-gold/30 flex items-center justify-center flex-shrink-0">
          <LogIn size={18} className="text-accent-gold" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-base font-bold text-accent-gold leading-tight">Login / Sign Up</p>
          <p className="text-xs text-text-muted mt-0.5">Join to save your progress</p>
        </div>
      </button>
    );
  }

  // ── Logged-in state ──────────────────────────────────────
  return (
    <div className="relative">
      <div className="flex items-center gap-4 px-5 py-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex-shrink-0 hover:opacity-80 transition-opacity"
        >
          {shopData ? (
            <AvatarFace
              equipped={shopData.equipped || {}}
              items={shopData.items || []}
              diameter={40}
              className="ring-2 ring-accent-gold/50 hover:ring-accent-gold transition-all"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-gold to-accent-purple flex items-center justify-center text-white font-bold text-sm border-2 border-white/20">
              {user.username?.[0]?.toUpperCase() || "U"}
            </div>
          )}
        </button>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity overflow-hidden"
        >
          <p className="text-base font-bold text-text-primary leading-tight truncate">
            {user.full_name || user.username || user.email}
          </p>
          <p className="text-xs text-text-muted mt-0.5 truncate">
            {user.username ? `@${user.username}` : user.email}
          </p>
        </button>
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 bottom-full mb-2 w-64 bg-bg-card border border-border rounded-xl shadow-2xl z-20 overflow-hidden backdrop-blur-xl">
            <div className="p-4 border-b border-border bg-gradient-to-br from-accent-purple/10 to-accent-blue/10">
              <div className="flex items-center gap-3">
                {shopData && (
                  <AvatarFace equipped={shopData.equipped || {}} items={shopData.items || []} diameter={48} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-muted">Signed in as</p>
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {user.full_name || user.username || user.email}
                  </p>
                  {user.username && <p className="text-xs text-text-muted truncate">@{user.username}</p>}
                </div>
              </div>
            </div>

            <button onClick={() => { router.push("/avatar"); setIsOpen(false); }}
              className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-bg-hover flex items-center gap-3 transition-colors">
              <Sparkles size={16} className="text-accent-purple" /><span>Avatar</span>
            </button>
            <button onClick={() => { router.push("/settings"); setIsOpen(false); }}
              className="w-full px-4 py-3 text-left text-sm text-text-secondary hover:bg-bg-hover flex items-center gap-3 transition-colors">
              <Settings size={16} /><span>Settings</span>
            </button>
            <div className="border-t border-border" />
            <button onClick={() => { logout(); setIsOpen(false); }}
              className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-3 transition-colors">
              <LogOut size={16} /><span>Logout</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}