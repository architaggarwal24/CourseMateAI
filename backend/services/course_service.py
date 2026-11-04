"""Courses (Phase 3, Stage 3B; docs/study-power.md section 5): a named group of the user's documents.

A course id is a uuid, so it stands wherever a document id does: DocumentService.get_index() searches every ready
document of the course together (rag/multi_index.py), and get_document() answers with the course seen as one
document whose "file hash" is `course:<id>` - so chat, quizzes, flashcards, notes, the arena and exams work on a
whole course with no change, and mastery / review cards made there are the course's.

A document in a course is pinned: it is never removed for being idle (the per-user cap removes loose documents
first). Deleting a course leaves its documents alone.
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from errors import AppError
from services import entitlements
from services.document_service import course_hash

MAX_COURSES = 30
MAX_DOCUMENTS = 20
MAX_NAME, MAX_DESCRIPTION = 80, 500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _not_found() -> AppError:
    return AppError("course_not_found", "That course doesn't exist.", status_code=404)


def _clean_name(name) -> str:
    name = " ".join(str(name or "").split())
    if not name:
        raise AppError("invalid_input", "Give the course a name.", status_code=400, details={"field": "name"})
    return name[:MAX_NAME]


class CourseService:
    def __init__(self, store, documents, mastery=None, review=None):
        self.store = store
        self.documents = documents
        self.mastery = mastery
        self.review = review

    # ── helpers ──────────────────────────────────────────────────────────────
    def _row(self, user_id, course_id) -> Dict:
        row = self.store.fetchone("SELECT * FROM courses WHERE id = ? AND user_id = ?", (str(course_id), int(user_id)))
        if not row:
            raise _not_found()                    # someone else's course looks exactly like a missing one
        return row

    def _members(self, course_id) -> List[Dict]:
        return self.store.fetchall(
            "SELECT d.id, d.filename, d.file_hash, d.status, d.chunks, d.last_used_at FROM course_documents cd "
            "JOIN documents d ON d.id = cd.document_id WHERE cd.course_id = ? ORDER BY cd.position, cd.added_at",
            (course_id,))

    def _owned_documents(self, user_id, doc_ids: List[str]) -> List[str]:
        ids = list(dict.fromkeys(str(d) for d in doc_ids if d))
        if len(ids) > MAX_DOCUMENTS:
            raise AppError("invalid_input", f"A course holds at most {MAX_DOCUMENTS} documents.", status_code=400)
        for d in ids:
            if not self.store.fetchone("SELECT 1 AS x FROM documents WHERE id = ? AND user_id = ?", (d, int(user_id))):
                raise AppError("document_not_found", "One of those documents couldn't be found.", status_code=404,
                               details={"document_id": d})
        return ids

    def _public(self, row: Dict, members: Optional[List[Dict]] = None) -> Dict:
        members = self._members(row["id"]) if members is None else members
        return {"id": row["id"], "name": row["name"], "description": row["description"],
                "created_at": row["created_at"], "updated_at": row["updated_at"],
                "documents": [{"id": m["id"], "filename": m["filename"], "status": m["status"], "chunks": m["chunks"],
                               "pdf_available": self.documents.has_pdf(m["file_hash"])} for m in members],
                "ready": sum(1 for m in members if m["status"] == "ready")}

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def list(self, user_id) -> List[Dict]:
        rows = self.store.fetchall("SELECT * FROM courses WHERE user_id = ? ORDER BY updated_at DESC", (int(user_id),))
        return [self._public(r) for r in rows]

    def get(self, user_id, course_id) -> Dict:
        return self._public(self._row(user_id, course_id))

    def create(self, user_id, *, name: str, description: Optional[str] = None, document_ids: List[str] = ()) -> Dict:
        name = _clean_name(name)
        ids = self._owned_documents(user_id, list(document_ids))
        n = self.store.fetchone("SELECT COUNT(*) AS n FROM courses WHERE user_id = ?", (int(user_id),))["n"]
        allowed = min(MAX_COURSES, entitlements.limits_for(user_id)["courses"])
        if n >= allowed:
            raise entitlements.plan_limit(user_id, "courses", n, allowed,
                                          f"Your plan holds {allowed} courses and you have {n}. Delete one, or upgrade for more.")
        cid, now = str(uuid.uuid4()), _now()
        with self.store.transaction():
            self.store.execute("INSERT INTO courses (id, user_id, name, description, created_at, updated_at) "
                               "VALUES (?, ?, ?, ?, ?, ?)",
                               (cid, int(user_id), name, (str(description or "").strip()[:MAX_DESCRIPTION] or None), now, now))
            for i, d in enumerate(ids):
                self.store.execute("INSERT INTO course_documents (course_id, document_id, position, added_at) "
                                   "VALUES (?, ?, ?, ?)", (cid, d, i, now))
        return self.get(user_id, cid)

    def update(self, user_id, course_id, *, name: Optional[str] = None, description: Optional[str] = None,
               document_ids: Optional[List[str]] = None) -> Dict:
        row = self._row(user_id, course_id)
        now = _now()
        with self.store.transaction():
            if name is not None or description is not None:
                self.store.execute(
                    "UPDATE courses SET name = ?, description = ?, updated_at = ? WHERE id = ?",
                    (_clean_name(name) if name is not None else row["name"],
                     (str(description).strip()[:MAX_DESCRIPTION] or None) if description is not None else row["description"],
                     now, row["id"]))
            if document_ids is not None:                     # the full list, in order (add, remove, reorder)
                ids = self._owned_documents(user_id, document_ids)
                self.store.execute("DELETE FROM course_documents WHERE course_id = ?", (row["id"],))
                for i, d in enumerate(ids):
                    self.store.execute("INSERT INTO course_documents (course_id, document_id, position, added_at) "
                                       "VALUES (?, ?, ?, ?)", (row["id"], d, i, now))
                self.store.execute("UPDATE courses SET updated_at = ? WHERE id = ?", (now, row["id"]))
        return self.get(user_id, course_id)

    def delete(self, user_id, course_id) -> None:
        row = self._row(user_id, course_id)
        self.store.execute("DELETE FROM courses WHERE id = ?", (row["id"],))

    # ── progress ─────────────────────────────────────────────────────────────
    def progress(self, user_id, course_id) -> Dict:
        """How the course is going, from stored data only: concept mastery over its documents (and what was
        studied on the course as a whole), the review cards due, and the exams taken on it."""
        row = self._row(user_id, course_id)
        members = self._members(row["id"])
        hashes = [m["file_hash"] for m in members] + [course_hash(row["id"])]
        marks = ",".join("?" for _ in hashes)
        uid = int(user_id)
        concepts = self.store.fetchall(
            f"SELECT concept_key, MAX(concept) AS concept, SUM(seen) AS seen, SUM(correct) AS correct, "
            f"MAX(wrong_streak) AS wrong_streak FROM concept_mastery WHERE user_id = ? AND doc_hash IN ({marks}) "
            "GROUP BY concept_key", (uid, *hashes))
        strong = sum(1 for c in concepts if c["seen"] >= 2 and c["correct"] / c["seen"] >= 0.8 and not c["wrong_streak"])
        weak = sorted((c for c in concepts if c["seen"] > c["correct"]),
                      key=lambda c: (-(c["seen"] - c["correct"]) - 1.5 * c["wrong_streak"], c["concept"]))
        cards = self.store.fetchone(
            f"SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN due <= ? AND reps > 0 THEN 1 ELSE 0 END), 0) AS due "
            f"FROM review_items WHERE user_id = ? AND doc_hash IN ({marks})",
            (datetime.now(timezone.utc).replace(microsecond=0).isoformat(), uid, *hashes))
        exams = self.store.fetchall(
            f"SELECT id, accuracy, submitted_at, doc_name FROM exams WHERE user_id = ? AND doc_hash IN ({marks}) "
            "AND status = 'graded' ORDER BY submitted_at DESC LIMIT 5", (uid, *hashes))
        per_doc = []
        for m in members:
            r = self.store.fetchone("SELECT COUNT(*) AS n, COALESCE(SUM(seen), 0) AS seen, COALESCE(SUM(correct), 0) AS correct "
                                    "FROM concept_mastery WHERE user_id = ? AND doc_hash = ?", (uid, m["file_hash"]))
            per_doc.append({"id": m["id"], "filename": m["filename"], "concepts": int(r["n"]), "answered": int(r["seen"]),
                            "accuracy": round(r["correct"] / r["seen"], 4) if r["seen"] else None})
        answered = sum(int(c["seen"]) for c in concepts)
        return {
            "course_id": row["id"],
            "concepts": {"seen": len(concepts), "strong": strong, "weak": len(weak),
                         "weakest": [c["concept"] for c in weak[:5]]},
            "answers": {"total": answered, "correct": sum(int(c["correct"]) for c in concepts),
                        "accuracy": round(sum(int(c["correct"]) for c in concepts) / answered, 4) if answered else None},
            "review": {"cards": int(cards["total"] or 0), "due": int(cards["due"] or 0)},
            "exams": [{"id": e["id"], "accuracy": e["accuracy"], "submitted_at": e["submitted_at"]} for e in exams],
            "documents": per_doc,
            "mastery": round(strong / len(concepts), 4) if concepts else 0.0,
        }
