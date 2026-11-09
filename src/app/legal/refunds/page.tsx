import { pageMetadata } from "@/lib/site";
import { OPERATOR, UPDATED } from "../legal";

export const metadata = pageMetadata("/legal/refunds");

export default function RefundsPage() {
  return (
    <>
      <h1>Cancellation &amp; Refund Policy</h1>
      <p className="legal__updated">Last updated {UPDATED}</p>
      <p>CourseMateAI&apos;s paid plans are digital subscriptions, billed in Indian rupees (INR) through Razorpay. Nothing is shipped: a plan starts working in your account as soon as the payment is confirmed.</p>
      <h2>Cancelling</h2>
      <p>You can cancel at any time on the Plans page (Account → Plan &amp; usage). Cancelling stops the next renewal; you keep the plan until the end of the period you already paid for, and then your account goes back to the Free plan. Your documents and progress stay.</p>
      <h2>Refunds</h2>
      <ul>
        <li><b>First payment:</b> if the service doesn&apos;t work for you, ask within 7 days of your first payment for a plan and we refund it in full.</li>
        <li><b>Charged by mistake</b> (a duplicate payment, or a renewal charged after you cancelled): refunded in full.</li>
        <li><b>Renewals and part-used periods</b> are otherwise not refunded; cancelling keeps the plan until the period ends.</li>
      </ul>
      <p>Approved refunds go back to the original payment method through Razorpay, usually within 5–7 working days (your bank may take longer).</p>
      <h2>How to ask</h2>
      <p>Email <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> from your account&apos;s email address with the date of the payment. We reply within 3 working days.</p>
      <h2>Contact</h2>
      <p>{OPERATOR.name} · {OPERATOR.country} · <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a></p>
    </>
  );
}
