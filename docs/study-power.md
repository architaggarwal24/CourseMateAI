# Study power: Phase 3, Stages 3A and 3B

> **Note (Stage 4.6):** written for the Python backend, which is gone. The rules still hold; the code is now under `frontend/src/server/`, and settings and admin tasks are in [deploy-cloudflare.md](deploy-cloudflare.md) and the in-app Admin panel.

Stage 3A (sections 1-4) has three features:
1. A spaced-repetition review queue (FSRS) that combines flashcards, missed arena questions ("study scrolls"), quiz mistakes and exam mistakes.
2. Exam mode: timed mock tests with a PDF score report.
3. A plan entitlement check that Stage 4 will connect to real subscriptions.

Stage 3B (sections 5-8) adds courses, page-linked citations with a PDF viewer, and the concept map.

Everything is decided on the server. The browser only shows it and sends what the user chose.

| Area | Backend | Frontend | Tests |
|---|---|---|---|
| Review queue | `services/review_service.py`, `routers/review.py` | `components/review/ReviewView.tsx`, `hooks/useReview.ts`, `lib/study/review.ts` | `tests/test_review_queue.py`, `ReviewView.test.tsx`, `e2e/review.spec.ts` |
| Exam mode | `services/exam_service.py`, `services/exam_report.py`, `core_brains/exam_brain.py`, `routers/exams.py` | `components/exam/*`, `lib/study/exam.ts` | `tests/test_exams.py`, `ExamView.test.tsx`, `e2e/exam.spec.ts` |
| Plans | `services/entitlements.py` (`GET /entitlements`) | `components/study/UpgradeCard.tsx` | both test files above |
| Data | `migrations/0010_study_power.sql` | n/a | `tests/test_database_migrations.py` |
| Courses (3B) | `services/course_service.py`, `routers/courses.py`, `rag/multi_index.py` | `components/course/*`, `hooks/useCourses.ts`, `lib/study/courses.ts` | `tests/test_courses.py`, `course.test.tsx`, `e2e/courses.spec.ts` |
| Citations + PDF viewer (3B) | `services/context_service.py`, `GET /documents/{id}/file` | `components/pdf/PdfViewer.tsx`, `components/chat/CitationList.tsx`, `lib/study/citations.ts`, `lib/study/pdf.ts` | `tests/test_courses.py`, `PdfViewer.test.tsx`, `e2e/citations.spec.ts` |
| Concept map (3B) | `core_brains/concept_brain.py`, `services/concept_map_service.py`, `routers/concept_maps.py` | `components/map/*`, `lib/study/conceptMap.ts` | `tests/test_concept_maps.py`, `ConceptMapView.test.tsx`, `conceptMap.test.ts`, `e2e/concept-map.spec.ts` |
| Data (3B) | `migrations/0011_courses_and_maps.sql` | n/a | `tests/test_database_migrations.py` |

## 1. The review queue (FSRS)

Each user has one queue that spans all their documents. Scheduling uses the `fsrs` package (FSRS-6, default parameters, 90% desired retention, intervals fuzzed). The schedule's state is stored in columns of `review_items`, and every grade is written to `review_logs`, so a parameter optimiser can be added later.

**How cards enter the queue.** A card is keyed by the document's content hash plus its normalised front text, so a card is never queued twice and re-uploading the PDF keeps its cards.

| Source | When it enters the queue |
|---|---|
| `arena` (study scroll) | A missed arena question. `MasteryService.record()` adds it in the same transaction that stores the miss. |
| `quiz` | A missed question in a server-graded quiz (same path). |
| `exam` | A missed or unanswered exam question, when the exam is graded (same path). |
| `flashcard` | The first time a card is graded in the Flashcards tab: "Got it" counts as Good, "Missed it" as Again. "Add deck to review" adds every card of the deck as new. |

A card that is already in the queue and is missed again somewhere else becomes due now, and its history is kept. Migration 0010 turned every existing missed question into a card that is due now.

**Grades.** 1 Again, 2 Hard, 3 Good, 4 Easy.
- Again counts as a miss for the concept's mastery. Hard, Good and Easy count as a hit. This is the same mastery data that feeds Nemesis bosses and exam topic suggestions.
- A grade sends the card's `reps` as the client last saw it. A second grade of the same view (another tab, a retried request) is refused with 409 `review_stale` and is not counted.
- Each grade button shows when the card would come back, from an unfuzzed preview: for a new card that is 1m, 6m, 10m and 8d.

**Queue order.** `GET /review/queue?limit&session_id` returns cards in this order:
1. Learning and relearning cards, including those due in the next 20 minutes, so a session can finish.
2. Review cards that are due, most overdue first.
3. New cards, oldest first, up to **20 new cards per local day** (`NEW_PER_DAY`).

Passing `session_id` narrows the queue to one document.

**Stats.** `GET /review/stats` drives the nav badge and answers on every plan, with a `locked` flag.

| Field | Meaning |
|---|---|
| `due` | learning + due reviews + the new cards allowed today |
| `new_waiting` | new cards beyond today's allowance |
| `reviewed_today` | grades given today |
| `by_source` | card count per source |
| `next_due_at` | when the next card comes due |

**Streaks, quests and rewards.** Every grade:
- counts as study activity, so it keeps the streak;
- advances the daily quest "Review 15 cards" (`review_cards`, tier 1).

When a grade empties the due queue, `review_complete` is paid once per local day (80 XP, 20 coins; ledger key `review:<date>`) and the quest "Clear today's review queue" (`clear_reviews`, tier 2) advances.

**Other endpoints.**
- `POST /review/cards {session_id, cards[]}`: "Add deck to review". Answers with added, existing and skipped counts.
- `DELETE /review/cards/{id}`: removes a card for good.

**UI** (Study → Review):
- **Keyboard:** Space shows the answer and 1-4 grade it.
- **Phone:** tap the card to reveal it, then swipe right for Good or left for Again.
- **Due count:** shown on the Study nav item in the sidebar and dock, and on the Review tab. Screen readers hear it in words, and it is hidden at zero or when the queue is locked.
- **Scope:** "This document" narrows the queue to the open PDF.
- **Remove:** takes a card out of the queue.
- **End screen:** "All caught up" shows today's numbers and when the next card is due.

## 2. Exam mode

`POST /exams {session_id, length: 10|20|30, difficulty: easy|medium|hard|mixed, topics: [≤5]}`

**Writing the questions.** The LLM writes the exam in batches of up to 10, in parallel (`core_brains/exam_brain.py`).
- Each batch reads a different part of the document: one batch per chosen topic, or, with no topics, one of four broad angles (definitions, processes, comparisons, results).
- Duplicates and questions whose answer is not one of the options are dropped.
- If fewer than 60% of the requested questions survive, the request fails with 503 `generation_failed` (retryable).

**Rules.**
- **Clock:** questions × 60 / 75 / 90 / 75 seconds (easy / medium / hard / mixed). The server owns it and answers get 5 seconds of grace.
- **One exam at a time:** starting another returns 409 `exam_in_progress {exam_id}`, and `GET /exams/active` resumes the one in progress.
- **No hints and no feedback** until the exam is graded.
- **Answers** (`POST /exams/{id}/answers {index, answer | clear | flagged}`) can be changed, cleared or flagged any number of times before submitting.
- **Grading** (`POST /exams/{id}/submit`) happens once (compare-and-set). A later read returns the same result. An exam read after its deadline is graded with the answers saved so far (`auto_submitted`).
- **What grading writes:**
  - Every question counts for its concept's mastery.
  - Every missed or unanswered question goes to the review queue (source `exam`).
  - `exam_complete` is paid once per exam (150 XP, 40 coins, scaled by accuracy and difficulty; daily cap 3) if at least one question was answered.
  - The quest "Finish a mock exam" (`complete_exams`, tier 3) advances.
- **Result:** score, accuracy, time used, a per-concept breakdown (weakest first), a per-difficulty breakdown, unanswered count, `weak_concepts` (accuracy below 60%), and every question with its correct answer, explanation, concept and difficulty.
- **PDF report** (`GET /exams/{id}/report.pdf`, reportlab, A4): the score tiles, concept bars, the difficulty split, "study next", and every missed question with the right answer and the reason. Before grading it returns 409 `exam_not_graded`.
- **Topic suggestions:** `GET /exams/options?session_id` suggests the concepts this document has covered so far, weakest first.

**UI** (Study → Exam):
- **Setup:** length, difficulty, topics (suggested or typed), and the time the exam will get.
- **Taking it:** a clock, a question grid (answered and flagged states, jump to any question), options as a radio group, and Previous, Next and Flag buttons. Keys: 1-4 answer (picking the same answer again clears it), ← → move between questions, F flags.
- **Submitting:** asks first and says how many questions are unanswered. When the clock hits zero the exam is handed in automatically.
- **Results:** tiles, the concept table, a difficulty badge per level, "N missed questions are now in your review queue", the PDF report link, and every question. Past exams are listed on the setup screen.

## 3. Plans (entitlement stub)

Tiers, lowest first: Apprentice (free), Scholar (Pro), Sage (Pro Plus), Archmage (Max). Each feature names the lowest tier that has it:

| Feature | Lowest tier |
|---|---|
| `review_queue` | Scholar |
| `exam_mode` | Sage |
| `courses` | Sage |
| `concept_map` | Sage |
| `pdf_viewer` | Sage |

Page labels on citations stay free on every plan; only opening the PDF needs `pdf_viewer`.

- **Default tier:** until Stage 4, every account is on `DEFAULT_TIER` (environment variable, default `archmage`, so everything is on while we build).
- **Locked features:** the endpoint answers 403 `feature_locked {feature, tier, required_tier, required_tier_name}`. The UI shows a calm "comes with <plan>" card instead of an error. `GET /review/stats` still answers, with `locked: true`, and the badge hides.
- **What the UI reads:** `GET /entitlements` (`hooks/useReview.ts`).
- **Stage 4:** replaces `entitlements.tier_for(user_id)` with the user's real plan. The endpoints call `entitlements.require(user_id, feature)` and need no change.

## 4. Data (migration 0010)

| Table | Contents |
|---|---|
| `review_items` | The FSRS card state: state, step, stability, difficulty, due, last_review, reps, lapses. Plus front, back, explanation, concept and source. |
| `review_logs` | Every grade, with the local date and whether the card was new. |
| `exams` | One row per exam; `exam_questions` and `exam_answers` are deleted with their exam. |
| `missed_questions` | Rebuilt to allow source `exam`. Every row is kept. |

Deleting a user deletes all of it.

## 5. Courses

A course groups several of a user's PDFs (at most 20; at most 30 courses). **A course id works wherever a document id does:** chat, quiz, notes, flashcards, review, exam, the arena and the concept map all take it as their `session_id`.

- **Retrieval:** `DocumentService.get_index(course_id)` returns a `MultiIndex` over the course's ready documents. Each hit is tagged with `doc_id` and `doc_name` and merged by score. `VOICE_SHARE` (0.75) gives every relevant document at least one passage, so one PDF with near-duplicate chunks can't crowd out the rest. An empty course answers 409 `course_empty`.
- **Records:** `get_document(course_id)` answers a course view (`kind: "course"`, `file_hash: "course:<id>"`, chunks summed, `documents: [ids]`). Mastery, exams and review cards made on the whole course are stored under that hash. The review queue of a course covers its own cards and its documents' cards.
- **Kept PDFs and expiry:** the original PDF is kept at `uploads/files/<hash>.pdf` (shared by content, deleted with the last document using it). Documents in a course never expire for being idle, and they are evicted last.
- **API:** `GET/POST /courses`, `GET/PUT/DELETE /courses/{id}` (PUT `document_ids` is the full ordered list), `GET /courses/{id}/progress` (concepts seen / strong / weak / weakest, answers, review cards and due, exams, per-document stats). All need the `courses` feature.
- **UI:** the document name in the Study header is a switcher (courses, then documents, "New course…"). A course gets an **Overview** tab (progress tiles, weakest concepts, "Study the whole course" links, documents) and an "Edit course" button in place of "Replace". A PDF dropped while a course is open becomes a new document.

## 6. Page-linked citations and the PDF viewer

- Chunks carry their page from ingest. Chat context is numbered (`[n] (label)`) and the prompt asks the model to cite `[n]`.
- `/chat` and the stream's final event return `citations: [{n, doc_id, doc_name, page, label, snippet, text}]` (snippet ≤ 220 chars, text ≤ 1200).
- The answer's `[n]` markers and the source chips are buttons. They open `PdfViewer` beside the chat (a full-screen sheet at ≤ 900px). pdf.js (`pdfjs-dist` 4.10.38, legacy build, loaded on demand) draws the page, and the cited passage is highlighted by matching its words against the page's text runs (`passageItems`: sliding windows of 6, then 4 words). The passage is also shown in words below the page.
- `GET /documents/{id}/file` serves the PDF inline (`pdf_viewer` feature). A document uploaded before PDFs were kept answers 404 `pdf_unavailable` (action `reupload`), and the viewer asks for the file again.

## 7. The concept map

- **One AI pass per document content**, cached in `concept_maps` by file hash and extractor `VERSION`, shared by every user and course with the same PDF. `GET /concept-map?session_id=` never starts work; `POST /concept-map` starts the documents that have no map (or failed, or whose job died) as background tasks and returns at once.
- **The pass:** `concept_brain.digest()` spreads passages over the whole document with `[p.N]` marks. The model returns at most 24 concepts (name, summary, importance 1-3, page) and 40 relations; unusable ones are dropped. A 150 s timeout is followed by one retry with half the digest; a missing key or quota error is not retried. Progress is the row's `stage` line.
- **A course map** is the union of its documents' maps; concepts with the same normalised name merge, which links the PDFs.
- **Heat** comes from `concept_mastery` (quiz, flashcards, review, arena, exams), with near names counted: new (never asked), weak (accuracy < 50% or 2 misses in a row), learning, strong (≥ 2 seen, ≥ 80%, no current miss streak).
- **UI (Study → Map):** a calm constellation. Its layout is deterministic (`layoutConstellation`): central concepts on the inner ring, linked stars placed together, fixed relaxation steps, a minimum gap. Star size = importance; colour **and** ring style = heat (solid strong, dashed learning, dotted weak, none for new), with a legend. Keyboard: one tab stop; arrows move to the nearest linked star in that direction (`starInDirection`), Home goes to the most central one, Enter opens it, Esc closes it. A list view (grouped Central / Important / Supporting) is the default on a phone. A concept's panel shows its summary, answers, pages and links, and offers **Quick quiz on it**, **Flashcards** (`/study?tab=quiz|flashcards&doc=&topic=`) and **Summon its boss** (`/hero?tab=arena&doc=&topic=`, a Quick Battle on that document with the topic filled in).

## 8. Data (migration 0011)

| Table | Contents |
|---|---|
| `courses` | id, user, name, description. |
| `course_documents` | course, document, position. Deleted with either side. |
| `concept_maps` | doc_hash + version, status (queued / running / ready / failed), stage, data_json, error, model. Shared, not per user. |
