/** @vitest-environment node */
// Chat on the Worker (Stage 4.3): retrieval, relevance, citations, follow-up rewriting, streaming.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chat from "@/app/api/v1/chat/route";
import * as chatStream from "@/app/api/v1/chat/stream/route";
import * as usage from "@/app/api/v1/account/usage/route";
import * as adminAi from "@/app/api/v1/admin/ai/route";
import * as adminAiModels from "@/app/api/v1/admin/ai/models/route";
import * as adminAiMine from "@/app/api/v1/admin/ai/mine/route";
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
import { getDb } from "../db";
import { DEFAULT_BUDGETS, saveBudgets } from "../ai/budget";
import { isConversation, isQuizRequest, subjectLine } from "./prompts";

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
    "workers-ai:@cf/google/gemma-4-26b-a4b-it": "How do mitochondria make ATP?",
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

  it("says when the day's AI budget sent the answer to a lighter model, and whether this user can top up", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const ask = async () => json(await chat.POST(b.request("/api/v1/chat", { body: { question: "How do mitochondria make ATP?", session_id: id } })));
    expect(await ask()).toMatchObject({ budget: null, can_top_up: false });
    llm = fakeLlms({ "*": "Mitochondria make ATP [1]." });
    setLlmFactoryForTests(llm.factory);
    await saveBudgets(getDb(p.env.DB), { ...DEFAULT_BUDGETS, plan: { ...DEFAULT_BUDGETS.plan, apprentice: 0 } });
    expect(await ask()).toMatchObject({ budget: "limited", can_top_up: false });
    expect(llm.calls.at(-1)!.target).toBe("workers-ai:@cf/google/gemma-4-26b-a4b-it");
  });

  it("files attached to a question: documents fenced in the prompt, pictures to a model that can see, nothing stored", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const attachments = [
      { kind: "text", name: "homework.docx", text: "Q3: Explain why plant cells don't burst in water." },
      { kind: "image", name: "diagram.jpg", mime: "image/jpeg", data: "aGVsbG8=" },
    ];
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "Help me with Q3 from my homework", session_id: id, attachments } })));
    expect(r).toMatchObject({ coverage: "attached", blocked: false });
    const call = llm.calls.at(-1)!;
    expect(call.target).toBe("gemini:flash-lite");                                  // sees pictures
    const last = call.messages.at(-1)!;
    expect(last.content).toContain('Attached file "homework.docx":\n⟦MATERIAL⟧\nQ3: Explain why plant cells');
    expect(last.images).toEqual([{ mime: "image/jpeg", data: "aGVsbG8=" }]);
    const logged = await p.env.DB.prepare("SELECT content FROM activity_log WHERE action_type = 'query' ORDER BY id DESC").first<{ content: string }>();
    expect(logged!.content).toContain("homework.docx, diagram.jpg");
    expect(logged!.content).not.toContain("aGVsbG8=");                              // the picture itself isn't kept
    const bad = await chat.POST(b.request("/api/v1/chat", { body: { question: "x?", session_id: id, attachments: [{ kind: "image", name: "a.gif", mime: "image/gif", data: "aGk=" }] } }));
    expect((await json(bad)).error).toMatchObject({ code: "invalid_input", details: { field: "attachments" } });
  });

  it("a picture question past the budget says it needs the full model, instead of a text-only model guessing", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    await saveBudgets(getDb(p.env.DB), { ...DEFAULT_BUDGETS, plan: { ...DEFAULT_BUDGETS.plan, apprentice: 0 } });
    const before = llm.calls.length;
    const res = await chat.POST(b.request("/api/v1/chat", { body: { question: "What is in this picture?", session_id: id,
      attachments: [{ kind: "image", name: "cell.jpg", mime: "image/jpeg", data: "aGVsbG8=" }] } }));
    expect(res.status).toBe(429);
    expect((await json(res)).error).toMatchObject({ code: "budget_images", action: "plans", details: { can_top_up: false } });
    expect(llm.calls.slice(before).map((c) => c.target)).not.toContain("workers-ai:@cf/google/gemma-4-26b-a4b-it");
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u.used.ai_calls_day).toBe(0);                                             // nothing answered: the call is given back
  });

  it("a question the material doesn't cover still gets an honest answer (told it isn't covered; nothing cited)", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "Who won the 1998 football world cup?", session_id: id } })));
    expect(r).toMatchObject({ blocked: false, coverage: "none", citations: [], sources: [] });
    expect(llm.calls.at(-1)!.messages[0].content).toMatch(/does not seem to cover this question/);
  });

  it("a greeting is a conversation: no search, no rewards, the tutor answers as a person", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    llm = fakeLlms({ "*": "Hey! Want to start with how cells get their energy?" });
    setLlmFactoryForTests(llm.factory);
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "hi", session_id: id } })));
    expect(r).toMatchObject({ coverage: "conversation", citations: [], rewards: null, content: expect.stringMatching(/Hey!/) });
    expect(llm.calls).toHaveLength(1);                                         // no rewrite, no search
    const [system, user] = llm.calls[0].messages;
    expect(system.content).toMatch(/This message is conversation/);
    expect(system.content).toMatch(/The student is studying: Bio\.pdf/);
    expect(user.content).toBe("hi");
  });

  it("checks the question, and the document", async () => {
    const b = await person(mail, "free@example.com", "free");
    expect((await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "   ", session_id: "x" } })))).error.message).toBe("Question cannot be empty");
    expect((await chat.POST(b.request("/api/v1/chat", { body: { question: "What is ATP?", session_id: "nope" } }))).status).toBe(404);
  });

  it("teaches in the mode the student picked; the tutor talks like a teacher and offers follow-ups", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "How do mitochondria make ATP?", session_id: id, mode: "socratic" } })));
    expect(r.tutor_mode).toBe("socratic");
    const system = llm.calls.at(-1)!.messages[0].content;
    expect(system).toMatch(/personal tutor/);
    expect(system).toMatch(/MODE: Socratic/);
    expect(system).toMatch(/write exactly "---"/);
    expect(system).not.toMatch(/MODE: Explain/);
    // an unknown mode is Explain
    await chat.POST(b.request("/api/v1/chat", { body: { question: "How do mitochondria make ATP?", session_id: id, mode: "nonsense" } }));
    expect(llm.calls.at(-1)!.messages[0].content).toMatch(/MODE: Explain/);
  });

  it("Quiz me without a topic quizzes on what was just discussed", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const history = [{ role: "user", content: "How do mitochondria make ATP?" }, { role: "assistant", content: "Through cellular respiration [1]." }];
    const r = await json(await chat.POST(b.request("/api/v1/chat", { body: { question: "quiz me", session_id: id, mode: "quiz", history } })));
    expect(r.tutor_mode).toBe("quiz");
    expect(llm.calls.map((c) => c.target)).not.toContain("workers-ai:@cf/google/gemma-4-26b-a4b-it");   // no rewrite needed
    const last = llm.calls.at(-1)!.messages;
    expect(last[0].content).toMatch(/MODE: Quiz me/);
    expect(last.at(-1)!.content).toContain("[1] (Bio.pdf · p.2)");             // searched for the last topic
  });

  it("a follow-up is rewritten (a small job, on Workers AI) before searching", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const history = [{ role: "user", content: "What do mitochondria do?" }, { role: "assistant", content: "They make ATP." }];
    await chat.POST(b.request("/api/v1/chat", { body: { question: "How do they do it?", session_id: id, history } }));
    expect(llm.calls[0].target).toBe("workers-ai:@cf/google/gemma-4-26b-a4b-it");
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
  it("admins set the models for everyone and their own; students can't, and Ollama is hidden outside next dev", async () => {
    const owner = await person(mail, "owner@example.com", "boss");
    const view = await json(await adminAiModels.GET(owner.request("/api/v1/admin/ai/models")));
    expect(view).toMatchObject({ slots: {}, mine: null, ollama: { enabled: false, models: [] } });
    expect(view.defaults.fast).toBe("gemini:flash-lite");
    expect(view.providers.map((x: { id: string }) => x.id)).not.toContain("ollama");
    const saved = await json(await adminAiModels.PUT(owner.request("/api/v1/admin/ai/models", { method: "PUT", body: { slots: { fast: "claude:haiku" } } })));
    expect(saved.slots).toEqual({ fast: "claude:haiku" });
    expect((await json(await adminAi.GET(owner.request("/api/v1/admin/ai")))).routes.apprentice.strong[0]).toBe("claude:haiku");
    const bad = await adminAiModels.PUT(owner.request("/api/v1/admin/ai/models", { method: "PUT", body: { slots: { strong: "openai:gpt-5" } } }));
    expect((await json(bad)).error.code).toBe("provider_not_configured");
    expect((await json(await adminAiMine.PUT(owner.request("/api/v1/admin/ai/mine", { method: "PUT", body: { spec: "claude:opus" } })))).spec).toBe("claude:opus");
    expect((await adminAiMine.PUT(owner.request("/api/v1/admin/ai/mine", { method: "PUT", body: { spec: "ollama:llama3" } }))).status).toBe(400);
    const student = await person(mail, "s2@example.com", "student2");
    expect((await adminAiModels.GET(student.request("/api/v1/admin/ai/models"))).status).toBe(403);
    expect((await adminAiMine.PUT(student.request("/api/v1/admin/ai/mine", { method: "PUT", body: { spec: "claude:opus" } }))).status).toBe(403);
  });

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

  it("the owner sets the plan, user and free-tool budgets; a bad value saves nothing; students and admins can't", async () => {
    const owner = await person(mail, "owner@example.com", "boss");
    const r = await json(await adminAi.GET(owner.request("/api/v1/admin/ai")));
    expect(r.budgets).toEqual({ plan: { apprentice: 0.25, scholar: null, sage: null, archmage: null }, user: { apprentice: 0.02, scholar: 0.05, sage: 0.1, archmage: 0.2 }, tools: 0.1 });
    expect(r.budget_today).toEqual({});
    const budgets = { ...r.budgets, plan: { ...r.budgets.plan, apprentice: 0.5 }, tools: null };
    const set = await json(await adminAi.PUT(owner.request("/api/v1/admin/ai", { method: "PUT", body: { budgets } })));
    expect(set.budgets).toEqual(budgets);
    expect(set.cap_usd).toBe(2);                                                   // the cap is left alone
    const bad = await adminAi.PUT(owner.request("/api/v1/admin/ai", { method: "PUT", body: { cap_usd: 3, budgets: { ...budgets, tools: 99 } } }));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatchObject({ code: "invalid_budget", details: { field: "tools", max: 20 } });
    expect((await json(await adminAi.GET(owner.request("/api/v1/admin/ai")))).cap_usd).toBe(2);   // nothing was saved
    const student = await person(mail, "s3@example.com", "student3");
    expect((await adminAi.PUT(student.request("/api/v1/admin/ai", { method: "PUT", body: { budgets } }))).status).toBe(403);
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

  it("tells conversation from a question, and a quiz request from an answer", () => {
    for (const m of ["hi", "Hello!", "thanks so much", "ok", "who are you?", "what can you do", "I'm confused"]) expect(isConversation(m), m).toBe(true);
    for (const m of ["hi, what is osmosis?", "Thanks, but why does ATP matter?", "What is ATP?", "ok so how does respiration work"]) expect(isConversation(m), m).toBe(false);
    expect(isQuizRequest("quiz me")).toBe(true);
    expect(isQuizRequest("next question")).toBe(true);
    expect(isQuizRequest("mitochondria")).toBe(false);
    expect(subjectLine("Biology", ["a.pdf", "b.pdf"])).toBe("Biology (a.pdf, b.pdf)");
    expect(subjectLine("a.pdf", ["a.pdf"])).toBe("a.pdf");
  });

  it("drops a passage another one already contains", () => {
    const p = (text: string, score: number) => ({ documentId: "d", documentName: "D.pdf", idx: 0, page: 1, text, score });
    const r = toRetrieval([p("ATP is made in mitochondria by respiration.", 0.9), p("ATP is made in mitochondria", 0.8), p("Other text.", 0.5)]);
    expect(r.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(r.passages.map((x) => x.text)).toEqual(["ATP is made in mitochondria by respiration.", "Other text."]);
  });
});
