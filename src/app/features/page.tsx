// /features: what CourseMateAI does, one card per feature page (public, indexed: src/lib/site.ts PUBLIC_PAGES).
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { SITE_LINKS, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { FEATURE_PAGES, FEATURES_HUB, featurePath } from "@/lib/landing/features";
import { absoluteUrl, jsonLdScript, pageMetadata } from "@/lib/site";
import { ROUTES } from "@/lib/routes";
import "@/components/landing/landing.css";

export const metadata = pageMetadata(FEATURES_HUB.path);

export default function FeaturesPage() {
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "CourseMateAI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: "Features", item: absoluteUrl(FEATURES_HUB.path) },
  ] };
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <SiteHeader links={SITE_LINKS} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="landing-section feature-hero" aria-labelledby="features-h1">
          <nav aria-label="Breadcrumb" className="feature-crumbs"><ol><li><Link href="/">Home</Link></li><li aria-current="page">Features</li></ol></nav>
          <h1 id="features-h1" className="landing-h2 feature-h1">{FEATURES_HUB.h1}</h1>
          <p className="landing-section__lede">
            Everything in CourseMateAI works from the PDFs you put in a course: your lecture slides, chapters and past papers.
            Here is what each part does, and which plan it&apos;s on.
          </p>
        </section>
        <section className="landing-section" aria-label="Features">
          <ul className="feature-hub">
            {FEATURE_PAGES.map((f) => (
              <li key={f.slug} className="landing-feature feature-hub__card">
                <h2 className="landing-h3"><Link href={featurePath(f.slug)}>{f.h1Short}</Link></h2>
                <p>{f.description}</p>
                <p className="feature-hub__plan">{f.plan}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="landing-final" aria-labelledby="features-final">
          <h2 id="features-final" className="landing-h2">Try it on your own notes</h2>
          <p>The free plan has chat, notes, quizzes, flashcards and the study game.</p>
          <div className="landing-hero__cta"><ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
