"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Gauge, History, Loader2, Shield, User, type IconType } from "@/components/ui/icons";
import { Card } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ROUTES } from "@/lib/routes";
import ProfileHero from "@/components/account/ProfileHero";

interface Row { href: string; Icon: IconType; title: string; detail: string }

/**
 * The profile: who you are and how far you have come, then one list of what you can change, each a link to the
 * single place it lives (Settings holds the name, username, email and password form; there is no second copy here).
 */
export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => { if (!loading && !user) router.push(ROUTES.login); }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center">
        <Loader2 size={32} className="ui-spinner text-ink-gold" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return null;

  const rows: Row[] = [
    { href: `${ROUTES.accountSettings}#account`, Icon: User, title: "Name, username and email", detail: user.email || "Add your email" },
    { href: ROUTES.accountSecurity, Icon: Shield, title: "Password and two-step sign-in", detail: "Keep your account safe" },
    { href: ROUTES.accountUsage, Icon: Gauge, title: "Plan & usage", detail: "What your plan includes and what you have used" },
    { href: ROUTES.accountHistory, Icon: History, title: "Session history", detail: "Chats, quizzes, flashcards and notes you saved" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
      <h1 className="sr-only">Profile</h1>
      <ProfileHero name={user.full_name || user.username || user.email} handle={user.username || undefined} />

      <Card title="Your account" headingLevel={2} pad="none">
        <ul aria-label="Your account" className="profile-links">
          {rows.map(({ href, Icon, title, detail }) => (
            <li key={href}>
              <Link href={href} className="profile-link">
                <Icon size={18} className="profile-link__icon" />
                <span className="profile-link__text">
                  <span className="profile-link__title">{title}</span>
                  <span className="profile-link__detail">{detail}</span>
                </span>
                <ChevronRight size={16} className="profile-link__go" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
