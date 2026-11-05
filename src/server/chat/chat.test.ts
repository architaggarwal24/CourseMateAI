/** @vitest-environment node */
// Chat on the Worker (Stage 4.3): retrieval, relevance, citations, follow-up rewriting, streaming.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chat from "@/app/api/v1/chat/route";
import * as chatStream from "@/app/api/v1/chat/stream/route";
import * as usage from "@/app/api/v1/account/usage/route";
import * as adminAi from "@/app/api/v1/admin/ai/route";
import * as adminRole from "@/app/api/v1/admin/users/[id]/role/route";
import * as me from "@/app/api/v1/auth/me/route";
import { setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests } from "../ai/run";
import { fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, sseEvents, uploadPdf } from "../test/flows";
import { isSelfContained, standaloneQuestion } from "./rewrite";
import { toRetrieval } from "./index";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let llm: ReturnType<typeof fakeLlms>;

const BIO = [
  { page: 1, text: "Cell biology basics. The cell membrane controls what enters and leaves the cell." },
  { page: 2, text: "Mitochondria make ATP through cellular respiration. Respiration uses glucose and oxygen." },
];

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV, RELEVANCE_BLOCK_BELOW: "0.2", RELEVANCE_CLARIFY_BELOW: "0.35" })) vi.stubEnv(k, v as string);
  llm = fakeLlms({
    "gemini:flash-lite": "Mitochondria make ATP [1].",
    "gemini:flash": "Mitochondria make ATP [1].",
    "claude:sonnet": "Mitochondria make ATP [1].",
    "workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8": "How do mitochondria make ATP?",
  });
  setLlmFactoryForTests(llm.factory);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

describe("POST /chat", () => {
  it("answers from the document with numbered citations naming the page", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "How do mitochondria make ATP?", session_id: id } })));
    expect(r).toMatchObject({ mode: "chat", content: "Mitochondria make ATP [1].", blocked: false });
    expect(r.citations[0]).toMatchObject({ n: 1, doc_id: id, doc_name: "Bio.pdf", page: 2, label: "Bio.pdf · p.2" });
    expect(r.sources[0]).toBe("Bio.pdf · p.2");
    const prompt = llm.calls.at(-1)!.messages.at(-1)!.content;
    expect(prompt).toContain("[1] (Bio.pdf · p.2)");
    expect(llm.calls.at(-1)!.target).toBe("gemini:flash-lite");             // Apprentice's strong job: the fast model first
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u.used.ai_calls_day).toBe(1);
  });

  it("a question the document doesn't cover is refused without asking a model", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "Who won the 1998 football world cup?", session_id: id } })));
    expect(r).toMatchObject({ blocked: true, citations: [], content: expect.stringMatching(/cannot find/) });
    expect(llm.calls).toHaveLength(0);
  });

  it("checks the question, and the document", async () => {
    const b = await person(mail, "free@example.com", "free");
    expect((await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "hi", session_id: "x" } })))).error.message).toBe("Question is too short");
    expect((await chat.POST(b.request("/api/v1/chat", { body: { question: "What is ATP?", session_id: "nope" } }))).status).toBe(404);
  });

  it("a follow-up is rewritten (a small job, on Workers AI) before searching", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const history = [{ role: "user", content: "What do mitochondria do?" }, { role: "assistant", content: "They make ATP." }];
    await chat.POST(b.request("/api/v1/chat", { body: { question: "How do they do it?", session_id: id, history } }));
    expect(llm.calls[0].target).toBe("workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(llm.calls[0].messages[1].content).toContain("Latest question: How do they do it?");
  });
});

describe("POST /chat/stream", () => {
  it("streams token events, then the sources with citations", async () => {
    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const res = await chatStream.POST(b.request("/api/v1/chat/stream", { body: { question: "How do mitochondria make ATP?", session_id: id } }));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events = await sseEvents(res);
    const text = events.filter((e) => e.event === "token").map((e) => e.data.text).join("");
    expect(text).toBe("Mitochondria make ATP [1].");
    expect(events.at(-1)).toMatchObject({ event: "sources", data: { mode: "chat", blocked: false } });
    expect(events.at(-1)!.data.citations[0]).toMatchObject({ n: 1, page: 2 });
    expect(llm.calls.at(-1)!.target).toBe("claude:sonnet");                  // the owner is Archmage: the premium model
  });

  it("a failure before the first word is an ordinary error", async () => {
    setLlmFactoryForTests(fakeLlms({ "*": new Error("down") }).factory);
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const res = await chatStream.POST(b.request("/api/v1/chat/stream", { body: { question: "How do mitochondria make ATP?", session_id: id } }));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_unavailable");
  });
});

describe("Admin -> AI", () => {
  it("shows the spend per model and lets the owner set the daily cap", async () => {
    const owner = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(owner, "Bio.pdf", BIO);
    await chat.POST(owner.request("/api/v1/chat", { body: { question: "How do mitochondria make ATP?", session_id: id } }));
    const r = await json(await adminAi.GET(owner.request("/api/v1/admin/ai")));
    expect(r).toMatchObject({ cap_usd: 2, capped: false, models: [{ provider: "claude", model: "sonnet", calls: 1 }] });
    expect(r.routes.apprentice.strong[0]).toBe("gemini:flash-lite");
    expect(r).toMatchObject({ cap_max_usd: 20, can_edit: true });
    const set = await json(await adminAi.PUT(owner.request("/api/v1/admin/ai", { method: "PUT", body: { cap_usd: 5 } })));
    expect(set.cap_usd).toBe(5);
    expect((await adminAi.PUT(owner.request("/api/v1/admin/ai", { method: "PUT", body: { cap_usd: -1 } }))).status).toBe(400);
    const student = await person(mail, "s@example.com", "student");
    expect((await adminAi.GET(student.request("/api/v1/admin/ai"))).status).toBe(403);
  });

  it("only the owner changes the cap, never above the hard ceiling and never off", async () => {
    const owner = await person(mail, "owner@example.com", "boss");
    for (const cap_usd of [25, null, 10_000]) {
      const res = await adminAi.PUT(owner.request("/api/v1/admin/ai", { method: "PUT", body: { cap_usd } }));
      expect(res.status, String(cap_usd)).toBe(400);
      expect((await json(res)).error.code).toBe("invalid_cap");
    }
    expect((await json(await adminAi.PUT(owner.request("/api/v1/admin/ai", { method: "PUT", body: { cap_usd: 20 } })))).cap_usd).toBe(20);

    const helper = await person(mail, "helper@example.com", "helper");
    const hid = (await json(await me.GET(helper.request("/api/v1/auth/me")))).user_id;
    await adminRole.PUT(owner.request(`/api/v1/admin/users/${hid}/role`, { method: "PUT", body: { role: "admin" } }), params({ id: String(hid) }));
    const seen = await json(await adminAi.GET(helper.request("/api/v1/admin/ai")));
    expect(seen).toMatchObject({ cap_usd: 20, can_edit: false });
    const res = await adminAi.PUT(helper.request("/api/v1/admin/ai", { method: "PUT", body: { cap_usd: 1 } }));
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("owner_only");
  });
});

describe("rewrite and citations", () => {
  it("knows a standalone question from a follow-up", () => {
    expect(isSelfContained("What is osmosis?")).toBe(true);
    expect(isSelfContained("Why does it happen?")).toBe(false);
    expect(isSelfContained("And the second one?")).toBe(false);
    expect(isSelfContained("Why?")).toBe(false);
  });

  it("a failed rewrite falls back to the previous question", async () => {
    const r = await standaloneQuestion("Why does it happen?", [{ role: "user", content: "Explain osmosis" }], async () => { throw new Error("x"); });
    expect(r).toEqual({ query: "Explain osmosis Why does it happen?", method: "fallback" });
  });

  it("drops a passage another one already contains", () => {
    const p = (text: string, score: number) => ({ documentId: "d", documentName: "D.pdf", idx: 0, page: 1, text, score });
    const r = toRetrieval([p("ATP is made in mitochondria by respiration.", 0.9), p("ATP is made in mitochondria", 0.8), p("Other text.", 0.5)]);
    expect(r.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(r.passages.map((x) => x.text)).toEqual(["ATP is made in mitochondria by respiration.", "Other text."]);
  });
});
