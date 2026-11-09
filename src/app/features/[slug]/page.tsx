// /features/<slug>: one real capability per page (src/lib/features.ts), public and indexed. Only the slugs in that
// list exist (dynamicParams = false): anything else is a 404.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import FeatureArt from "@/components/landing/FeatureArt";
import { SITE_LINKS, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { FEATURE_PAGES, FEATURES_HUB, featureBySlug, featurePath } from "@/lib/features";
import { absoluteUrl, jsonLdScript, pageMetadata } from "@/lib/site";
import { ROUTES } from "@/lib/routes";
import "@/components/landing/landing.css";

export const dynamicParams = false;
export const generateStaticParams = () => FEATURE_PAGES.map((f) => ({ slug: f.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return featureBySlug(slug) ? pageMetadata(featurePath(slug)) : {};
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = featureBySlug(slug);
  if (!f) notFound();
  const others = FEATURE_PAGES.filter((o) => o.slug !== f.slug);
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "CourseMateAI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: "Features", item: absoluteUrl(FEATURES_HUB.path) },
    { "@type": "ListItem", position: 3, name: f.h1Short, item: absoluteUrl(featurePath(f.slug)) },
  ] };
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <SiteHeader links={SITE_LINKS} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="landing-hero feature-top" aria-labelledby="feature-h1">
          <div className="landing-hero__copy">
            <nav aria-label="Breadcrumb" className="feature-crumbs">
              <ol><li><Link href="/">Home</Link></li><li><Link href="/features">Features</Link></li><li aria-current="page">{f.h1Short}</li></ol>
            </nav>
            <h1 id="feature-h1" className="landing-hero__title feature-h1">{f.h1}</h1>
            <p className="landing-hero__lede">{f.lede}</p>
            <div className="landing-hero__cta">
              <ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink>
              <ButtonLink href="/features" variant="secondary">All features</ButtonLink>
            </div>
          </div>
          <FeatureArt art={f.art} />
        </section>

        {f.sections.map((s, i) => (
          <section key={s.h2} className="landing-section landing-section--narrow feature-section" aria-labelledby={`s${i}`}>
            <h2 id={`s${i}`} className="landing-h2 feature-h2">{s.h2}</h2>
            <p className="feature-text">{s.text}</p>
            {s.points && <ul className="feature-points">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>}
          </section>
        ))}

        {f.plan && (
          <section className="landing-section landing-section--narrow" aria-labelledby="plan-h">
            <h2 id="plan-h" className="landing-h2 feature-h2">Which plan has it</h2>
            <p className="feature-text">{f.plan} <Link href="/#plans">Compare the plans</Link>.</p>
          </section>
        )}

        <section className="landing-section landing-section--narrow" aria-labelledby="faq-h">
          <h2 id="faq-h" className="landing-h2 feature-h2">Questions</h2>
          <div className="landing-faq">
            {f.faq.map((q) => (
              <details key={q.q} className="landing-faq__item"><summary>{q.q}</summary><p>{q.a}</p></details>
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="more-h">
          <h2 id="more-h" className="landing-h2 feature-h2">More of what it does</h2>
          <ul className="feature-hub">
            {others.map((o) => (
              <li key={o.slug} className="landing-feature feature-hub__card">
                <h3 className="landing-h3"><Link href={featurePath(o.slug)}>{o.h1Short}</Link></h3>
                <p>{o.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-final" aria-labelledby="final-h">
          <h2 id="final-h" className="landing-h2">Try it on your own notes</h2>
          <p>Make a course, add a PDF and see it work on your material in under a minute.</p>
          <div className="landing-hero__cta"><ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
