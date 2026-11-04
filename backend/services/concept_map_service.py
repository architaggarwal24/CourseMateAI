"""Concept maps (Phase 3, Stage 3B; docs/study-power.md section 7).

    build    ONE LLM pass per document CONTENT (core_brains/concept_brain.py), run as a background task so the
             request returns at once; the row in concept_maps follows it (queued -> running -> ready | failed) and
             its `stage` is the progress line the page shows. A map is made once per file hash and extractor
             VERSION and reused by every course and every user with the same PDF - asking again costs nothing.
    view     the map of a document, or of a course: the union of its documents' maps, concepts with the same name
             merged (so a concept shared by two PDFs links them). Every concept carries its mastery heat from
             concept_mastery (what the arena, quizzes, flashcards, reviews and exams recorded):
             new (never asked) / weak / learning / strong.

A job that this process isn't running (it died, or the server restarted) is started again on the next build
request, never left "running" forever.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from core_brains.concept_brain import extract_concept_map
from core_brains.llm_connection import request_model_id
from core_brains.llm_schemas import question_key

logger = logging.getLogger(__name__)

VERSION = 1
FAILED_TEXT = "The concept map couldn't be made this time. Try again - a faster (non-reasoning) model helps."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def heat(seen: int, correct: int, wrong_streak: int) -> str:
    """How well a concept is known, from its mastery counters."""
    if not seen:
        return "new"
    acc = correct / seen
    if wrong_streak >= 2 or acc < 0.5:
        return "weak"
    if seen >= 2 and acc >= 0.8 and not wrong_streak:
        return "strong"
    return "learning"


class ConceptMapService:
    def __init__(self, store, documents, extractor=None):
        self.store = store
        self.documents = documents
        self.extract = extractor or extract_concept_map
        self._active: Dict[str, asyncio.Task] = {}          # doc_hash -> the task building it in THIS process

    # ── scope ────────────────────────────────────────────────────────────────
    def _scope(self, user_id, scope_id: str) -> Dict:
        """The documents a map is made of, and the mastery hashes it is coloured by."""
        doc = self.documents.get_document(scope_id, user_id)          # ownership (and the course gate)
        if doc.get("kind") == "course":
            members = self.documents.repo.course_documents(scope_id)
            return {"kind": "course", "name": doc["filename"], "docs": members,
                    "hashes": [m["file_hash"] for m in members] + [doc["file_hash"]]}
        row = self.documents.repo.get(scope_id)
        return {"kind": "document", "name": doc["filename"], "docs": [row], "hashes": [row["file_hash"]]}

    def _row(self, doc_hash: str) -> Optional[Dict]:
        return self.store.fetchone("SELECT * FROM concept_maps WHERE doc_hash = ? AND version = ?", (doc_hash, VERSION))

    def _set(self, doc_hash: str, **fields) -> None:
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.store.execute(f"UPDATE concept_maps SET {cols}, updated_at = ? WHERE doc_hash = ? AND version = ?",
                           (*fields.values(), _now(), doc_hash, VERSION))

    # ── building ─────────────────────────────────────────────────────────────
    async def build(self, user_id, scope_id: str) -> Dict:
        """Start the map of every document in the scope that has none yet (or whose last try failed / died).
        Returns at once with the view; the page polls view() while it builds."""
        scope = await asyncio.to_thread(self._scope, user_id, scope_id)
        for d in scope["docs"]:
            if d["status"] != "ready":
                continue
            row = await asyncio.to_thread(self._row, d["file_hash"])
            running_here = d["file_hash"] in self._active and not self._active[d["file_hash"]].done()
            if row and (row["status"] == "ready" or running_here):
                continue
            await asyncio.to_thread(self._queue, d["file_hash"])
            task = asyncio.create_task(self._run(user_id, d["id"], d["file_hash"]))   # carries this request's LLM key
            self._active[d["file_hash"]] = task
            task.add_done_callback(lambda t, h=d["file_hash"]: self._active.pop(h, None) if self._active.get(h) is t else None)
        return await asyncio.to_thread(self.view, user_id, scope_id)

    def _queue(self, doc_hash: str) -> None:
        now = _now()
        self.store.execute(
            "INSERT INTO concept_maps (doc_hash, version, status, stage, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?) "
            "ON CONFLICT(doc_hash, version) DO UPDATE SET status = 'queued', stage = excluded.stage, error = NULL, "
            "updated_at = excluded.updated_at", (doc_hash, VERSION, "Waiting to start…", now, now))

    async def _run(self, user_id, doc_id: str, doc_hash: str) -> None:
        async def stage(text: str):
            await asyncio.to_thread(self._set, doc_hash, status="running", stage=text)
        try:
            await stage("Reading the document…")
            chunks = await self.documents.chunks(doc_id, user_id)
            data = await self.extract(chunks, on_stage=stage)
            await asyncio.to_thread(self._set, doc_hash, status="ready", stage=None, error=None,
                                    data_json=json.dumps(data), model=request_model_id())
            logger.info("concept map ready for %s (%d concepts)", doc_hash[:12], len(data.get("concepts", [])))
        except Exception as exc:
            logger.warning("concept map failed for %s: %s", doc_hash[:12], type(exc).__name__)
            await asyncio.to_thread(self._set, doc_hash, status="failed", stage=None, error=FAILED_TEXT)

    # ── viewing ──────────────────────────────────────────────────────────────
    def view(self, user_id, scope_id: str) -> Dict:
        scope = self._scope(user_id, scope_id)
        docs, concepts, relations = [], {}, {}
        for d in scope["docs"]:
            row = self._row(d["file_hash"]) if d["status"] == "ready" else None
            status = row["status"] if row else ("none" if d["status"] == "ready" else "not_ready")
            if row and row["status"] in ("queued", "running") and d["file_hash"] not in self._active:
                status = "stalled"                                      # its job is gone: build() restarts it
            docs.append({"id": d["id"], "name": d["filename"], "status": status,
                         "stage": row["stage"] if row else None, "error": row["error"] if row else None})
            if not row or row["status"] != "ready":
                continue
            data = json.loads(row["data_json"] or "{}")
            for c in data.get("concepts", []):
                key = question_key(c["name"])
                into = concepts.setdefault(key, {"id": key, "name": c["name"], "summary": c.get("summary") or "",
                                                 "importance": 0, "pages": [], "docs": []})
                into["importance"] = max(into["importance"], int(c.get("importance") or 2))
                if not into["summary"] and c.get("summary"):
                    into["summary"] = c["summary"]
                if d["id"] not in into["docs"]:
                    into["docs"].append(d["id"])
                if c.get("page"):
                    into["pages"].append({"doc_id": d["id"], "page": int(c["page"])})
            for r in data.get("relations", []):
                a, b = question_key(r["source"]), question_key(r["target"])
                if a in concepts and b in concepts and (a, b) not in relations and (b, a) not in relations:
                    relations[(a, b)] = {"source": a, "target": b, "label": r.get("label") or ""}
        self._heat(user_id, scope["hashes"], concepts)
        built = sum(1 for d in docs if d["status"] == "ready")
        buildable = [d for d in docs if d["status"] != "not_ready"]
        if not buildable:
            status = "not_ready"
        elif built == len(buildable):
            status = "ready"
        elif any(d["status"] in ("queued", "running") for d in buildable):
            status = "building"
        elif any(d["status"] == "failed" for d in buildable):
            status = "failed" if not built else "partial"
        else:
            status = "none" if not built else "partial"
        stage = next((d["stage"] for d in docs if d["status"] in ("queued", "running") and d["stage"]), None)
        return {"scope": {"id": scope_id, "kind": scope["kind"], "name": scope["name"]}, "status": status, "stage": stage,
                "built": built, "total": len(buildable), "documents": docs,
                "concepts": sorted(concepts.values(), key=lambda c: (-c["importance"], c["name"].lower())),
                "relations": list(relations.values())}

    def _heat(self, user_id, hashes: List[str], concepts: Dict[str, Dict]) -> None:
        marks = ",".join("?" for _ in hashes)
        rows = self.store.fetchall(
            f"SELECT concept_key, SUM(seen) AS seen, SUM(correct) AS correct, MAX(wrong_streak) AS wrong_streak "
            f"FROM concept_mastery WHERE user_id = ? AND doc_hash IN ({marks}) GROUP BY concept_key",
            (int(user_id), *hashes)) if hashes else []
        by_key = {r["concept_key"]: r for r in rows}
        for key, c in concepts.items():
            hits = [r for k, r in by_key.items()
                    if k == key or (len(key) >= 4 and len(k) >= 4 and (key in k or k in key))]
            seen = sum(int(r["seen"]) for r in hits)
            correct = sum(int(r["correct"]) for r in hits)
            streak = max((int(r["wrong_streak"]) for r in hits), default=0)
            c.update(seen=seen, correct=correct, heat=heat(seen, correct, streak))

