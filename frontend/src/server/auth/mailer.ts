// Sending the account emails (Phase 4.1): verification codes, password-reset codes, two-step codes, email changes.
// Which way they go, first that is set up:
//   1. Cloudflare Email Service: a `send_email` binding named EMAIL in wrangler.jsonc (needs Workers Paid and an
//      onboarded sending domain) and EMAIL_FROM.
//   2. Resend: RESEND_API_KEY and EMAIL_FROM.
//   3. Neither: nothing is sent. The code is written to the Worker's log (`npx wrangler tail`), which only the
//      account owner can read, and sign-up does not wait for a verified email (canSend is false).

export type CodePurpose = "email-verification" | "forget-password" | "change-email" | "two-factor" | "sign-in";

export interface Mail { to: string; subject: string; text: string; html: string }

export interface Mailer {
  /** Whether emails really reach people (then sign-up waits for a verified address). */
  canSend: boolean;
  via: "cloudflare" | "resend" | "log";
  send(mail: Mail): Promise<void>;
}

interface SendEmailBinding {
  send(message: { to: string; from: string; subject: string; text?: string; html?: string }): Promise<unknown>;
}

export interface MailerEnv {
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
}

export function createMailer(env: MailerEnv, fetchImpl: typeof fetch = fetch, log: (line: string) => void = console.log): Mailer {
  const from = (env.EMAIL_FROM || "").trim();
  if (env.EMAIL && from) {
    return { canSend: true, via: "cloudflare", send: async (m) => { await env.EMAIL!.send({ from, ...m }); } };
  }
  if (env.RESEND_API_KEY && from) {
    return {
      canSend: true,
      via: "resend",
      async send(m) {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        });
        if (!res.ok) throw new Error(`Resend refused the email (${res.status})`);
      },
    };
  }
  return {
    canSend: false,
    via: "log",
    async send(m) {
      log(`[coursemate-email] (not sent: no email service set up) to=${m.to} subject="${m.subject}" ${m.text}`);
    },
  };
}

const SUBJECTS: Record<CodePurpose, string> = {
  "email-verification": "Your CourseMate verification code",
  "forget-password": "Reset your CourseMate password",
  "change-email": "Confirm your new CourseMate email",
  "two-factor": "Your CourseMate sign-in code",
  "sign-in": "Your CourseMate sign-in code",
};
const WHY: Record<CodePurpose, string> = {
  "email-verification": "to confirm this is your email",
  "forget-password": "to choose a new password",
  "change-email": "to confirm your new email address",
  "two-factor": "to finish signing in",
  "sign-in": "to sign in",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The email that carries a one-time code. */
export function codeMail(to: string, code: string, purpose: CodePurpose): Mail {
  const why = WHY[purpose];
  const text = `Your code is ${code}. Enter it in CourseMate ${why}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">` +
    `<p>Enter this code in CourseMate ${escapeHtml(why)}:</p>` +
    `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${escapeHtml(code)}</p>` +
    `<p style="color:#555">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`;
  return { to, subject: SUBJECTS[purpose], text, html };
}
