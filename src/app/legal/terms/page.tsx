import { pageMetadata } from "@/lib/site";
import { OPERATOR, UPDATED } from "../legal";

export const metadata = pageMetadata("/legal/terms");

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="legal__updated">Last updated {UPDATED}</p>
      <p>CourseMateAI (&quot;the service&quot;) is run by {OPERATOR.name}, {OPERATOR.country}. You agree to these terms by ticking the box when you create your account (or when the app asks after they change); we keep a record of the version you accepted and when.</p>
      <h2>The service</h2>
      <p>CourseMateAI helps you study the documents you upload: it answers questions about them, writes quizzes, notes, flashcards and mock exams, and turns studying into a game. Answers, notes, quizzes and flashcards are written by AI models (the app labels them) and can be wrong; check anything important against your own material.</p>
      <h2>Your account</h2>
      <ul>
        <li>You must give a working email address and keep your password safe. You are responsible for what happens under your account.</li>
        <li>You must be at least 12 years old.</li>
        <li>One person per account. Don&apos;t share accounts or resell access.</li>
      </ul>
      <h2>Your documents</h2>
      <p>You keep all rights to what you upload. Only upload documents you are allowed to use. You give us permission to store and process them only to provide the service to you. Don&apos;t upload material that is illegal, infringes someone else&apos;s rights, or contains other people&apos;s personal data without their consent.</p>
      <h2>Fair use</h2>
      <p>Each plan has limits (documents, file size, AI calls a day, tokens a month), shown on the Plans page. Don&apos;t try to get around them, overload the service, scrape it, or use it to build a competing product. We may suspend accounts that break these terms.</p>
      <h2>Plans and payments</h2>
      <p>Paid plans are subscriptions billed in Indian rupees (INR) through Razorpay, monthly or yearly, at the prices shown on the Plans page when you subscribe. A subscription renews until you cancel it; cancelling stops the next renewal and you keep the plan until the end of the paid period. Refunds are covered by the <a href="/legal/refunds">Refund Policy</a>.</p>
      <h2>Changes and availability</h2>
      <p>We work to keep the service available but don&apos;t promise it will never be interrupted. We may change features, limits or these terms; for a significant change we will tell you by email or in the app before it applies.</p>
      <h2>Liability</h2>
      <p>The service is provided &quot;as is&quot;. To the extent the law allows, we are not liable for indirect losses, lost data or results of decisions made on AI-written content. Our total liability is limited to what you paid us in the 3 months before the claim.</p>
      <h2>Ending</h2>
      <p>You can delete your account at any time in Account → Settings; your documents and data are deleted with it. A PDF or course you delete waits in Account → Trash for 30 days, then it is deleted for good. These terms are governed by the laws of India.</p>
      <h2>Contact</h2>
      <p>{OPERATOR.name} · <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></p>
    </>
  );
}
