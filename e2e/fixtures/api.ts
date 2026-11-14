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
  /** Stage C1: a champion who just joined and is waiting for their unlock ceremony. */
  ceremony?: string;
  /** Stage S1: an item made unlocked and affordable, to buy in the shop. */
  buyable?: string;
  /** "You've been upgraded": a plan notice waiting in GET /hud until POST /account/plan-notice marks it shown. */
  planNotice?: Record<string, unknown>;
}

/** An admin gave this account Sage for 30 days, with a note. */
export const PLAN_NOTICE = {
  id: 11, kind: "upgrade", tier: "sage", tier_name: "Sage", from_tier: "apprentice", from_tier_name: "Apprentice", source: "admin",
  expires_at: "2026-12-10T00:00:00Z", from_expires_at: null, note: "Thanks for testing CourseMateAI!", from_name: "Archit",
  unlocked: [{ feature: "review_queue", name: "Spaced-repetition review" }, { feature: "exam_mode", name: "Exam mode" },
             { feature: "concept_map", name: "The concept map" }, { feature: "pdf_viewer", name: "The PDF page viewer" }],
  gains: [{ key: "documents", from: 3, to: 50 }, { key: "courses", from: 1, to: 10 }, { key: "ai_calls_day", from: 25, to: 400 }, { key: "pdf_mb", from: 10, to: 50 }],
  created_at: "2026-11-10T09:00:00Z",
};

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
export async function mockApi(page: Page, { signedIn = true, advanced = true, documents = [DOCUMENT], ceremony, buyable, planNotice }: MockOptions = {}) {
  const unanswered: string[] = [];
  const binned: { id: string; kind: string; name: string; [k: string]: unknown }[] = [
    { id: "course-old", kind: "course", name: "Old chemistry", deleted_at: "2026-11-01T10:00:00.000Z", expires_at: "2026-12-01T10:00:00.000Z", days_left: 3, documents: 2 },
  ];
  let notice: Record<string, unknown> | null = planNotice ?? null;
  const progress = { ...hud.progress, current_level: advanced ? 7 : 1, total_xp: advanced ? 1450 : 0, coins: advanced ? 320 : 0, xp_into_level: advanced ? 150 : 0, xp_to_next: 400, streak_days: advanced ? 4 : 0 };
  const shopData = { ...shop, shop_unlocked: advanced, level: progress.current_level, coins: progress.coins,
    items: shop.items.map((i) => (i.id === buyable ? { ...i, locked: false, owned: false, can_afford: true, price: 120 } : { ...i })) };
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
    battles: id === "kaien" ? 3 : 0, wins: id === "kaien" ? 2 : 0, mastery: mastery(id), kit: { ...kit(p, u), weakness: { name: `${p} Flaw`, text: `${p} has a cost.` } },
    // champion mastery (Phase 1): Kaien part-way, with one challenge done
    mastery_pct: id === "kaien" ? 8 : 0, passive_learnable: false, mastered: false,
    challenges: [
      { id: "win10", text: "Win 10 fights", progress: id === "kaien" ? 2 : 0, target: 10, done: false },
      { id: "right100", text: "Answer 100 questions right in fights", progress: id === "kaien" ? 100 : 0, target: 100, done: id === "kaien" },
    ],
    signature: { weapon: `mastery_${id}_weapon`, perk: { name: `${p} Edge`, text: `${p}, a little stronger.` }, finisher: `${u} Finale`, owned: false, worn: false },
    // Stage C1 locks: Asha, Brak and Mira have joined; Vex waits on Bestiary tier IV, Thorne on level 25
    unlock: id === "vex" ? { unlocked: false, celebrated: false, source: null, how: "Beat every creature in Bestiary tier IV", have: 0, need: 2, reward: { xp: 600, coins: 400 } }
      : id === "thorne" ? { unlocked: false, celebrated: false, source: null, how: "Reach level 25", have: 7, need: 25, reward: { xp: 500, coins: 300 } }
      : { unlocked: true, celebrated: id !== ceremony, source: id === "kaien" ? "free" : "tier1", how: id === "kaien" ? "Free" : "Beat every creature in Bestiary tier I", have: 4, need: 4, reward: { xp: 150, coins: 100 } },
  }]));
  const championState = () => ({
    ...champion, champions: ["kaien", "asha", "brak", "mira", "vex", "thorne"],
    loadout: { armor: worn.armor ?? null, headgear: worn.headgear ?? null, weapon: worn.weapon ?? null, pet: worn.pet ?? null },
    progress: championProgress,
  });
  const node = (id: string, name: string, ranks = 1) => ({ id, branch: id[0], tier: Number(id[1]), name, text: `${name} helps.`, ranks });
  const hero = {
    level: 4, xp: 400, level_xp: 40, next_level_xp: 240, skill_points: 3, skill_spent: 0, loadout_budget: 7, loadout_cost: 4,
    look: null as unknown, build: { style: "apprentice", passive: "second_wind", ultimate: "rally", perks: [] as string[], weaknesses: [] as string[] }, tree: {} as Record<string, number>,
    catalog: {
      styles: [
        { id: "apprentice", name: "Apprentice Blade", bonus: "A right Guard also gives +1 Focus.", weakness: { name: "Untrained", text: "Your ultimate charges 10% slower." }, anim: "sword", owned: true, how: "Your starting style", progress: null, for_sale: null },
        { id: "katana", name: "Katana", bonus: "Strike hits x1.1.", weakness: { name: "Glass Edge", text: "A wrong Heavy also costs you 1 heart." }, anim: "blade", owned: false, how: "Kaien at 100% mastery", progress: 42, for_sale: null },
        { id: "chain_whip", name: "Chain Whip", bonus: "Jab hits x0.7 with 5 more seconds.", weakness: { name: "Loose Grip", text: "Strike hits x0.9." }, anim: "whip", owned: false, how: "Shop: 1200 coins at player level 12", progress: null, for_sale: { coins: 1200, level: 12, can_buy: false } },
      ],
      passives: [
        { id: "second_wind", name: "Second Wind", text: "Once a fight, when you drop to 1 heart, you heal 2.", cost: 2, owned: true, how: "Your starting passive", progress: null },
        { id: "riposte", name: "Riposte", text: "A right Guard hits back.", cost: 4, owned: false, how: "Kaien at 50% mastery", progress: 42 },
      ],
      ultimates: [
        { id: "rally", name: "Rally", text: "+2 hearts and +1 Focus.", cost: 2, owned: true, how: "Your starting ultimate", progress: null },
        { id: "overdrive", name: "Overdrive", text: "Your next 2 right answers hit x1.6.", cost: 4, owned: false, how: "Skill tree: Overdrive", progress: null },
      ],
      perks: [{ id: "lucky_coin", name: "Lucky Coin", text: "+10% coins from fights.", cost: 1, owned: false, how: "Shop", for_sale: null }],
      weaknesses: [{ id: "glass_body", name: "Glass Body", text: "You fight with 3 fewer hearts.", points: 3 }],
      tree: [node("o1", "Sharpened", 2), node("o2", "Opening"), node("o3", "Combo Fuel"), node("o4", "Heavy Hands", 2), node("o5", "Finisher"), node("o6", "Overdrive"),
        node("d1", "Tough", 2), node("d2", "Parry"), node("d3", "Thick Skin"), node("d4", "Steady"), node("d5", "Last Stand"), node("d6", "Aegis Dome"),
        node("m1", "Recall", 2), node("m2", "Insightful"), node("m3", "Focus Flow"), node("m4", "Deep Focus"), node("m5", "Quick Study"), node("m6", "Clarity")],
    },
    looks_unlocked: [] as string[],
  };
  const forge = {
    items: [{ id: "hat_headband_red", category: "headgear", tier: 1, xp: 120, bonus: 0, next: { xp: 100, coins: 150, common: 3, rare: 0 }, ready: true, worn: true, saddled: false }],
    mount: null as string | null,
    materials: [{ id: "bronze_ore", name: "Bronze ore", count: 4, rare: false }],
    rules: { upgrades: [], saddle: { tier: 4, coins: 600, rare: 2 }, mount_bonus: {} },
  };

  const scroll = <T extends { id: string; kind: string; title: string }>(o: T) => ({ text: "", progress: 0, target: 1, completed: false, claimed: false, reward: { xp: 300, coins: 150 }, call: { place: "arena" }, period: "", ...o });
  const questBoard = {
    week: "2026-W45",
    weekly: [
      scroll({ id: "trial_quizzes", kind: "weekly", title: "Trial of Questions", text: "Complete 6 quizzes.", target: 6, progress: 3, call: { place: "quiz" }, period: "2026-W45" }),
      scroll({ id: "trial_reviews", kind: "weekly", title: "Trial of Memory", text: "Review 80 cards.", target: 80, progress: 12, call: { place: "review" }, period: "2026-W45" }),
      scroll({ id: "trial_hard", kind: "weekly", title: "Trial of Iron", text: "Win a fight on hard or nightmare.", reward: { xp: 400, coins: 250 }, period: "2026-W45" }),
    ],
    hunts: [
      scroll({ id: "hunt:minotaur", kind: "hunt", title: "Hunt the Minotaur", text: "Beat the Minotaur for the first time.", progress: 1, completed: true, reward: { xp: 120, coins: 60 }, call: { place: "arena", topic: "graph algorithms" }, lost_page: "minotaur" }),
      scroll({ id: "hunt:cyclops", kind: "hunt", title: "Hunt the Cyclops", text: "Beat the Cyclops for the first time.", reward: { xp: 120, coins: 60 }, call: { place: "arena", topic: "mechanics" }, lost_page: "cyclops" }),
    ],
    story: { champion: "kaien", chapters_done: 0, chapters: 3,
      scroll: scroll({ id: "story:kaien:1", kind: "story", title: "Kaien · The Ninth Page", text: "A book with eight pages and a gap where the ninth should be. Win a fight as Kaien.", reward: { xp: 100, coins: 60 } }) },
  };

  let chestOpened = false;
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
  const removedCards = new Map<number, (typeof reviewQueue)[number]>();
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
    if (path === "/hud") return json(route, 200, { ...hud, progress, shop: shopData, guest_mode: !signedIn, plan_notice: signedIn ? notice : null });
    if (path === "/account/plan-notice" && method === "POST") { notice = null; return json(route, 200, { ok: true }); }
    if (path === "/account/plan-notice") return json(route, 200, { plan_notice: notice });
    if (path === "/profile") return json(route, 200, { ...profile, progress });
    if (path === "/daily-quests") return json(route, 200, dailyQuests);
    if (path === "/shop") return json(route, 200, { ...shopData, champion_id: champion.champion_id });
    if (path === "/avatar") return json(route, 200, { ...avatar, champion_id: champion.champion_id, champion_chosen: champion.chosen });
    // The quest board (Stage Q1): a trial half done, a hunt ready to claim (it finds the Minotaur's lost page),
    // and Kaien's first chapter.
    if (path === "/shop/purchase" && method === "POST") {
      const id = (route.request().postDataJSON() as { item_id: string }).item_id;
      const item = shopData.items.find((i) => i.id === id);
      if (!item || item.locked || item.owned) return json(route, 200, { ok: false, reason: "Can't buy that" });
      item.owned = true;
      progress.coins -= Number(item.price);
      shopData.coins = progress.coins;
      return json(route, 200, { ok: true, item_id: id, coins: progress.coins, message: "Purchased" });
    }
    // Stage R3: the daily chest (ready to open; opening it pays coins and a potion)
    if (path === "/chest") return json(route, 200, { available: !chestOpened, day: "2026-11-08", streak: chestOpened ? 3 : 2, bonus_pct: 20 });
    if (path === "/chest/open" && method === "POST") {
      if (chestOpened) return json(route, 409, { error: { code: "chest_opened", message: "You've opened today's chest.", action: null, details: null } });
      chestOpened = true;
      progress.coins += 54;
      return json(route, 200, { ok: true, streak: 3, bonus_pct: 20, coins: 54, items: [{ id: "potion_health_small", name: "Health Potion", kind: "potion" }], totals: { coins: progress.coins, total_xp: 1450, level: 7 } });
    }
    // Stage A2: victory emotes (three free, one bought, the rest locked)
    if (path === "/emotes") return json(route, 200, { emotes: [
      ...["emote_gg", "emote_bow", "emote_flex"].map((id) => ({ id, name: id.slice(6).toUpperCase(), owned: true, how: "Free" })),
      { id: "emote_laugh", name: "Laugh", owned: true, how: "Shop · 150 coins" },
      { id: "emote_dance", name: "Victory Dance", owned: false, how: "Shop · 300 coins" },
      { id: "emote_crown", name: "Crown", owned: false, how: "Defeat 10 bosses" },
    ] });
    if (path === "/quests") return json(route, 200, questBoard);
    if (path === "/quests/claim" && method === "POST") {
      const id = (route.request().postDataJSON() as { id: string }).id;
      const s = [...questBoard.weekly, ...questBoard.hunts, questBoard.story.scroll].find((x) => x?.id === id);
      if (!s || !s.completed || s.claimed) return json(route, 409, { error: { code: "scroll_not_done", message: "Finish the quest first.", action: null, details: null } });
      s.claimed = true;
      return json(route, 200, { ok: true, id, kind: s.kind, reward: s.reward, lost_page: s.kind === "hunt" ? "minotaur" : null, totals: { total_xp: 1570, coins: progress.coins + s.reward.coins, level: 7 } });
    }
    if (path === "/avatar/champion/celebrate" && method === "POST") {
      const body = route.request().postDataJSON() as { champion_id: string };
      const u = championProgress[body.champion_id]?.unlock as { celebrated: boolean; reward: { xp: number; coins: number } } | undefined;
      const first = !!u && !u.celebrated;
      if (u) u.celebrated = true;
      return json(route, 200, { champion_id: body.champion_id, first, reward: first ? u!.reward : { xp: 0, coins: 0 }, state: championState() });
    }
    // Your hero (GET / PUT /hero*): level 4, the starter kit, Kaien's style still locked at 42%
    if (path === "/hero" && method === "GET") return json(route, 200, hero);
    if (path === "/hero/look" && method === "PUT") { hero.look = (route.request().postDataJSON() as { look: unknown }).look as never; return json(route, 200, hero); }
    if (path === "/hero/build" && method === "PUT") { hero.build = (route.request().postDataJSON() as { build: typeof hero.build }).build; return json(route, 200, hero); }
    if (path === "/hero/tree" && method === "PUT") { hero.tree = (route.request().postDataJSON() as { tree: Record<string, number> }).tree; return json(route, 200, hero); }
    // The forge (GET /forge): the worn Red Headband part-way to tier II, a little bronze ore
    if (path === "/forge" && method === "GET") return json(route, 200, forge);
    if (path === "/forge/upgrade" && method === "POST") {
      const id = (route.request().postDataJSON() as { item: string }).item;
      const it = forge.items.find((i) => i.id === id);
      if (it) { it.tier += 1; it.xp = 0; it.ready = false; it.bonus = 0.05 * (it.tier - 1); }
      return json(route, 200, forge);
    }
    if (path === "/avatar/champion") {
      if (!signedIn) return json(route, 401, { error: { code: "unauthenticated", message: "Please log in to continue.", action: "relogin", details: null } });
      if (method === "PUT") {
        const body = route.request().postDataJSON() as { champion_id?: string };
        const isHero = body.champion_id === "hero";              // your hero is always there
        if (!isHero && !championState().champions.includes(body.champion_id ?? "")) return json(route, 422, { error: { code: "unknown_champion", message: "That champion doesn't exist.", action: null, details: null } });
        if (!isHero && !(championProgress[body.champion_id!].unlock as { unlocked: boolean }).unlocked) return json(route, 403, { error: { code: "champion_locked", message: "That champion hasn't joined you yet.", action: null, details: null } });
        champion.champion_id = body.champion_id!; champion.chosen = true;
      }
      return json(route, 200, championState());
    }
    // The Bestiary (Stage B1): tier I open, the Minotaur beaten (its bane written in), the Hydra's page still dark.
    if (path === "/bestiary") {
      const TIER: Record<string, number> = { minotaur: 1, cyclops: 1, oni: 1, kitsune: 1, naga: 2, rakshasa: 2, sphinx: 2, fenrir: 2, hydra: 3, kraken: 3, ammit: 3, simurgh: 4, jormungandr: 4 };
      const NAMES: Record<string, [string, string]> = { minotaur: ["Minotaur", "Greek"], cyclops: ["Cyclops", "Greek"], oni: ["Oni", "Japanese"], kitsune: ["Kitsune", "Japanese"] };
      return json(route, 200, {
        tiers: [
          { tier: 1, name: "Beasts of the Wilds", open: true, beaten: 1, total: 4, opens_next_at: 2 },
          { tier: 2, name: "Tricksters and Hunters", open: false, beaten: 0, total: 4, opens_next_at: 2 },
          { tier: 3, name: "Ancient Horrors", open: false, beaten: 0, total: 3, opens_next_at: 2 },
          { tier: 4, name: "World-Enders", open: false, beaten: 0, total: 2, opens_next_at: null },
        ],
        creatures: Object.entries(TIER).map(([species, tier]) => {
          const open = tier === 1, beaten = species === "minotaur";
          return { species, tier, open, met: beaten, defeated: beaten, name: open ? NAMES[species][0] : null, origin: open ? NAMES[species][1] : null,
            teaser_topic: species === "hydra" ? "cell biology" : null, mastery: beaten ? "bronze" : "none",
            record: beaten ? { fights: 2, wins: 1, losses: 1, flawless_wins: 0, nightmare_wins: 0, best_seconds: 140, best_accuracy: 88, first_win_at: "2026-11-05T09:00:00Z", last_fought_at: "2026-11-06T09:00:00Z" } : null,
            bane: open ? { clue: "A clue for this creature.", moves: beaten ? ["guard", "heavy"] : null, found_alone: false, uses: 0 } : null,
            stats: open ? { attacks: ["Horn Gore", "Axe Cleave", "Labyrinth Charge"], special: "Endless Labyrinth", hp_scale: 1, time_scale: 1 } : null };
        }),
      });
    }
    if (path === "/achievements") return json(route, 200, achievements);
    if (path === "/providers") return json(route, 200, providers);
    if (path === "/auth/api-key") return json(route, 200, apiKey);
    // Stage 4.1: accounts on the Worker.
    if (path === "/auth/config") return json(route, 200, { google: false, email_delivery: true, verification_required: true, invite_only: false });
    if (path === "/admin/users") return json(route, 200, { users: ADMIN_USERS, total: ADMIN_USERS.length, offset: 0, limit: 25 });
    if (path === "/admin/invites") return json(route, 200, { invites: INVITES });
    if (/^\/admin\/users\/\d+\/plan$/.test(path) && method === "PUT") {
      const body = JSON.parse(route.request().postData() || "{}");
      const u = ADMIN_USERS.find((x) => path.includes(`/users/${x.user_id}/`)) ?? ADMIN_USERS[1];
      const up = ["apprentice", "scholar", "sage", "archmage"].indexOf(body.tier) > ["apprentice", "scholar", "sage", "archmage"].indexOf(u.tier);
      return json(route, 200, { ...u, tier: body.tier, notice: up ? { kind: "upgrade" } : null });
    }
    // Admin -> AI models and the admin's own model (Settings -> AI).
    if (path === "/admin/ai/models") return json(route, 200, {
      slots: {}, mine: null, ollama: { enabled: false, base: null, models: [] },
      defaults: { fast: "gemini:gemini-3.5-flash-lite", strong: "gemini:gemini-3.8-flash", premium: "claude:claude-sonnet-5-5", small: "@cf/meta/llama-3.1-8b-instruct-fp8" },
      providers: [{ id: "gemini", configured: true, key_env: "GOOGLE_API_KEY" }, { id: "openai", configured: false, key_env: "OPENAI_API_KEY" },
        { id: "claude", configured: true, key_env: "ANTHROPIC_API_KEY" }, { id: "nvidia", configured: false, key_env: "NVIDIA_API_KEY" },
        { id: "workers-ai", configured: true, key_env: null }],
    });
    if (path === "/admin/ai/mine") return json(route, 200, { spec: null });
    if (path === "/admin/ai/test" && method === "POST") {
      const body = route.request().postDataJSON() as { spec?: string; slot?: string };
      return json(route, 200, body.spec?.startsWith("ollama:")
        ? { ok: false, spec: body.spec, source: "this setting", latency_ms: 5003, error: "fetch failed", hint: "The tunnel address didn't answer. Quick tunnels (trycloudflare.com) get a new address every time they start: paste the new one in Admin → AI." }
        : { ok: true, spec: body.spec ?? "gemini:gemini-3.5-flash-lite", source: body.spec ? "this setting" : "LLM_FAST", latency_ms: 742, reply: "OK" });
    }
    if (path === "/admin/ai") return json(route, 200, { days: 30, today_usd: 0.42, cap_usd: 2, cap_max_usd: 20, can_edit: true, capped: false, total_usd: 3.1, by_day: [],
      models: [{ provider: "gemini", model: "gemini-3.8-flash", calls: 120, fallbacks: 2, tokens_in: 90000, tokens_out: 30000, cost_usd: 0.42, priced: true }],
      routes: { apprentice: { small: ["workers-ai:@cf/meta/llama-3.1-8b-instruct-fp8"], strong: ["gemini:gemini-3.5-flash-lite"] },
        scholar: { small: [], strong: [] }, sage: { small: [], strong: [] }, archmage: { small: [], strong: [] } } });
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
    if (doc && method === "DELETE") {
      const i = documents.findIndex((d) => d.id === doc[1]);
      if (i >= 0) binned.push({ id: documents[i].id, kind: "document", name: documents[i].filename, deleted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), days_left: 30, pages: 12, courses: 1 });
      if (i >= 0) documents.splice(i, 1);
      return json(route, 200, { ok: true });
    }
    // the Trash (data-loss safety): what was deleted here, plus an old course
    if (path === "/trash" && method === "GET") return json(route, 200, { days: 30, items: binned });
    const binItem = path.match(/^\/trash\/([^/]+)(\/restore)?$/);
    if (binItem) {
      const i = binned.findIndex((b) => b.id === binItem[1]);
      if (i < 0) return json(route, 404, { error: { code: "not_in_trash", message: "That isn't in your Trash.", action: null, details: null } });
      const [item] = binned.splice(i, 1);
      return json(route, 200, binItem[2] ? { ok: true, kind: item.kind, id: item.id, name: item.name } : { ok: true });
    }
    if (doc) {
      const found = documents.find((d) => d.id === doc[1]);
      return found ? json(route, 200, found) : json(route, 404, { error: { code: "document_not_found", message: "Document not found.", action: "reupload", details: null } });
    }
    if (path === "/arena/leaderboard") return json(route, 200, { ok: true, entries: [], total: 0 });
    if (path === "/arena/weak-concepts") return json(route, 200, { concepts: [], missed_total: 0, nemesis_ready: false });
    if (path === "/arena/runs/active") return json(route, 200, { ok: true, run: null });
    if (path === "/arena/power") return json(route, 200, { ok: true, power: { power: 30, from_score: 10, from_hunts: 10, best_scores: [], hunted: ["minotaur", "cyclops"] },
      rush: { unlocked: false, hunted: 2, need: 3, bosses: [], wins: 0, best: null }, survival: { best: null }, active: null });
    if (path === "/arena/gauntlets/active") return json(route, 200, { ok: true, gauntlet: null });
    if (path === "/arena/season") return json(route, 200, { ok: true, season: { id: "finals", name: "Finals Week", tagline: "The Exam Warden rises from everything you studied this month.",
      boss: "sphinx", boss_name: "The Exam Warden", stage: "exam-hall", tint: "#fde68a", reward: { xp: 200, coins: 250 } }, ready: true, concepts: ["ATP", "DNA", "RNA"], needed: 3, beaten: false });
    if (path === "/adventurer") return json(route, 200, { ok: true, name: "alice", champion: "kaien", level: 7, streak: 4, power: 58, survival_best: 7, rush_wins: 1,
      bestiary: { beaten: 5, total: 13 }, achievements: { unlocked: 9, total: 30, recent: ["First Blood"] } });
    if (path === "/arena/invasion") return json(route, 200, { ok: true, week: "2026-11-09", ready: true, concepts: ["ATP", "Mitochondria", "Nucleus"], needed: 3,
      species: "kraken", name: "Kraken", repelled: false, reward: { xp: 120, coins: 150 } });
    if (path === "/study/review-deck") return json(route, 200, { cards: [], total: 0 });
    if (path === "/arena/battles/active") return json(route, 200, { ok: true, battle: null });
    if (path === "/history") return json(route, 200, { history: [] });

    // Phase 3 Stage 3A: the plan, and a small review queue that empties as it is graded.
    if (path === "/entitlements") return json(route, 200, entitlements);
    if (path === "/review/stats") return json(route, 200, reviewStats());
    if (path === "/review/queue") return json(route, 200, { ok: true, items: reviewQueue, stats: reviewStats() });
    // Round 7: Remove hides a card (until it's missed again); POST puts it back (Undo)
    const cardPath = path.match(/^\/review\/cards\/(\d+)$/);
    if (cardPath && (method === "DELETE" || method === "POST")) {
      const id = Number(cardPath[1]);
      if (method === "DELETE") { removedCards.set(id, reviewQueue.find((i) => i.id === id)!); reviewQueue = reviewQueue.filter((i) => i.id !== id); }
      else if (removedCards.has(id)) { reviewQueue = [removedCards.get(id)!, ...reviewQueue]; removedCards.delete(id); }
      return json(route, 200, { ok: true });
    }
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
