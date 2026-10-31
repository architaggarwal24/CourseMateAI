"use client";

import { LogOut, UserCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ROUTES } from "@/lib/routes";
import SubNav from "./SubNav";

const ITEMS = [
  { href: ROUTES.account, label: "Profile" },
  { href: ROUTES.accountSettings, label: "Settings" },
  { href: ROUTES.accountHistory, label: "History" },
];

/** Account's sections, plus Sign out (the sidebar's user menu is not on the mobile layout). */
export default function AccountNav() {
  const { user, logout } = useAuth();
  return (
    <div className="ws-top">
      <div className="ws-doc">
        <span className="ws-doc__icon" aria-hidden="true"><UserCircle size={17} /></span>
        <div className="min-w-0">
          <span className="ws-doc__name">Account</span>
          <span className="ws-doc__meta">Profile, settings and history</span>
        </div>
      </div>
      <div className="ws-top__tabs"><SubNav label="Account" items={ITEMS} className="!px-[3px]" /></div>
      {user && (
        <div className="ws-top__end">
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut size={14} aria-hidden="true" />Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
