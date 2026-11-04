// Answers every /api/v1 call the app makes, so the e2e run needs no backend. The JSON files in this folder are
// real responses captured from the backend (shapes stay honest); `signedIn: false` plays a visitor who is not logged in.
import type { Page, Route } from "@playwright/test";
import me from "./me.json";
import hud from "./hud.json";
import profile from "./profile.json";
import dailyQuests from "./daily-quests.json";
import shop from "./shop.json";
import avatar from "./avatar.json";
import achievements from "./achievements.json";
import providers from "./providers.json";
import apiKey from "./api-key.json";

export const DOCUMENT = {
  id: "doc-1", filename: "Cell Biology.pdf", file_hash: "abc123", status: "ready", error: null, chunks: 42,
  embedding_model: "bge-small", created_at: "2026-10-14T09:00:00Z", last_used_at: "2026-10-15T09:00:00Z",
};

export const DOCUMENT_2 = {
  ...DOCUMENT, id: "doc-2", filename: "Organic Chemistry.pdf", file_hash: "def456", chunks: 31, last_used_at: "2026-10-14T09:00:00Z",
};
/** Phase 3 Stage 3B: a course over both documents (GET /courses, and its record through GET /documents/{id}). */
export const COURSE = {
  id: "course-1", name: "Life sciences", description: "Midterm: cells and molecules", created_at: "2026-10-16T09:00:00Z",
  updated_at: "2026-10-16T09:00:00Z", ready: 2,
  documents: [{ id: "doc-1", filename: "Cell Biology.pdf", status: "ready", chunks: 42 }, { id: "doc-2", filename: "Organic Chemistry.pdf", status: "ready", chunks: 31 }],
};
const COURSE_VIEW = { ...DOCUMENT, id: COURSE.id, filename: COURSE.name, file_hash: `course:${COURSE.id}`, chunks: 73, kind: "course", documents: ["doc-1", "doc-2"] };
const COURSE_PROGRESS = {
  course_id: COURSE.id, mastery: 0.4, concepts: { seen: 10, strong: 4, weak: 3, weakest: ["Osmosis", "Glycolysis", "Chirality"] },
  answers: { total: 38, correct: 26, accuracy: 0.6842 }, review: { cards: 24, due: 6 },
  exams: [{ id: "e-1", accuracy: 0.7, submitted_at: "2026-10-17T09:00:00Z" }],
  documents: [{ id: "doc-1", filename: "Cell Biology.pdf", concepts: 7, answered: 30, accuracy: 0.7 },
              { id: "doc-2", filename: "Organic Chemistry.pdf", concepts: 0, answered: 0, accuracy: null }],
};

/** The concept map of DOCUMENT (GET /concept-map; POST answers it at once, as if it had been built before). */
const MAP_CONCEPTS = [
  ["atp", "ATP", 3, "strong", "The cell's energy currency."], ["mitochondria", "Mitochondria", 3, "weak", "Where most ATP is made."],
  ["glycolysis", "Glycolysis", 2, "learning", "Glucose split into pyruvate in the cytoplasm."], ["krebs cycle", "Krebs cycle", 2, "new", "Oxidises acetyl-CoA."],
  ["electron transport chain", "Electron transport chain", 2, "strong", "Pumps protons to drive ATP synthase."],
  ["nadh", "NADH", 1, "learning", "Carries electrons."], ["osmosis", "Osmosis", 1, "new", "Water across a membrane."],
  ["cell membrane", "Cell membrane", 2, "weak", "Lipid bilayer around the cell."],
].map(([id, name, importance, heat, summary]) => ({ id, name, importance, heat, summary, pages: [{ doc_id: "doc-1", page: 2 }], docs: ["doc-1"],
  seen: heat === "new" ? 0 : 5, correct: heat === "strong" ? 5 : heat === "learning" ? 3 : heat === "weak" ? 1 : 0 }));
export const CONCEPT_MAP = {
  scope: { id: "doc-1", kind: "document", name: "Cell Biology.pdf" }, status: "ready", stage: null, built: 1, total: 1,
  documents: [{ id: "doc-1", name: "Cell Biology.pdf", status: "ready", stage: null, error: null }], concepts: MAP_CONCEPTS,
  relations: [["mitochondria", "atp", "produce"], ["glycolysis", "atp", "yields"], ["krebs cycle", "nadh", "makes"],
    ["electron transport chain", "atp", "drives"], ["nadh", "electron transport chain", "feeds"], ["krebs cycle", "mitochondria", "happens in"],
    ["osmosis", "cell membrane", "crosses"], ["glycolysis", "krebs cycle", "feeds"]].map(([source, target, label]) => ({ source, target, label })),
};

/** Phase 3 Stage 4a: the plans (GET /plans) and the account's use of its plan (GET /account/usage). */
const lim = (documents: number, pdf_mb: number, ai_calls_day: number, tokens_month: number, courses: number) =>
  ({ documents, pdf_mb, ai_calls_day, tokens_month, courses });
export const PLANS = {
  invite_only: false, managed_ai: true, payments_enabled: false, currency: "INR",
  plans: [
    { tier: "apprentice", name: "Apprentice", tagline: "Try every core tool on a few PDFs.", price_month: 0, price_year: 0, currency: "INR",
      limits: lim(3, 10, 25, 300000, 0), features: [], highlights: ["Chat, quizzes, notes and flashcards", "The arena and your champion"] },
    { tier: "scholar", name: "Scholar", tagline: "For a semester: more PDFs and the daily review queue.", price_month: 149, price_year: 1490, currency: "INR",
      limits: lim(15, 25, 150, 3000000, 0), features: ["review_queue"], highlights: ["Everything in Apprentice", "Spaced-repetition review"] },
    { tier: "sage", name: "Sage", tagline: "Courses, exams, the concept map and the PDF viewer.", price_month: 299, price_year: 2990, currency: "INR",
      limits: lim(50, 50, 400, 10000000, 10), features: ["review_queue", "exam_mode", "courses", "concept_map", "pdf_viewer"],
      highlights: ["Everything in Scholar", "Courses across PDFs", "Mock exams with a report", "Concept map and PDF viewer"] },
    { tier: "archmage", name: "Archmage", tagline: "Everything, with the most room and the strongest models.", price_month: 599, price_year: 5990, currency: "INR",
      limits: lim(150, 50, 1200, 30000000, 30), features: ["review_queue", "exam_mode", "courses", "concept_map", "pdf_viewer"],
      highlights: ["Everything in Sage", "Strongest models first", "The largest limits"] },
  ],
};
const USAGE = {
  tier: "scholar", tier_name: "Scholar", source: "invite", expires_at: "2026-12-04T09:00:00+00:00", limits: lim(15, 25, 150, 3000000, 0),
  used: { ai_calls_day: 126, tokens_month: 412000, documents: 1, courses: 0 },
  own_key: { active: false, exempt: true, calls_today: 0, tokens_month: 0 },
  resets: { ai_calls_day: "2026-11-05T00:00:00+00:00", tokens_month: "2026-12-01T00:00:00+00:00" },
  history: [{ day: "2026-11-04", ai_calls: 126, tokens: 41000 }],
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export interface MockOptions {
  signedIn?: boolean;
  /** Level 5+ with coins, so the shop, inventory and the arena have something to show. */
  advanced?: boolean;
  documents?: typeof DOCUMENT[];
}

const ADMIN_USERS = [
  { user_id: 1, email: "alice@example.com", username: "alice", full_name: "Alice Example", email_verified: true, role: "admin", is_owner: true,
    banned: false, ban_reason: null, ban_expires: null, created_at: "2026-11-01T09:00:00Z", tier: "archmage", tier_name: "Archmage", plan: null },
  { user_id: 2, email: "ravi@example.com", username: "ravi", full_name: "Ravi Kumar", email_verified: false, role: "user", is_owner: false,
    banned: false, ban_reason: null, ban_expires: null, created_at: "2026-11-03T09:00:00Z", tier: "sage", tier_name: "Sage",
    plan: { tier: "sage", source: "admin", expires_at: "2026-12-03T09:00:00Z", started_at: "2026-11-03T09:00:00Z" } },
];
const INVITES = [
  { code: "SAGE-7KQ2M9XA", tier: "sage", tier_name: "Sage", days: 30, max_uses: 20, uses: 3, note: "first testers",
    created_at: "2026-11-02T09:00:00Z", expires_at: null, revoked: false, usable: true },
];

/** Installs the mock. Returns the list of GET paths nothing answered, so a test can say a new call needs a fixture. */
export async function mockApi(page: Page, { signedIn = true, advanced = true, documents = [DOCUMENT] }: MockOptions = {}) {
  const unanswered: string[] = [];
  const progress = { ...hud.progress, current_level: advanced ? 7 : 1, total_xp: advanced ? 1450 : 0, coins: advanced ? 320 : 0, xp_into_level: advanced ? 150 : 0, xp_to_next: 400, streak_days: advanced ? 4 : 0 };
  const shopData = { ...shop, shop_unlocked: advanced, level: progress.current_level, coins: progress.coins };
  // The account's champion (GET / PUT /avatar/champion): one per page, like the server keeps one per account.
  const champion = { champion_id: "kaien", chosen: false };
  const worn = shop.equipped as Record<string, string | undefined>;
  // Each champion's level, kit and mastery skins (Phase 3 Stage 2), as GET /avatar/champion sends them.
  const kit = (passive: string, ultimate: string) => ({ passive: { name: passive, text: `${passive}'s rule.` }, ultimate: { name: ultimate, text: `${ultimate}'s effect.` } });
  const mastery = (id: string) => [
    { id: `mastery_${id}_outfit`, slot: "armor", level: 3 }, { id: `mastery_${id}_head`, slot: "headgear", level: 6 }, { id: `mastery_${id}_weapon`, slot: "weapon", level: 10 },
  ];
  const KITS: Record<string, [string, string]> = {
    kaien: ["Riposte", "Ninth Page Cut"], asha: ["Reach", "Dawn Wall"], brak: ["Iron Combo", "Iron Rush"],
    mira: ["Quiet Study", "Arcane Library"], vex: ["Shadowstep", "Vanish"], thorne: ["Bulwark", "Last Chapter"],
  };
  const championProgress = Object.fromEntries(Object.entries(KITS).map(([id, [p, u]]) => [id, {
    xp: id === "kaien" ? 120 : 0, level: id === "kaien" ? 2 : 1, level_xp: id === "kaien" ? 100 : 0, next_level_xp: id === "kaien" ? 250 : 100,
    battles: id === "kaien" ? 3 : 0, wins: id === "kaien" ? 2 : 0, mastery: mastery(id), kit: kit(p, u),
  }]));
  const championState = () => ({
    ...champion, champions: ["kaien", "asha", "brak", "mira", "vex", "thorne"],
    loadout: { armor: worn.armor ?? null, headgear: worn.headgear ?? null, weapon: worn.weapon ?? null, pet: worn.pet ?? null },
    progress: championProgress,
  });

  const entitlements = { tier: "archmage", tier_name: "Archmage", features: {
    review_queue: { enabled: true, name: "Spaced-repetition review", required_tier: "scholar", required_tier_name: "Scholar" },
    exam_mode: { enabled: true, name: "Exam mode", required_tier: "sage", required_tier_name: "Sage" },
    courses: { enabled: true, name: "Courses", required_tier: "sage", required_tier_name: "Sage" },
    concept_map: { enabled: true, name: "Concept map", required_tier: "sage", required_tier_name: "Sage" },
    pdf_viewer: { enabled: true, name: "PDF viewer", required_tier: "sage", required_tier_name: "Sage" } } };
  const iv = { "1": 60, "2": 330, "3": 600, "4": 8 * 86400 };
  let reviewQueue = signedIn ? [
    { id: 1, front: "Which organelle makes most of the cell's ATP?", back: "Mitochondria", explanation: "Oxidative phosphorylation runs on the inner membrane.",
      concept: "Cell respiration", source: "arena", state: "new", due: "2026-11-04T09:00:00+00:00", reps: 0, lapses: 0,
      document: { session_id: DOCUMENT.id, name: DOCUMENT.filename }, intervals: iv },
    { id: 2, front: "What does osmosis move across a membrane?", back: "Water", explanation: null, concept: "Osmosis", source: "quiz",
      state: "review", due: "2026-11-04T09:00:00+00:00", reps: 3, lapses: 0, document: { session_id: DOCUMENT.id, name: DOCUMENT.filename }, intervals: iv },
  ] : [];
  let reviewedToday = 0;
  const reviewStats = () => ({ due: reviewQueue.length, learning: 0, review: reviewQueue.filter((i) => i.reps > 0).length,
    new: reviewQueue.filter((i) => !i.reps).length, new_waiting: 0, new_left_today: 19, reviewed_today: reviewedToday,
    total: 2, by_source: { flashcard: 0, arena: 1, quiz: 1, exam: 0 }, next_due_at: "2026-11-12T09:00:00+00:00", locked: false });

  type EQ = { index: number; question: string; options: string[]; answer: string | null; flagged: boolean };
  const EXAM_QS = [
    { q: "Which organelle makes most of the cell's ATP?", o: ["Nucleus", "Mitochondria", "Ribosome", "Golgi body"], a: "Mitochondria", c: "Cell respiration" },
    { q: "What moves across a membrane in osmosis?", o: ["Water", "Glucose", "Proteins", "Ions only"], a: "Water", c: "Osmosis" },
    { q: "Where does glycolysis happen?", o: ["Cytoplasm", "Nucleus", "Matrix", "Inner membrane"], a: "Cytoplasm", c: "Cell respiration" },
  ];
  const newExam = () => ({ id: "exam-1", status: "active", session_id: DOCUMENT.id, doc_name: DOCUMENT.filename, length: 3,
    difficulty: "mixed", topics: [] as string[], time_limit_s: 225, started_at: "2026-11-04T09:00:00+00:00",
    deadline: "2026-11-04T09:03:45+00:00", seconds_left: 225, answered: 0, total: 3,
    questions: EXAM_QS.map((x, i): EQ => ({ index: i, question: x.q, options: x.o, answer: null, flagged: false })) });
  let activeExam: ReturnType<typeof newExam> | null = null;
  const gradeExam = (e: ReturnType<typeof newExam>) => {
    const qs = e.questions.map((q, i) => ({ ...q, correct_answer: EXAM_QS[i].a, explanation: `${EXAM_QS[i].a} is right.`,
      concept: EXAM_QS[i].c, difficulty: "medium", correct: q.answer === EXAM_QS[i].a }));
    const score = qs.filter((q) => q.correct).length;
    const concepts = ["Osmosis", "Cell respiration"].map((c) => {
      const mine = qs.filter((q) => q.concept === c);
      const right = mine.filter((q) => q.correct).length;
      return { concept: c, correct: right, total: mine.length, accuracy: right / mine.length };
    }).sort((a, b) => a.accuracy - b.accuracy);
    return { ...e, status: "graded", seconds_left: 0, questions: qs, rewards: { ok: true, xp_gained: 150, coins_gained: 40 },
      result: { score, total: 3, accuracy: score / 3, time_used_s: 64, submitted_at: "2026-11-04T09:01:04+00:00", auto_submitted: false,
        concepts, difficulties: [{ difficulty: "medium", correct: score, total: 3, accuracy: score / 3 }],
        unanswered: qs.filter((q) => q.answer === null).length, weak_concepts: concepts.filter((c) => c.accuracy < 0.6).map((c) => c.concept) } };
  };

  // Nothing outside the app is fetched (web fonts, images): the run is the same offline.
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  // Better Auth (Stage 4.1): sign-up needs the emailed code; a wrong password is refused.
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/auth/, "");
    if (path === "/sign-up/email") return json(route, 200, { token: null, user: { id: "3", email: "alice@example.com" } });
    if (path === "/sign-in/email") return json(route, 401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
    if (path === "/email-otp/send-verification-otp") return json(route, 200, { success: true });
    return json(route, 404, { code: "NOT_FOUND", message: "Not found" });
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();

    if (path === "/auth/me") return signedIn ? json(route, 200, me) : json(route, 401, { error: { code: "unauthenticated", message: "Please log in to continue.", action: "relogin", details: null } });
    if (path === "/hud") return json(route, 200, { ...hud, progress, shop: shopData, guest_mode: !signedIn });
    if (path === "/profile") return json(route, 200, { ...profile, progress });
    if (path === "/daily-quests") return json(route, 200, dailyQuests);
    if (path === "/shop") return json(route, 200, { ...shopData, champion_id: champion.champion_id });
    if (path === "/avatar") return json(route, 200, { ...avatar, champion_id: champion.champion_id, champion_chosen: champion.chosen });
    if (path === "/avatar/champion") {
      if (!signedIn) return json(route, 401, { error: { code: "unauthenticated", message: "Please log in to continue.", action: "relogin", details: null } });
      if (method === "PUT") {
        const body = route.request().postDataJSON() as { champion_id?: string };
        if (!championState().champions.includes(body.champion_id ?? "")) return json(route, 422, { error: { code: "unknown_champion", message: "That champion doesn't exist.", action: null, details: null } });
        champion.champion_id = body.champion_id!; champion.chosen = true;
      }
      return json(route, 200, championState());
    }
    if (path === "/achievements") return json(route, 200, achievements);
    if (path === "/providers") return json(route, 200, providers);
    if (path === "/auth/api-key") return json(route, 200, apiKey);
    // Stage 4.1: accounts on the Worker.
    if (path === "/auth/config") return json(route, 200, { google: false, email_delivery: true, verification_required: true, invite_only: false });
    if (path === "/admin/users") return json(route, 200, { users: ADMIN_USERS, total: ADMIN_USERS.length, offset: 0, limit: 25 });
    if (path === "/admin/invites") return json(route, 200, { invites: INVITES });
    if (path === "/auth/check-username") return json(route, 200, { available: true });
    if (path === "/documents") return json(route, 200, { documents: signedIn ? documents : [] });
    if (path === "/plans") return json(route, 200, PLANS);
    if (path === "/account/usage") return json(route, 200, USAGE);
    if (path === "/billing") return json(route, 200, { enabled: false, provider: null, key_id: null, subscription: null });
    if (path === "/concept-map") return json(route, 200, CONCEPT_MAP);
    if (path === "/courses") return json(route, 200, { courses: signedIn ? [COURSE] : [] });
    if (path === `/courses/${COURSE.id}/progress`) return json(route, 200, COURSE_PROGRESS);
    if (path === `/documents/${COURSE.id}`) return json(route, 200, COURSE_VIEW);
    const doc = path.match(/^\/documents\/([^/]+)$/);
    if (doc) {
      const found = documents.find((d) => d.id === doc[1]);
      return found ? json(route, 200, found) : json(route, 404, { error: { code: "document_not_found", message: "Document not found.", action: "reupload", details: null } });
    }
    if (path === "/arena/leaderboard") return json(route, 200, { ok: true, entries: [], total: 0 });
    if (path === "/arena/weak-concepts") return json(route, 200, { concepts: [], missed_total: 0, nemesis_ready: false });
    if (path === "/arena/runs/active") return json(route, 200, { ok: true, run: null });
    if (path === "/study/review-deck") return json(route, 200, { cards: [], total: 0 });
    if (path === "/arena/battles/active") return json(route, 200, { ok: true, battle: null });
    if (path === "/history") return json(route, 200, { history: [] });

    // Phase 3 Stage 3A: the plan, and a small review queue that empties as it is graded.
    if (path === "/entitlements") return json(route, 200, entitlements);
    if (path === "/review/stats") return json(route, 200, reviewStats());
    if (path === "/review/queue") return json(route, 200, { ok: true, items: reviewQueue, stats: reviewStats() });
    // Exam mode: one 3-question exam, graded on submit.
    if (path === "/exams/active") return json(route, 200, { exam: activeExam });
    if (path === "/exams/options") return json(route, 200, { lengths: [10, 20, 30], difficulties: ["easy", "medium", "hard", "mixed"],
      seconds_per_question: { easy: 60, medium: 75, hard: 90, mixed: 75 }, suggested_topics: ["Cell respiration", "Osmosis"], max_topics: 5 });
    if (path === "/exams" && method === "GET") return json(route, 200, { exams: [] });
    if (path === "/exams" && method === "POST") { activeExam = newExam(); return json(route, 200, activeExam); }
    const examAnswer = path.match(/^\/exams\/([^/]+)\/answers$/);
    if (examAnswer && activeExam) {
      const b = route.request().postDataJSON() as { index: number; answer?: string; clear?: boolean; flagged?: boolean };
      const q = activeExam.questions[b.index];
      if (b.clear) q.answer = null; else if (b.answer !== undefined) q.answer = b.answer;
      if (b.flagged !== undefined) q.flagged = b.flagged;
      return json(route, 200, { ok: true, index: b.index, answer: q.answer, flagged: q.flagged, answered: 1, seconds_left: 200 });
    }
    if (/^\/exams\/[^/]+\/submit$/.test(path) && activeExam) {
      const done = gradeExam(activeExam);
      activeExam = null;
      return json(route, 200, done);
    }
    if (path === "/review/grade" && method === "POST") {
      const body = route.request().postDataJSON() as { item_id: number };
      const graded = reviewQueue.find((i) => i.id === body.item_id)!;
      reviewQueue = reviewQueue.filter((i) => i.id !== body.item_id);
      reviewedToday += 1;
      return json(route, 200, { ok: true, item: { ...graded, reps: 1, state: "review" }, stats: reviewStats(),
                                ...(reviewQueue.length ? {} : { rewards: { ok: true, xp_gained: 80, coins_gained: 20 } }) });
    }

    if (method === "GET") unanswered.push(path);
    return json(route, 404, { error: { code: "not_found", message: "Not found.", action: null, details: null } });
  });
  return { unanswered };
}
