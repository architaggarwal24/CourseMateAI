// /tools: the free study tools (src/lib/landing/tools.ts), public and indexed.
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { SITE_LINKS, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { TOOLS_HUB, TOOL_PAGES, toolPath } from "@/lib/landing/tools";
import { ROUTES } from "@/lib/routes";
import { absoluteUrl, jsonLdScript, pageMetadata } from "@/lib/site";
import "@/components/landing/landing.css";
import "@/components/tools/tools.css";

export const metadata = pageMetadata(TOOLS_HUB.path);

export default function ToolsHub() {
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "CourseMateAI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: "Free tools", item: absoluteUrl(TOOLS_HUB.path) },
  ] };
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <SiteHeader links={SITE_LINKS} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="landing-section feature-hero" aria-labelledby="tools-h1">
          <h1 id="tools-h1" className="landing-hero__title tool-h1">{TOOLS_HUB.h1}</h1>
          <p className="landing-hero__lede">Each one does a single study job right here, free and without an account. Paste your notes, or plan your revision.</p>
          <ul className="feature-hub">
            {TOOL_PAGES.map((t) => (
              <li key={t.slug} className="landing-feature feature-hub__card">
                <h2 className="landing-h3"><Link href={toolPath(t.slug)}>{t.name}</Link></h2>
                <p>{t.description}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="landing-final" aria-labelledby="final-h">
          <h2 id="final-h" className="landing-h2">Want it for a whole PDF?</h2>
          <p>A free account does all of this from your own PDFs, keeps what you make, and brings it back for review.</p>
          <div className="landing-hero__cta"><ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
