/** @vitest-environment node */
// Performance pass (Stage P2): D1 round trips per request on the routes every screen calls. On Cloudflare each
// round trip is a network hop from the Worker to the database, so the count is what makes a route slow. The budgets
// below are today's counts after the pass: a change that adds a query to a hot route fails here and has to say why.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as me from "@/app/api/v1/auth/me/route";
import * as hud from "@/app/api/v1/hud/route";
import * as documents from "@/app/api/v1/documents/route";
import * as document from "@/app/api/v1/documents/[id]/route";
import * as reviewStats from "@/app/api/v1/review/stats/route";
import * as reviewQueue from "@/app/api/v1/review/queue/route";
import * as quests from "@/app/api/v1/daily-quests/route";
import * as shop from "@/app/api/v1/shop/route";
import * as profile from "@/app/api/v1/profile/route";
import * as achievements from "@/app/api/v1/achievements/route";
import * as entitlements from "@/app/api/v1/entitlements/route";
import * as usage from "@/app/api/v1/account/usage/route";
import * as courses from "@/app/api/v1/courses/route";
import * as course from "@/app/api/v1/courses/[id]/route";
import * as courseProgress from "@/app/api/v1/courses/[id]/progress/route";
import * as conceptMap from "@/app/api/v1/concept-map/route";
import * as history from "@/app/api/v1/history/route";
import * as bestiary from "@/app/api/v1/bestiary/route";
import * as bestiaryPage from "@/app/api/v1/bestiary/[species]/route";
import * as avatar from "@/app/api/v1/avatar/route";
import * as champion from "@/app/api/v1/avatar/champion/route";
import * as questBoard from "@/app/api/v1/quests/route";
import { currentUser, requestContext, rowFromSessionUser, setMailerForTests } from "./context";
import { eq } from "drizzle-orm";
import { user as userTable } from "./db/schema";
import { setEnvForTests } from "./env";
import { setSearchForTests } from "./search";
import { fakeMailer, json, SETTINGS, type Browser } from "./test/auth-helpers";
import { localPlatform, type LocalPlatform } from "./test/platform";
import { fakeEmbedder, fakeVectors } from "./test/search-fakes";
import { params, person, uploadPdf } from "./test/flows";
import { countQueries, type QueryCounter } from "./test/queries";

let p: LocalPlatform;
let q: QueryCounter;
let b: Browser;
let docs: string[] = [];
let courseId = "";

const PAGES = (n: string) => [
  { page: 1, text: `${n} basics. The cell membrane controls what enters and leaves the cell. Membrane proteins move ions.` },
  { page: 2, text: `${n} energy. Mitochondria make ATP through cellular respiration using glucose and oxygen.` },
];

beforeAll(async () => {
  p = await localPlatform();
  q = countQueries(p.env.DB);
  setEnvForTests({ ...p.env, DB: q.db });
  const mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
  // A student on Archmage (granted, like an invite would): every feature open, and the plan is read from the table as
  // for any paying user (the owner account skips that read, so it would undercount).
  b = await person(mail, "student@example.com", "student");
  const me0 = await json(await me.GET(b.request("/api/v1/auth/me")));
  const t = new Date().toISOString();
  await p.env.DB.prepare("INSERT INTO user_plans (user_id, tier, source, started_at, updated_at) VALUES (?, 'archmage', 'admin', ?, ?)")
    .bind(me0.user_id, t, t).run();
  docs = [await uploadPdf(b, "bio.pdf", PAGES("Biology")), await uploadPdf(b, "chem.pdf", PAGES("Chemistry")), await uploadPdf(b, "phys.pdf", PAGES("Physics"))];
  const made = await json(await courses.POST(b.request("/api/v1/courses", { body: { name: "Science", document_ids: docs } })));
  courseId = made.id;
  // Warm up once: first-visit rows (progress, today's quests, the avatar) are created on the first read.
  for (const [, run] of routes()) await run();
}, 120_000);

afterAll(async () => {
  setEnvForTests(null);
  await p.dispose();
});

type Route = [name: string, run: () => Promise<Response>];
function routes(): Route[] {
  const get = (path: string) => b.request(path);
  return [
    ["GET /auth/me", () => me.GET(get("/api/v1/auth/me"))],
    ["GET /hud", () => hud.GET(get("/api/v1/hud"))],
    ["GET /documents", () => documents.GET(get("/api/v1/documents"))],
    ["GET /documents/:id", () => document.GET(get(`/api/v1/documents/${docs[0]}`), params({ id: docs[0] }))],
    ["GET /documents/:course", () => document.GET(get(`/api/v1/documents/${courseId}`), params({ id: courseId }))],
    ["GET /review/stats", () => reviewStats.GET(get("/api/v1/review/stats"))],
    ["GET /review/queue", () => reviewQueue.GET(get("/api/v1/review/queue"))],
    ["GET /daily-quests", () => quests.GET(get("/api/v1/daily-quests"))],
    ["GET /shop", () => shop.GET(get("/api/v1/shop"))],
    ["GET /profile", () => profile.GET(get("/api/v1/profile"))],
    ["GET /achievements", () => achievements.GET(get("/api/v1/achievements"))],
    ["GET /entitlements", () => entitlements.GET(get("/api/v1/entitlements"))],
    ["GET /account/usage", () => usage.GET(get("/api/v1/account/usage"))],
    ["GET /avatar", () => avatar.GET(get("/api/v1/avatar"))],
    ["GET /avatar/champion", () => champion.GET(get("/api/v1/avatar/champion"))],
    ["GET /courses", () => courses.GET(get("/api/v1/courses"))],
    ["GET /courses/:id", () => course.GET(get(`/api/v1/courses/${courseId}`), params({ id: courseId }))],
    ["GET /courses/:id/progress", () => courseProgress.GET(get(`/api/v1/courses/${courseId}/progress`), params({ id: courseId }))],
    ["GET /concept-map (course)", () => conceptMap.GET(get(`/api/v1/concept-map?session_id=${courseId}`))],
    ["GET /history", () => history.GET(get("/api/v1/history"))],
    ["GET /bestiary", () => bestiary.GET(get("/api/v1/bestiary"))],
    ["GET /bestiary/:species", () => bestiaryPage.GET(get("/api/v1/bestiary/minotaur"), params({ species: "minotaur" }))],
    ["GET /quests", () => questBoard.GET(get("/api/v1/quests"))],
  ];
}

/** Round trips per route after the performance pass. Lower is fine (lower the number); higher needs a reason. */
const BUDGET: Record<string, number> = {
  "GET /auth/me": 4,
  "GET /hud": 7, // +1: the "you've been upgraded" notice (one indexed read, alongside the others)
  "GET /documents": 4,
  "GET /documents/:id": 4,
  "GET /documents/:course": 5,
  "GET /review/stats": 4,
  "GET /review/queue": 7,
  "GET /daily-quests": 4,
  "GET /shop": 6,
  "GET /profile": 4,
  "GET /achievements": 5, // +1 Stage B1: the Bestiary counts (banes found, creatures beaten)
  "GET /entitlements": 3,
  "GET /account/usage": 9,
  "GET /avatar": 3,
  "GET /avatar/champion": 5, // +1 champion mastery: the challenge rows
  "GET /courses": 5,
  "GET /courses/:id": 5,
  "GET /courses/:id/progress": 6,
  "GET /concept-map (course)": 7,
  "GET /history": 3,
  "GET /bestiary": 3,
  "GET /bestiary/:species": 4,
  "GET /quests": 7,   // Stage Q1: the board (daily quests, avatar, roster batch, scrolls)
};

describe("D1 round trips on the hot routes", () => {
  const counts: Record<string, number> = {};
  const logs: Record<string, string[]> = {};
  it.each(routes().map(([name]) => [name]))("%s", async (name) => {
    const run = routes().find(([n]) => n === name)![1];
    q.reset();
    const res = await run();
    expect(res.status, name).toBe(200);
    counts[name] = q.count();
    logs[name] = q.log();
    const budget = BUDGET[name];
    if (budget !== undefined) expect(q.count(), `${name}:\n${q.log().join("\n")}`).toBeLessThanOrEqual(budget);
  });
  // PRINT_QUERIES=path writes the counts (and each route's SQL) to a JSON file, for a before/after comparison.
  afterAll(async () => {
    if (!process.env.PRINT_QUERIES) return;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.PRINT_QUERIES, JSON.stringify({ counts, sql: logs }, null, 2));
  });
});

describe("who is signed in", () => {
  it("reads the session and the account row in two round trips, the same row the table holds", async () => {
    const req = b.request("/api/v1/auth/me");
    const ctx = await requestContext(req);
    q.reset();
    const u = await currentUser(req, ctx);
    expect(q.count(), q.log().join("\n")).toBeLessThanOrEqual(2);
    const row = await ctx.db.select().from(userTable).where(eq(userTable.id, u!.id)).get();
    expect(u!.row).toEqual(row);
    expect(u!.owner).toBe(false);
  });
});

describe("the account row from the session", () => {
  it("falls back to reading the table when Better Auth's user lacks a column", () => {
    expect(rowFromSessionUser({ id: "3", name: "A", email: "a@example.com" })).toBeNull();
  });
});
