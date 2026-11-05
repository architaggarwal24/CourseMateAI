import Link from "next/link";
import "./legal.css";

// The public policy pages: Terms, Privacy, Refunds. No sign-in needed.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="legal">
      <nav className="legal__nav" aria-label="Policies">
        <Link href="/login" className="legal__home">CourseMateAI</Link>
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/refunds">Refunds</Link>
      </nav>
      <article className="legal__body">{children}</article>
    </main>
  );
}
