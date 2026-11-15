// /cbse/class-<n>/<subject>/<chapter>: one chapter (src/lib/content): summary, key points, flashcards (with Education
// Q&A markup), a practice quiz and common mistakes. noindex, and out of the sitemap, until `reviewed` is filled in.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { SITE_LINKS, SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { Quiz } from "@/components/tools/FreeTool";
import { chapterPath, chapterTitle, flashcardJsonLd, isReviewed, setPath } from "@/lib/content/chapters";
import { CHAPTER_SETS, findSet } from "@/lib/content/sets";
import { ROUTES } from "@/lib/routes";
import { NOINDEX, SHARE_IMAGE, SITE_NAME, absoluteUrl, jsonLdScript } from "@/lib/site";
import "@/components/landing/landing.css";
import "@/components/tools/tools.css";

type P = { params: Promise<{ klass: string; subject: string; chapter: string }> };
export const dynamicParams = false;
export const generateStaticParams = () => CHAPTER_SETS.filter((s) => s.boardSlug === "cbse")
  .flatMap((s) => s.chapters.map((c) => ({ klass: `class-${s.grade}`, subject: s.subjectSlug, chapter: c.slug })));

async function load(params: P["params"]) {
  const { klass, subject, chapter } = await params;
  const s = findSet("cbse", klass, subject);
  const c = s?.chapters.find((x) => x.slug === chapter);
  return s && c ? { s, c } : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const found = await load(params);
  if (!found) return {};
  const { s, c } = found;
  const title = chapterTitle(s, c), path = chapterPath(s, c);
  return {
    title, description: c.description, alternates: { canonical: path },
    robots: isReviewed(c) ? { index: true, follow: true } : NOINDEX,
    openGraph: { type: "article", siteName: SITE_NAME, locale: "en_IN", url: path, title: `${title} | ${SITE_NAME}`, description: c.description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: `${title} | ${SITE_NAME}`, description: c.description, images: [SHARE_IMAGE.url] },
  };
}

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function ChapterPage({ params }: P) {
  const found = await load(params);
  if (!found) notFound();
  const { s, c } = found;
  const i = s.chapters.indexOf(c);
  const prev = s.chapters[i - 1], next = s.chapters[i + 1];
  const setName = `${s.board} Class ${s.grade} ${s.subject}`;
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "CourseMateAI", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: setName, item: absoluteUrl(setPath(s)) },
    { "@type": "ListItem", position: 3, name: c.title, item: absoluteUrl(chapterPath(s, c)) },
  ] };
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      {isReviewed(c) && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(flashcardJsonLd(s, c)) }} />}
      <SiteHeader links={SITE_LINKS} />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <article>
          <section className="landing-section landing-section--narrow tool-top" aria-labelledby="ch-h1">
            <nav aria-label="Breadcrumb" className="feature-crumbs">
              <ol><li><Link href="/">Home</Link></li><li><Link href={setPath(s)}>{setName}</Link></li><li aria-current="page">Chapter {c.number}</li></ol>
            </nav>
            <h1 id="ch-h1" className="landing-hero__title tool-h1">{c.title}</h1>
            <p className="chapter-meta">
              {setName} · Chapter {c.number} · {c.reviewed ? `Checked by ${c.reviewed.by} on ${longDate(c.reviewed.on)}` : "Draft: not yet checked"} · Drafted with AI help
            </p>
            {c.summary.map((p, k) => <p key={k} className="feature-text">{p}</p>)}
          </section>

          <section className="landing-section landing-section--narrow" aria-labelledby="key-h">
            <h2 id="key-h" className="landing-h2 feature-h2">Key points</h2>
            <ul className="feature-points">{c.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul>
          </section>

          <section className="landing-section landing-section--narrow" aria-labelledby="cards-h">
            <h2 id="cards-h" className="landing-h2 feature-h2">Flashcards</h2>
            <p className="feature-text">Cover the answer, say it out loud, then check. Come back to them tomorrow and in three days.</p>
            <ol className="chapter-cards" aria-label={`${c.title} flashcards`}>
              {c.cards.map((card) => (
                <li key={card.front} className="chapter-card">
                  <p className="chapter-card__q">{card.front}</p>
                  <p className="chapter-card__a">{card.back}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="landing-section landing-section--narrow" aria-labelledby="quiz-h">
            <h2 id="quiz-h" className="landing-h2 feature-h2">Practice quiz</h2>
            <div className="tool"><Quiz questions={c.quiz} /></div>
          </section>

          <section className="landing-section landing-section--narrow" aria-labelledby="mis-h">
            <h2 id="mis-h" className="landing-h2 feature-h2">Common mistakes</h2>
            <ul className="feature-points">{c.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
          </section>

          <section className="landing-section landing-section--narrow" aria-labelledby="nav-h">
            <h2 id="nav-h" className="landing-h2 feature-h2">More chapters</h2>
            <p className="feature-text chapter-nav">
              {prev && <Link href={chapterPath(s, prev)}>← Chapter {prev.number}: {prev.title}</Link>}
              <Link href={setPath(s)}>All {setName} chapters</Link>
              {next && <Link href={chapterPath(s, next)}>Chapter {next.number}: {next.title} →</Link>}
            </p>
          </section>
        </article>

        <section className="landing-final" aria-labelledby="final-h">
          <h2 id="final-h" className="landing-h2">Make cards from your own notes</h2>
          <p>Upload your class notes or this chapter as a PDF: CourseMateAI writes flashcards and quizzes from them and brings each card back on the right day.</p>
          <div className="landing-hero__cta">
            <ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink>
            <ButtonLink href="/tools/ai-flashcard-maker" variant="secondary">Try the free flashcard maker</ButtonLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
