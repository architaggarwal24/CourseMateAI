/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { codeMail, createMailer } from "./mailer";

const mail = codeMail("a@x.io", "123456", "email-verification");

describe("createMailer", () => {
  it("uses Cloudflare Email when the binding and a sender are set", async () => {
    const send = vi.fn(async () => ({ messageId: "m1" }));
    const m = createMailer({ EMAIL: { send }, EMAIL_FROM: "CourseMateAI <no-reply@study.example.com>" });
    expect([m.via, m.canSend]).toEqual(["cloudflare", true]);
    await m.send(mail);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@x.io", from: "CourseMateAI <no-reply@study.example.com>", subject: mail.subject }));
  });

  it("falls back to Resend", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const m = createMailer({ RESEND_API_KEY: "re_x", EMAIL_FROM: "no-reply@x.io" }, fetchImpl);
    expect(m.via).toBe("resend");
    await m.send(mail);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_x");
    expect(JSON.parse(init.body)).toMatchObject({ from: "no-reply@x.io", to: ["a@x.io"] });
  });

  it("reports a refused email", async () => {
    const fetchImpl = (async () => new Response("no", { status: 422 })) as unknown as typeof fetch;
    await expect(createMailer({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@x.io" }, fetchImpl).send(mail)).rejects.toThrow(/422/);
  });

  it("without an email service it only writes the code to the Worker log", async () => {
    const log = vi.fn();
    const m = createMailer({ EMAIL_FROM: "a@x.io" }, fetch, log);
    expect([m.via, m.canSend]).toEqual(["log", false]);
    await m.send(mail);
    expect(log.mock.calls[0][0]).toContain("123456");
    expect(log.mock.calls[0][0]).toContain("to=a@x.io");
  });
});

describe("codeMail", () => {
  it("puts the code in the text and the html, and escapes", () => {
    const m = codeMail("a@x.io", "<9>", "forget-password");
    expect(m.subject).toBe("Reset your CourseMateAI password");
    expect(m.text).toContain("<9>");
    expect(m.html).toContain("&lt;9&gt;");
  });
});
