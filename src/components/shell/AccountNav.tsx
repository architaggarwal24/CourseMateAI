"use client";

import { LogOut, UserCircle } from "@/components/icons";
import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ROUTES } from "@/lib/routes";
import SubNav from "./SubNav";

const ITEMS = [
  { href: ROUTES.account, label: "Profile" },
  { href: ROUTES.accountUsage, label: "Plan & usage" },
  { href: ROUTES.accountSettings, label: "Settings" },
  { href: ROUTES.accountSecurity, label: "Security" },
  { href: ROUTES.accountHistory, label: "History" },
];
const ADMIN_ITEM = { href: ROUTES.accountAdmin, label: "Admin" };

/** Account's sections, plus Sign out (the sidebar's user menu is not on the mobile layout). */
export default function AccountNav() {
  const { user, logout } = useAuth();
  return (
    <div className="ws-top">
      <div className="ws-doc">
        <span className="ws-doc__icon" aria-hidden="true"><UserCircle size={17} /></span>
        <div className="min-w-0">
          <span className="ws-doc__name">Account</span>
          <span className="ws-doc__meta">Profile, plan, settings and history</span>
        </div>
      </div>
      <div className="ws-top__tabs"><SubNav label="Account" items={user?.is_admin ? [...ITEMS, ADMIN_ITEM] : ITEMS} className="!px-[3px]" /></div>
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
