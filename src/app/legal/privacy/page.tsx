import { pageMetadata } from "@/lib/site";
import { OPERATOR, UPDATED } from "../legal";

export const metadata = pageMetadata("/legal/privacy");

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal__updated">Last updated {UPDATED}</p>
      <p>This policy explains what CourseMateAI, run by {OPERATOR.name} ({OPERATOR.country}), collects and why. We collect only what the service needs and we don&apos;t sell your data or show ads.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email, username, name, password (stored only as a salted hash), time zone, and, if you sign in with Google or GitHub, that account&apos;s email, name and the address of its profile picture.</li>
        <li><b>Your documents:</b> the PDFs you upload, the text read from them, and search data made from that text.</li>
        <li><b>Study and game data:</b> your questions and the answers, quizzes, notes, flashcards, review cards, exams, scores, XP, coins and items.</li>
        <li><b>Usage:</b> how many AI calls and tokens you use (for your plan&apos;s limits), and basic technical logs (IP address, browser) kept for security and to fix problems.</li>
        <li><b>Payments:</b> your subscription&apos;s status from Razorpay. Card and bank details go to Razorpay only; we never see or store them.</li>
      </ul>
      <h2>Who processes it</h2>
      <ul>
        <li><b>Cloudflare</b> hosts the app and stores your account, documents and data.</li>
        <li><b>AI providers</b> (such as Google, OpenAI, Anthropic, NVIDIA, and Cloudflare Workers AI) receive the passages of your document and your question needed to write each answer. They process it to answer, under their API terms.</li>
        <li><b>Razorpay</b> handles payments. <b>Google</b> and <b>GitHub</b> handle signing in with their accounts, if you use them. An email service may send your sign-in codes.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>For as long as your account exists. Generated study material may be cached for up to 7 days to answer repeat requests faster. When you delete your account (Account → Settings), your account, documents and study data are deleted; backups expire within 30 days. Payment records we must keep by law are kept as required.</p>
      <h2>Your choices and rights</h2>
      <p>You can see and change your profile in Account → Settings, delete any document, and delete your account at any time. You can ask for a copy of your data or for a correction by emailing us.</p>
      <h2>Cookies</h2>
      <p>We use only the cookies needed to keep you signed in and secure. Your browser also stores small app preferences (such as text size).</p>
      <h2>Children</h2>
      <p>The service is for students aged 13 and over; younger students need a parent&apos;s or guardian&apos;s permission.</p>
      <h2>Contact</h2>
      <p>{OPERATOR.name} · <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></p>
    </>
  );
}
