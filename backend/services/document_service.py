"""Documents: durable, indexed in the background, with the in-memory dict as a cache only.

The `documents` table (migration 0002) is the source of truth for ownership, status, expiry and caps.
`cache` (state.vector_stores) holds FAISS indexes that have been loaded from disk, filled lazily on first use
and rebuilt from disk after a restart - nothing about a document lives only in memory.

Upload flow
  register_upload()  validate -> (reuse | replace | create) the row -> write the source PDF -> enqueue
  worker thread      queued -> reading -> indexing -> ready   (or failed with a user-safe message)

On disk (under the uploads folder)
  sources/<id>_<hash16>.pdf   the uploaded file, only while it is being indexed
  indexes/<uuid>/             a saved FAISS index; rows hold the relative path in documents.index_path and
                              several rows of one user can share an index (same file hash = reuse)
  <id>_meta.json, <id>_index_*  the pre-table layout; imported into the table once at startup
"""
import asyncio
import json
import logging
import queue
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from database.documents import IN_FLIGHT, DocumentRepository, utc_ago
from errors import (
    AppError, document_failed, document_needs_reindex, document_not_found, document_not_ready,
    forbidden, session_expired,
)
from rag.multi_index import MultiIndex
from services import entitlements
from rag.loaders import chunk_documents, load_pdf
from rag.vectorstore import VectorStore
from services.session_service import is_valid_session_id

logger = logging.getLogger(__name__)

# The model every index built before documents recorded theirs was made with.
LEGACY_EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5"
INTERRUPTED = "Processing was interrupted by a server restart. Please upload the file again."
GENERIC_FAILURE = "We couldn't process this PDF. Please try a different file."


class DocumentError(Exception):
    """A processing failure whose message is safe to show to the user (stored in documents.error)."""


class _WorkerPool:
    """A fixed number of daemon threads draining a queue: that number is the concurrency limit.

    Daemon threads on purpose: a job cut short by shutdown leaves its row in a non-final status, and the
    next startup requeues it (see DocumentService.startup)."""

    def __init__(self, size: int, handler, name: str = "indexer"):
        self._size, self._handler, self._name = size, handler, name
        self._q: "queue.Queue[tuple]" = queue.Queue()
        self._threads: List[threading.Thread] = []
        self._start_lock = threading.Lock()

    def submit(self, *args) -> None:
        self._ensure_started()
        self._q.put(args)

    def _ensure_started(self) -> None:
        with self._start_lock:
            while len(self._threads) < self._size:
                t = threading.Thread(target=self._loop, name=f"{self._name}-{len(self._threads) + 1}", daemon=True)
                t.start()
                self._threads.append(t)

    def _loop(self) -> None:
        while True:
            args = self._q.get()
            try:
                self._handler(*args)
            except Exception:                                    # never let a bad job kill the worker
                logger.exception("Indexing worker crashed on a job")
            finally:
                self._q.task_done()

    def wait_idle(self, timeout: float = 60.0) -> bool:
        deadline = time.monotonic() + timeout
        while self._q.unfinished_tasks:
            if time.monotonic() > deadline:
                return False
            time.sleep(0.01)
        return True


def public_view(row: Dict) -> Dict:
    """What the API exposes about a document (no internal paths, no owner id)."""
    return {k: row.get(k) for k in (
        "id", "filename", "file_hash", "status", "error", "chunks", "embedding_model", "created_at", "last_used_at")}


COURSE_HASH_PREFIX = "course:"


def course_hash(course_id: str) -> str:
    """The 'content hash' a course stands under wherever a document's would (mastery, review cards, caches)."""
    return f"{COURSE_HASH_PREFIX}{course_id}"


def course_view(course: Dict, members: List[Dict]) -> Dict:
    """A course seen through the documents API: what get_document() answers for a course id."""
    ready = [m for m in members if m["status"] == "ready"]
    status = "ready" if ready else ("queued" if any(m["status"] in IN_FLIGHT for m in members) else "failed")
    return {"id": course["id"], "filename": course["name"], "file_hash": course_hash(course["id"]), "status": status,
            "error": None if ready else "This course has no ready documents yet.", "chunks": sum(m["chunks"] or 0 for m in ready),
            "embedding_model": None, "created_at": course["created_at"], "last_used_at": course["updated_at"],
            "kind": "course", "documents": [m["id"] for m in members]}


def _hex(file_hash: str) -> Optional[str]:
    h = (file_hash or "").lower()
    return h if h and all(c in "0123456789abcdef" for c in h) else None


class DocumentService:
    def __init__(self, repo: DocumentRepository, cache: Dict, *, upload_dir: Path, embedding_model: str,
                 concurrency: int, max_per_user: int, max_documents: int, expiry_hours: float):
        self.repo = repo
        self.cache = cache                       # session_id -> loaded index (see _entry)
        self.upload_dir = Path(upload_dir)
        self.embedding_model = embedding_model
        self.max_per_user = max_per_user
        self.max_documents = max_documents
        self.expiry_hours = expiry_hours
        self._lock = threading.RLock()           # serialises upload registration / eviction
        self._cache_lock = threading.Lock()      # the cache is touched by worker threads and request threads
        self._pool = _WorkerPool(concurrency, self._run_job)
        for d in (self.upload_dir, self.sources_dir, self.indexes_dir, self.files_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ── paths ────────────────────────────────────────────────────────────────
    @property
    def sources_dir(self) -> Path:
        return self.upload_dir / "sources"

    @property
    def indexes_dir(self) -> Path:
        return self.upload_dir / "indexes"

    @property
    def files_dir(self) -> Path:
        """The kept original PDFs, one per CONTENT (shared by every document with the same file hash)."""
        return self.upload_dir / "files"

    def pdf_path(self, file_hash: str) -> Optional[Path]:
        h = _hex(file_hash)
        return self.files_dir / f"{h}.pdf" if h else None

    def has_pdf(self, file_hash: str) -> bool:
        p = self.pdf_path(file_hash)
        return bool(p and p.is_file())

    def _keep_pdf(self, file_hash: str, content: Optional[bytes] = None, src: Optional[Path] = None) -> None:
        """Keep the original next to the index (the side-by-side viewer reads it). Never fails an upload."""
        p = self.pdf_path(file_hash)
        if not p or p.is_file():
            return
        try:
            self.files_dir.mkdir(parents=True, exist_ok=True)
            if src is not None and src.is_file():
                shutil.copyfile(src, p)
            elif content is not None:
                p.write_bytes(content)
        except OSError:
            logger.exception("Could not keep the PDF of %s", file_hash[:12])

    def _source_path(self, doc_id: str, file_hash: str) -> Path:
        return self.sources_dir / f"{doc_id}_{file_hash[:16]}.pdf"

    def _index_dir(self, rel: Optional[str]) -> Optional[Path]:
        """Resolve a stored relative index path; never follow it out of the uploads folder."""
        if not rel:
            return None
        p = (self.upload_dir / rel).resolve()
        root = self.upload_dir.resolve()
        return p if root in p.parents else None

    # ── upload ───────────────────────────────────────────────────────────────
    def register_upload(self, user_id: int, filename: str, session_id: Optional[str],
                        content: bytes, file_hash: str) -> Tuple[Dict, bool]:
        """Record an upload and return (document, reused) immediately; indexing happens in the background.

        reused=True means no new work was started: the document was already there/being built, or an
        existing index of this user's with the same file hash is shared instead of being rebuilt."""
        user_id = int(user_id)
        if session_id and self.repo.course(session_id):
            raise AppError("invalid_input", "That id belongs to a course: upload the PDF on its own, then add it to the course.",
                           status_code=400)
        with self._lock:
            existing = self.repo.get(session_id) if session_id else None
            if existing and existing["user_id"] != user_id:
                raise forbidden("That session belongs to another account.")   # never overwrite someone else's
            doc_id = session_id or str(uuid.uuid4())

            # Same file already attached to this id.
            if existing and existing["file_hash"] == file_hash:
                if existing["status"] in IN_FLIGHT:
                    return public_view(existing), True
                if existing["status"] == "ready" and self._index_usable(existing):
                    self._keep_pdf(file_hash, content)                 # (an upload from before PDFs were kept)
                    self.repo.touch(doc_id)
                    return public_view(self.repo.get(doc_id)), True

            # Same file already indexed under another of this user's documents: share that index.
            for donor in self.repo.find_ready_by_hash(user_id, file_hash, self.embedding_model, exclude_id=doc_id):
                if self._index_usable(donor):
                    self._keep_pdf(file_hash, content)
                    self._make_room(user_id, doc_id, is_new=existing is None)
                    old_index = existing["index_path"] if existing else None
                    self._cache_drop(doc_id)
                    self.repo.upsert_ready_copy(doc_id, user_id, filename, file_hash, donor["chunks"],
                                                donor["embedding_model"], donor["index_path"])
                    self._drop_index_if_unreferenced(old_index)
                    return public_view(self.repo.get(doc_id)), True

            # New build.
            self._make_room(user_id, doc_id, is_new=existing is None)
            self.sources_dir.mkdir(parents=True, exist_ok=True)
            self._source_path(doc_id, file_hash).write_bytes(content)
            self._cache_drop(doc_id)
            self.repo.upsert_queued(doc_id, user_id, filename, file_hash)
            registered = public_view(self.repo.get(doc_id))      # read BEFORE enqueueing: always "queued"
            self._pool.submit(doc_id, file_hash)
            return registered, False

    def _index_usable(self, row: Dict) -> bool:
        path = self._index_dir(row.get("index_path"))
        return bool(path and path.is_dir() and row.get("embedding_model") == self.embedding_model)

    # ── background job ───────────────────────────────────────────────────────
    def _run_job(self, doc_id: str, file_hash: str) -> None:
        row = self.repo.get(doc_id)
        if not row or row["file_hash"] != file_hash or row["status"] != "queued":
            self._source_path(doc_id, file_hash).unlink(missing_ok=True)       # replaced or deleted meanwhile
            return
        src = self._source_path(doc_id, file_hash)
        new_rel: Optional[str] = None
        try:
            if not self.repo.transition(doc_id, file_hash, "queued", "reading"):
                return
            documents = load_pdf(str(src))
            if not documents or not any((d.page_content or "").strip() for d in documents):
                raise DocumentError(
                    "No readable text was found in this PDF. It may be a scanned or image-only document — "
                    "try a text-based PDF (or run OCR on it first).")
            for d in documents:
                d.metadata["source"] = row["filename"]        # don't leak server paths through `source`
            chunks = [c for c in chunk_documents(documents) if (c.page_content or "").strip()]
            if not chunks:
                raise DocumentError("No readable text was found in this PDF.")

            if not self.repo.transition(doc_id, file_hash, "reading", "indexing"):
                return
            vectorstore = VectorStore(chunks)
            self.indexes_dir.mkdir(parents=True, exist_ok=True)
            new_rel = f"indexes/{uuid.uuid4().hex}"
            vectorstore.save(str(self.upload_dir / new_rel))

            old_rel = row["index_path"]
            if not self.repo.mark_ready(doc_id, file_hash, len(chunks), self.embedding_model, new_rel):
                return                                         # replaced/deleted while indexing: finally discards it
            committed, new_rel = new_rel, None
            self._keep_pdf(file_hash, src=src)
            self._cache_put(doc_id, vectorstore, row, len(chunks), committed)
            if old_rel and old_rel != committed:
                self._drop_index_if_unreferenced(old_rel)
            logger.info("Indexed %s (%d chunks)", doc_id, len(chunks))
        except DocumentError as exc:
            self.repo.mark_failed(doc_id, file_hash, str(exc))
        except Exception:
            logger.exception("Indexing failed for document %s", doc_id)    # details stay in the log
            self.repo.mark_failed(doc_id, file_hash, GENERIC_FAILURE)
        finally:
            src.unlink(missing_ok=True)                         # (kept under files/ by content, once indexed)
            if new_rel:                                         # built but never committed
                shutil.rmtree(self.upload_dir / new_rel, ignore_errors=True)

    def wait_idle(self, timeout: float = 60.0) -> bool:
        """Block until the queue is drained (tests, graceful scripts)."""
        return self._pool.wait_idle(timeout)

    # ── reading ──────────────────────────────────────────────────────────────
    def _view(self, row: Dict) -> Dict:
        return {**public_view(row), "pdf_available": self.has_pdf(row["file_hash"]), "pinned": self.repo.pinned(row["id"])}

    def get_document(self, doc_id: str, user_id: int) -> Dict:
        """A document the user owns - or a course of theirs, seen as one document (see course_view)."""
        row = self.repo.get(doc_id)
        if row is None:
            course = self.repo.course(doc_id)
            if course and course["user_id"] == int(user_id):
                entitlements.require(user_id, "courses")
                return course_view(course, self.repo.course_documents(doc_id))
        if not row or row["user_id"] != int(user_id):
            raise document_not_found()                          # don't reveal other users' ids
        return self._view(row)

    def list_documents(self, user_id: int) -> List[Dict]:
        return [self._view(r) for r in self.repo.list_for_user(int(user_id))]

    def pdf_file(self, doc_id: str, user_id: int) -> Tuple[Path, Dict]:
        """The kept original PDF of a document the user owns (404 pdf_unavailable for one uploaded before PDFs
        were kept: uploading it again brings it back)."""
        row = self.repo.get(doc_id)
        if not row or row["user_id"] != int(user_id):
            raise document_not_found()
        p = self.pdf_path(row["file_hash"])
        if not p or not p.is_file():
            raise AppError("pdf_unavailable", "The original PDF isn't stored for this document. Upload it again to "
                           "open its pages.", status_code=404, action="reupload")
        return p, row

    def delete_document(self, doc_id: str, user_id: int) -> None:
        """Remove one of the user's documents (rows, index, files; it leaves its courses)."""
        row = self.repo.get(doc_id)
        if not row or row["user_id"] != int(user_id):
            raise document_not_found()
        with self._lock:
            self._remove([row])

    def check_owner(self, doc_id: str, user_id: int) -> None:
        """403 if the document belongs to someone else. Unknown ids pass: callers report "no document"."""
        row = self.repo.get(doc_id)
        if row and row["user_id"] != int(user_id):
            raise forbidden("That session belongs to another account.")

    def _checked(self, doc_id: str, user_id: int) -> Dict:
        row = self.repo.get(doc_id)
        if row is None:
            raise session_expired()
        if row["user_id"] != int(user_id):
            raise forbidden("That session belongs to another account.")
        status = row["status"]
        if status == "ready":
            if row["embedding_model"] != self.embedding_model:
                self.repo.mark_needs_reindex(doc_id)
                raise document_needs_reindex()
            return row
        if status in IN_FLIGHT:
            raise document_not_ready(status)
        if status == "failed":
            raise document_failed(row["error"])
        raise document_needs_reindex()

    async def get_index(self, doc_id: str, user_id: int) -> MultiIndex:
        """The searchable index of a READY document the user owns (ownership + status checked, loaded from disk
        on first use, last_used_at refreshed so expiry counts from last use, not from upload) - or of a course of
        theirs: every ready document of it, searched together. Hits are tagged with their document."""
        row = await asyncio.to_thread(self.repo.get, doc_id)
        if row is None:
            course = await asyncio.to_thread(self.repo.course, doc_id)
            if course is not None:
                return await self._course_index(course, user_id)
        store = await self._doc_store(doc_id, user_id)
        return MultiIndex([(doc_id, row["filename"] if row else "", store)])

    async def chunks(self, doc_id: str, user_id: int) -> List:
        """Every chunk of one of the user's ready documents, in reading order (the concept map reads these)."""
        store = await self._doc_store(doc_id, user_id)
        return await asyncio.to_thread(store.chunks)

    async def _course_index(self, course: Dict, user_id: int) -> MultiIndex:
        if course["user_id"] != int(user_id):
            raise forbidden("That course belongs to another account.")
        entitlements.require(user_id, "courses")
        members = await asyncio.to_thread(self.repo.course_documents, course["id"])
        ready = [m for m in members if m["status"] == "ready" and m["embedding_model"] == self.embedding_model]
        if not ready:
            raise AppError("course_empty", "This course has no ready documents yet. Add a PDF to it, or wait for its "
                           "documents to finish indexing.", status_code=409)
        out = []
        for m in ready:
            try:
                out.append((m["id"], m["filename"], await self._doc_store(m["id"], user_id)))
            except AppError:
                logger.warning("course %s: skipping document %s", course["id"], m["id"])
        if not out:
            raise document_failed("None of this course's documents could be loaded. Please upload them again.")
        return MultiIndex(out)

    async def _doc_store(self, doc_id: str, user_id: int) -> VectorStore:
        # SQLite reads/writes and the FAISS load all happen in worker threads: nothing here blocks the event loop.
        row = await asyncio.to_thread(self._checked, doc_id, user_id)
        entry = self.cache.get(doc_id)
        if entry is None or entry.get("file_hash") != row["file_hash"] or entry.get("index_path") != row["index_path"]:
            entry = await asyncio.to_thread(self._load, row)
        await asyncio.to_thread(self.repo.touch, doc_id)
        entry["last_used"] = datetime.now()
        return entry["store"]

    def _load(self, row: Dict) -> Dict:
        path = self._index_dir(row["index_path"])
        try:
            if not path or not path.is_dir():
                raise FileNotFoundError(row["index_path"])
            store = VectorStore.load(str(path))
        except Exception:
            logger.exception("Could not load the index of document %s", row["id"])
            message = "This document's index could not be loaded. Please upload it again."
            self.repo.fail_ready(row["id"], message)
            raise document_failed(message)
        return self._cache_put(row["id"], store, row, row["chunks"], row["index_path"])

    def _cache_put(self, doc_id: str, store: VectorStore, row: Dict, chunks: Optional[int], index_path: str) -> Dict:
        entry = {
            "store": store, "filename": row["filename"], "file_hash": row["file_hash"], "chunks": chunks,
            "index_path": index_path, "store_path": str(self.upload_dir / index_path),
            "user_id": str(row["user_id"]), "last_used": datetime.now(),
        }
        with self._cache_lock:
            self.cache[doc_id] = entry
            while len(self.cache) > max(self.max_documents, 1):     # the cache can't outgrow the documents
                oldest = min(self.cache, key=lambda k: self.cache[k].get("last_used") or datetime.min)
                if oldest == doc_id:
                    break
                self.cache.pop(oldest, None)
        return entry

    def _cache_drop(self, doc_id: str) -> None:
        with self._cache_lock:
            self.cache.pop(doc_id, None)

    # ── expiry, caps, deletion ───────────────────────────────────────────────
    def _make_room(self, user_id: int, keep_id: str, is_new: bool) -> None:
        """Evict least-recently-used documents BEFORE adding one, so a user can't push others out."""
        if not is_new:
            return                                              # replacing an id doesn't grow anything
        over = self.repo.count_for_user(user_id) - (self.max_per_user - 1)
        if over > 0:
            removed = self._remove(self.repo.oldest_removable(over, user_id=user_id, exclude_id=keep_id))
            logger.info("Evicted %d document(s) for user %s (per-user cap)", removed, user_id)
        over = self.repo.count_all() - (self.max_documents - 1)
        if over > 0:
            self._remove(self.repo.oldest_removable(over, exclude_id=keep_id))

    def cleanup(self) -> Dict[str, int]:
        """Periodic housekeeping on the table: drop documents idle past the expiry, then enforce the global cap."""
        with self._lock:
            expired = self._remove(self.repo.idle_since(utc_ago(hours=self.expiry_hours)))
            over = self.repo.count_all() - self.max_documents
            limited = self._remove(self.repo.oldest_removable(over)) if over > 0 else 0
        if expired or limited:
            logger.info("Document cleanup: %d expired, %d over the cap", expired, limited)
        return {"expired_documents": expired, "limit_enforced_documents": limited,
                "total_removed": expired + limited, "active_documents": self.repo.count_all()}

    def delete_user_documents(self, user_id: int) -> int:
        """Account deletion: remove every document (rows, cached indexes, files) the user owns."""
        with self._lock:
            return self._remove(self.repo.list_for_user(int(user_id)))

    def count_ready(self) -> int:
        return self.repo.count_ready()

    def _remove(self, rows: List[Dict]) -> int:
        for row in rows:
            self.repo.delete(row["id"])
            self._cache_drop(row["id"])
            self._delete_files(row)
        return len(rows)

    def _delete_files(self, row: Dict) -> None:
        doc_id = row["id"]
        if self.repo.hash_refs(row["file_hash"]) == 0:             # the last document with this content
            p = self.pdf_path(row["file_hash"])
            if p:
                p.unlink(missing_ok=True)
        if is_valid_session_id(doc_id):                          # never build a glob from an unvalidated id
            for p in self.sources_dir.glob(f"{doc_id}_*.pdf"):
                p.unlink(missing_ok=True)
            (self.upload_dir / f"{doc_id}_meta.json").unlink(missing_ok=True)
        self._drop_index_if_unreferenced(row.get("index_path"))

    def _drop_index_if_unreferenced(self, rel: Optional[str]) -> None:
        path = self._index_dir(rel)
        if path and self.repo.index_refs(rel) == 0:
            shutil.rmtree(path, ignore_errors=True)

    # ── startup ──────────────────────────────────────────────────────────────
    def startup(self) -> Dict[str, int]:
        """Reconcile the table with reality after a (re)start. Indexes are NOT loaded here - they load on first use."""
        stats = {"imported": self._import_legacy_layout()}
        stats["needs_reindex"] = self.repo.mark_needs_reindex_where_model_differs(self.embedding_model)
        stats["resumed"] = stats["interrupted"] = 0
        for row in self.repo.in_flight():                        # the previous process died mid-job
            if self._source_path(row["id"], row["file_hash"]).exists():
                self.repo.requeue(row["id"])
                self._pool.submit(row["id"], row["file_hash"])
                stats["resumed"] += 1
            else:
                self.repo.mark_failed(row["id"], row["file_hash"], INTERRUPTED)
                stats["interrupted"] += 1
        logger.info("Documents ready: %s", stats)
        return stats

    def _import_legacy_layout(self) -> int:
        """One-time import of sessions saved before the documents table existed (<id>_meta.json + index dir).
        Sessions without an owner are not imported (they would be readable by everyone)."""
        imported = 0
        for meta_path in self.upload_dir.glob("*_meta.json"):
            doc_id = meta_path.name[: -len("_meta.json")]
            if not is_valid_session_id(doc_id) or self.repo.get(doc_id):
                continue
            try:
                meta = json.loads(meta_path.read_text())
                owner = meta.get("user_id")
                if not owner or not self.repo.db.get_user_by_id(int(owner)):
                    logger.warning("Not importing session %s: no (existing) owner", doc_id)
                    continue
                rel = str(meta.get("index_dir") or f"{doc_id}_index")
                index_dir = self._index_dir(rel)
                if not index_dir or not index_dir.is_dir():
                    continue
                created = None
                try:
                    created = datetime.fromisoformat(meta["created_at"]).astimezone().isoformat(timespec="milliseconds")
                except (KeyError, ValueError, TypeError):
                    pass
                self.repo.upsert_ready_copy(doc_id, int(owner), str(meta.get("filename") or "document.pdf"),
                                            str(meta.get("file_hash") or ""), meta.get("chunks"),
                                            LEGACY_EMBEDDING_MODEL, rel, created_at=created)
                imported += 1
            except Exception as exc:
                logger.warning("Could not import session %s: %s", doc_id, exc)
        return imported
