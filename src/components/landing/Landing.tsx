// The landing page (logged-out visitors at "/"): what CourseMateAI is, how it works, the game, the plans and the
// common questions, then a way in. Server-rendered and static apart from the pixel duel (a small client island).
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  BookMarked, Brain, CheckCircle2, FileText, GraduationCap, Layers, Map as MapIcon, MessageSquare, ShieldCheck, Sparkles, Swords, Trophy,
} from "@/components/icons";
import Logo from "@/components/brand/Logo";
import ThemeScope from "@/components/ThemeScope";
import { ButtonLink } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import "./landing.css";

const LandingDuel = dynamic(() => import("./LandingDuel"));

export interface LandingPlan {
  tier: string; name: string; tagline: string; price_month: number;
  limits: { documents: number; ai_calls_day: number; courses: number; pdf_mb: number };
  highlights: string[];
}

const FEATURES = [
  { icon: <MessageSquare size={20} />, title: "A tutor that knows your notes", text: "Ask anything about your PDFs and get a clear answer with the page it came from. If the answer isn't in your material, it says so." },
  { icon: <CheckCircle2 size={20} />, title: "Quizzes from your own material", text: "Multiple choice, true/false or short answer, each with an explanation and the page to read again." },
  { icon: <Layers size={20} />, title: "Flashcards that come back on time", text: "A daily review that brings each card back just before you'd forget it (spaced repetition)." },
  { icon: <FileText size={20} />, title: "Notes in seconds", text: "Summaries, outlines and key terms for a topic or a whole chapter, linked to the pages." },
  { icon: <MapIcon size={20} />, title: "See how it all connects", text: "A concept map of your course: open any idea to quiz yourself on it." },
  { icon: <GraduationCap size={20} />, title: "Mock exams", text: "A timed exam across your course, with a report of what to revise." },
];

const STEPS = [
  { n: "1", icon: <BookMarked size={18} />, title: "Make a course", text: "One per subject: Biology, Torts, Thermodynamics." },
  { n: "2", icon: <FileText size={18} />, title: "Add your PDFs", text: "Lecture slides, chapters, past papers. We read every page." },
  { n: "3", icon: <Sparkles size={18} />, title: "Study, then play", text: "Chat, quiz and review. Every right answer powers up your hero." },
];

const FAQ = [
  { q: "Is it free?", a: "Yes. The Apprentice plan is free for good and has every core tool. Paid plans add more PDFs, more AI answers a day and exam tools." },
  { q: "Does the AI make things up?", a: "It answers from your PDFs and shows the page for each point. When your material doesn't cover something, it tells you instead of guessing." },
  { q: "Who can see my PDFs?", a: "Only you. Your files are private to your account, and you can delete any of them (or your whole account) at any time." },
  { q: "What files work?", a: "PDFs with real text: lecture slides, book chapters, notes exported to PDF. Scanned pages without text can't be read yet." },
  { q: "Does it work on my phone?", a: "Yes. It runs in the browser and can be installed like an app on Android and iPhone." },
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function Landing({ plans }: { plans: LandingPlan[] }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/" className="landing-nav__brand" aria-label="CourseMateAI home"><Logo size={28} /></Link>
        <nav aria-label="Sections" className="landing-nav__links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#play">The game</a>
          <a href="#plans">Plans</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="landing-nav__cta">
          <ButtonLink href={ROUTES.login} variant="ghost" size="sm">Log in</ButtonLink>
          <ButtonLink href={ROUTES.signup} variant="primary" size="sm">Start free</ButtonLink>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__copy">
            <p className="landing-eyebrow fx-rise"><Sparkles size={13} aria-hidden="true" />Free to start · no card needed</p>
            <h1 id="landing-title" className="landing-hero__title fx-rise" style={{ "--fx-delay": "80ms" } as React.CSSProperties}>
              Your PDFs, turned into a <span className="landing-hero__mark">tutor</span>.
            </h1>
            <p className="landing-hero__lede fx-rise" style={{ "--fx-delay": "160ms" } as React.CSSProperties}>
              Upload your course notes. Ask questions and get answers that show the page. Make quizzes, flashcards and
              notes from your own material, and watch a pixel hero level up while you learn.
            </p>
            <div className="landing-hero__cta fx-rise" style={{ "--fx-delay": "240ms" } as React.CSSProperties}>
              <ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink>
              <ButtonLink href="#how" variant="secondary">See how it works</ButtonLink>
            </div>
            <ul className="landing-hero__trust" aria-label="Why students like it">
              <li><ShieldCheck size={15} aria-hidden="true" />Answers show their page</li>
              <li><Brain size={15} aria-hidden="true" />Spaced-repetition review</li>
              <li><Trophy size={15} aria-hidden="true" />Streaks, quests and boss fights</li>
            </ul>
          </div>

          {/* a still of the Study workspace: chat with citations, a quiz, the review count */}
          <div className="landing-shot fx-rise" style={{ "--fx-delay": "200ms", "--fx-y": "20px" } as React.CSSProperties} aria-hidden="true">
            <div className="landing-shot__bar"><span /><span /><span /><em>Biology 101 · Chat</em></div>
            <div className="landing-shot__body">
              <p className="landing-msg landing-msg--you">Why do cells need mitochondria?</p>
              <div className="landing-msg landing-msg--ai">
                <p>They turn glucose into <strong>ATP</strong>, the energy a cell spends on almost everything it does <span className="landing-cite">p. 12</span>.</p>
                <p>Think of them as the cell&apos;s power station: more active cells, like muscle, have more of them <span className="landing-cite">p. 14</span>.</p>
                <p className="landing-msg__follow">Want me to quiz you on cellular respiration?</p>
              </div>
              <div className="landing-shot__row">
                <div className="landing-card">
                  <span className="landing-card__label"><Layers size={12} />Quiz · 3 of 5</span>
                  <span className="landing-opt landing-opt--ok"><CheckCircle2 size={12} />Mitochondria</span>
                  <span className="landing-opt">Golgi apparatus</span>
                </div>
                <div className="landing-card landing-card--xp">
                  <span className="landing-card__label"><Trophy size={12} />Level 7</span>
                  <span className="landing-xp"><span style={{ width: "68%" }} /></span>
                  <span className="landing-card__meta">+25 XP · 4-day streak</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="landing-section" aria-labelledby="features-title">
          <div className="landing-section__head">
            <p className="landing-kicker">Study tools</p>
            <h2 id="features-title" className="landing-h2">Everything you need before the exam</h2>
            <p className="landing-section__lede">Built on your own material, so you revise what your teacher actually covered.</p>
          </div>
          <ul className="landing-features">
            {FEATURES.map((f) => (
              <li key={f.title} className="landing-feature">
                <span className="landing-feature__icon" aria-hidden="true">{f.icon}</span>
                <h3 className="landing-h3">{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="landing-section" aria-labelledby="how-title">
          <div className="landing-section__head">
            <p className="landing-kicker">How it works</p>
            <h2 id="how-title" className="landing-h2">Three steps to a study plan</h2>
          </div>
          <ol className="landing-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="landing-step">
                <span className="landing-step__n" aria-hidden="true">{s.n}</span>
                <h3 className="landing-h3"><span className="landing-step__icon" aria-hidden="true">{s.icon}</span>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <ThemeScope theme="play">
        <section id="play" className="landing-play" aria-labelledby="play-title">
          <div className="landing-play__inner">
            <div className="landing-play__copy">
              <p className="landing-kicker landing-kicker--play">The Hero area</p>
              <h2 id="play-title" className="landing-h2 landing-h2--play">Beat bosses with what you learned</h2>
              <p>Pick a champion and battle creatures from myth. Every question is from your course, so a right answer is a hit and a wrong one is a lesson.</p>
              <ul className="landing-play__list">
                <li><Swords size={15} aria-hidden="true" />Boss fights built from your PDFs</li>
                <li><Trophy size={15} aria-hidden="true" />Daily quests, streaks and a daily chest</li>
                <li><BookMarked size={15} aria-hidden="true" />A Bestiary that fills in as you win</li>
              </ul>
            </div>
            <LandingDuel />
          </div>
        </section>
        </ThemeScope>

        <section id="plans" className="landing-section" aria-labelledby="plans-title">
          <div className="landing-section__head">
            <p className="landing-kicker">Plans</p>
            <h2 id="plans-title" className="landing-h2">Start free. Upgrade when the exams get serious.</h2>
          </div>
          <ul className="landing-plans">
            {plans.map((p) => (
              <li key={p.tier} className="landing-plan" data-tier={p.tier}>
                <h3 className="landing-h3">{p.name}</h3>
                <p className="landing-plan__price">{p.price_month ? <>{inr(p.price_month)}<span>/month</span></> : "Free"}</p>
                <p className="landing-plan__tag">{p.tagline}</p>
                <ul className="landing-plan__list">
                  <li>{p.limits.courses} {p.limits.courses === 1 ? "course" : "courses"} · {p.limits.documents} PDFs</li>
                  <li>{p.limits.ai_calls_day} AI answers a day</li>
                  {p.highlights.map((h) => <li key={h}>{h}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          <div className="landing-center">
            <ButtonLink href={ROUTES.signup} variant="primary">Create your free account</ButtonLink>
          </div>
        </section>

        <section id="faq" className="landing-section landing-section--narrow" aria-labelledby="faq-title">
          <div className="landing-section__head">
            <p className="landing-kicker">Questions</p>
            <h2 id="faq-title" className="landing-h2">Good to know</h2>
          </div>
          <div className="landing-faq">
            {FAQ.map((f) => (
              <details key={f.q} className="landing-faq__item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <h2 id="final-title" className="landing-h2">Your next exam, sorted.</h2>
          <p>Make a course, add a PDF and ask your first question in under a minute.</p>
          <div className="landing-hero__cta">
            <ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink>
            <ButtonLink href={ROUTES.login} variant="ghost">I have an account</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <Logo size={22} />
        <ul className="landing-foot__links" aria-label="Legal">
          <li><Link href="/legal/terms">Terms</Link></li>
          <li><Link href="/legal/privacy">Privacy</Link></li>
          <li><Link href="/legal/refunds">Refunds</Link></li>
        </ul>
        <p>© {new Date().getFullYear()} CourseMateAI</p>
      </footer>
    </div>
  );
}
