// "/": the landing page for logged-out visitors. With a session cookie it goes straight on to Today (the app checks
// the session itself and sends a stale one to the login page).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Landing from "@/components/landing/Landing";
import { hasSessionCookie } from "@/lib/auth/session-cookie";
import { ROUTES } from "@/lib/routes";
import { plansCatalog } from "@/server/plans";

export const metadata: Metadata = {
  title: "CourseMateAI: your PDFs, turned into a tutor",
  description: "Upload your course notes and get a tutor that cites the page, quizzes and flashcards from your own material, spaced-repetition review and a pixel hero that levels up as you study.",
};

export default async function Home() {
  const jar = await cookies();
  if (hasSessionCookie((n) => jar.get(n))) redirect(ROUTES.today);
  const plans = plansCatalog().map((p) => ({
    tier: p.tier, name: p.name, tagline: p.tagline, price_month: p.price_month, highlights: p.highlights,
    limits: { documents: p.limits.documents, ai_calls_day: p.limits.ai_calls_day, courses: p.limits.courses, pdf_mb: p.limits.pdf_mb },
  }));
  return <Landing plans={plans} />;
}
