// The public site's header and footer (the landing page and the feature pages share them). Server-rendered.
import Link from "next/link";
import Logo from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui";
import { FEATURE_PAGES, featurePath } from "@/lib/features";
import { ROUTES } from "@/lib/routes";

/** `links`: the header's section links (the landing page jumps within itself; other pages link back to it). */
export function SiteHeader({ links }: { links: { href: string; label: string }[] }) {
  return (
    <header className="landing-nav">
      <Link href="/" className="landing-nav__brand" aria-label="CourseMateAI home"><Logo size={28} /></Link>
      <nav aria-label="Sections" className="landing-nav__links">
        {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
      </nav>
      <div className="landing-nav__cta">
        <ButtonLink href={ROUTES.login} variant="ghost" size="sm">Log in</ButtonLink>
        <ButtonLink href={ROUTES.signup} variant="primary" size="sm">Start free</ButtonLink>
      </div>
    </header>
  );
}

/** Links shown in the header away from the landing page. */
export const SITE_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#plans", label: "Plans" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteFooter() {
  return (
    <footer className="landing-foot">
      <Logo size={22} />
      <ul className="landing-foot__links" aria-label="Features">
        <li><Link href="/features">All features</Link></li>
        {FEATURE_PAGES.map((f) => <li key={f.slug}><Link href={featurePath(f.slug)}>{f.h1Short}</Link></li>)}
      </ul>
      <ul className="landing-foot__links" aria-label="Legal">
        <li><Link href="/legal/terms">Terms</Link></li>
        <li><Link href="/legal/privacy">Privacy</Link></li>
        <li><Link href="/legal/refunds">Refunds</Link></li>
      </ul>
      <p>© {new Date().getFullYear()} CourseMateAI</p>
    </footer>
  );
}
