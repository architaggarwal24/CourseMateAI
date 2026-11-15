// /cbse/class-<n>/<subject>: a chapter set's hub (src/lib/content). Indexed once one of its chapters is reviewed.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { SITE_LINKS, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { chapterPath, isReviewed, setDescription, setIsLive, setPath, setTitle } from "@/lib/content/chapters";
import { CHAPTER_SETS, findSet } from "@/lib/content/sets";
import { ROUTES } from "@/lib/routes";
import { NOINDEX, SHARE_IMAGE, SITE_NAME, absoluteUrl, jsonLdScript } from "@/lib/site";
import "@/components/landing/landing.css";
import "@/components/tools/tools.css";

type P = { params: Promise<{ klass: string; subject: string }> };
export const dynamicParams = false;
export const generateStaticParams = () => CHAPTER_SETS.filter((s) => s.boardSlug === "cbse").map((s) => ({ klass: `class-${s.grade}`, subject: s.subjectSlug }));

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { klass, subject } = await params;
  const s = findSet("cbse", klass, subject);
  if (!s) return {};
  const title = setTitle(s), description = setDescription(s), path = setPath(s);
  return {
    title, description, alternates: { canonical: path },
    robots: setIsLive(s) ? { index: true, follow: true } : NOINDEX,
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_IN", url: path, title: `${title} | ${SITE_NAME}`, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: `${title} | ${SITE_NAME}`, description, images: [SHARE_IMAGE.url] },
  };
}

export default async function ChapterSetPage({ params }: P) {
  const { klass, subject } = await params;
  const s = findSet("cbse", klass, subject);
  if (!s) notFound();
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "CourseMateAI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: `${s.board} Class ${s.grade} ${s.subject}`, item: absoluteUrl(setPath(s)) },
  ] };
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <SiteHeader links={SITE_LINKS} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="landing-section feature-hero" aria-labelledby="set-h1">
          <h1 id="set-h1" className="landing-hero__title tool-h1">{s.board} Class {s.grade} {s.subject}</h1>
          <p className="landing-hero__lede">Each chapter in plain words: a short summary, flashcards to revise with and a practice quiz. Follows the <a href={s.syllabus.url} rel="noopener">{s.syllabus.name}</a>.</p>
          <ol className="chapter-list">
            {s.chapters.map((c) => (
              <li key={c.slug} className="landing-feature feature-hub__card">
                <h2 className="landing-h3"><Link href={chapterPath(s, c)}>Chapter {c.number}: {c.title}</Link></h2>
                <p>{c.description}</p>
                {!isReviewed(c) && <p className="chapter-draft">Draft: being checked</p>}
              </li>
            ))}
          </ol>
        </section>
        <section className="landing-final" aria-labelledby="final-h">
          <h2 id="final-h" className="landing-h2">Revise from your own notes too</h2>
          <p>Upload your class notes or a chapter PDF: CourseMateAI makes flashcards and quizzes from them and brings them back for review.</p>
          <div className="landing-hero__cta"><ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
