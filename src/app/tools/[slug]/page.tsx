// /tools/<slug>: a free study tool that works right on the page (src/lib/landing/tools.ts), public and indexed. Only
// the slugs in that list exist (dynamicParams = false): anything else is a 404.
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_LINKS, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import FreeTool from "@/components/tools/FreeTool";
import RevisionPlanner from "@/components/tools/RevisionPlanner";
import { TOOLS_HUB, TOOL_PAGES, toolBySlug, toolPath } from "@/lib/landing/tools";
import { absoluteUrl, jsonLdScript, pageMetadata } from "@/lib/site";
import "@/components/landing/landing.css";
import "@/components/tools/tools.css";

export const dynamicParams = false;
export const generateStaticParams = () => TOOL_PAGES.map((t) => ({ slug: t.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return toolBySlug(slug) ? pageMetadata(toolPath(slug)) : {};
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = toolBySlug(slug);
  if (!t) notFound();
  const others = TOOL_PAGES.filter((o) => o.slug !== t.slug);
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "CourseMateAI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: "Free tools", item: absoluteUrl(TOOLS_HUB.path) },
    { "@type": "ListItem", position: 3, name: t.name, item: absoluteUrl(toolPath(t.slug)) },
  ] };
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <SiteHeader links={SITE_LINKS} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="landing-section landing-section--narrow tool-top" aria-labelledby="tool-h1">
          <nav aria-label="Breadcrumb" className="feature-crumbs">
            <ol><li><Link href="/">Home</Link></li><li><Link href={TOOLS_HUB.path}>Free tools</Link></li><li aria-current="page">{t.name}</li></ol>
          </nav>
          <h1 id="tool-h1" className="landing-hero__title tool-h1">{t.h1}</h1>
          <p className="landing-hero__lede">{t.lede}</p>
          {t.kind === "planner" ? <RevisionPlanner /> : <FreeTool kind={t.kind} />}
        </section>

        <section className="landing-section landing-section--narrow" aria-labelledby="how-h">
          <h2 id="how-h" className="landing-h2 feature-h2">How it works</h2>
          <ol className="tool-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>

        <section className="landing-section landing-section--narrow" aria-labelledby="tips-h">
          <h2 id="tips-h" className="landing-h2 feature-h2">Tips for better results</h2>
          <ul className="feature-points">{t.tips.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>

        <section className="landing-section landing-section--narrow" aria-labelledby="faq-h">
          <h2 id="faq-h" className="landing-h2 feature-h2">Questions</h2>
          <div className="landing-faq">
            {t.faq.map((q) => <details key={q.q} className="landing-faq__item"><summary>{q.q}</summary><p>{q.a}</p></details>)}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="more-h">
          <h2 id="more-h" className="landing-h2 feature-h2">More free tools</h2>
          <ul className="feature-hub">
            {others.map((o) => (
              <li key={o.slug} className="landing-feature feature-hub__card">
                <h3 className="landing-h3"><Link href={toolPath(o.slug)}>{o.name}</Link></h3>
                <p>{o.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
