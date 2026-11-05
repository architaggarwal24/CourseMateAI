// Whole user flows for route tests: sign up + verify, upload a PDF (start, file, pages).
import { expect } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as upload from "@/app/api/v1/upload/route";
import * as file from "@/app/api/v1/documents/[id]/file/route";
import * as pages from "@/app/api/v1/documents/[id]/pages/route";
import { Browser, json, ORIGIN, type fakeMailer } from "./auth-helpers";

let ip = 100;
export const params = <T,>(v: T) => ({ params: Promise.resolve(v) });

export async function person(mail: ReturnType<typeof fakeMailer>, email: string, username: string): Promise<Browser> {
  const b = new Browser(`203.0.113.${ip++ % 250}`);
  await authRoute.POST(b.request("/api/auth/sign-up/email", { body: { email, password: "correct-horse-1", name: username, username } }));
  b.keep(await authRoute.POST(b.request("/api/auth/email-otp/verify-email", { body: { email, otp: mail.lastCode(email) } })));
  return b;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function uploadPdf(b: Browser, name: string, pageTexts: { page: number; text: string }[]): Promise<string> {
  const bytes = new Uint8Array(1024);
  bytes.set(new TextEncoder().encode(`%PDF-1.7 ${name}`));
  const started = await json(await upload.POST(b.request("/api/v1/upload", {
    body: { filename: name, size: bytes.length, pages: pageTexts.length, file_hash: await sha256(bytes) },
  })));
  const id = started.session_id as string;
  const put = await file.PUT(new Request(`${ORIGIN}/api/v1/documents/${id}/file`, {
    method: "PUT", headers: { cookie: b.header(), origin: ORIGIN }, body: bytes, duplex: "half",
  } as RequestInit), params({ id }));
  expect(put.status).toBe(200);
  const done = await pages.POST(b.request(`/api/v1/documents/${id}/pages`, { body: { pages: pageTexts, done: true } }), params({ id }));
  expect(done.status).toBe(200);
  return id;
}

/** The events of a Server-Sent Events body. */
export async function sseEvents(res: Response): Promise<{ event: string; data: any }[]> {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((block) => {
    const event = block.match(/^event: (.*)$/m)?.[1] ?? "message";
    const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? "null");
    return { event, data };
  });
}
