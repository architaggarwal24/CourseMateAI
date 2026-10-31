"""Short-lived cache of generated quizzes, flashcard sets and notes.

The same request (same document content, topic, options and model) gets the stored result instead of another LLM
call. In memory only: a restart simply regenerates. The key contains the document's content hash, so a re-uploaded
different PDF never sees an old result, and the user id, so nothing is shared between accounts."""
import copy
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Hashable, Optional


class GenerationCache:
    def __init__(self, ttl_seconds: float, max_entries: int = 256, clock: Callable[[], float] = time.monotonic):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._clock = clock
        self._items: "OrderedDict[Hashable, tuple]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> Optional[Any]:
        """A private copy of the stored value (callers add per-request fields to it), or None."""
        if self.ttl <= 0:
            return None
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                return None
            expires, value = entry
            if expires <= self._clock():
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return copy.deepcopy(value)

    def put(self, key: Hashable, value: Any) -> None:
        if self.ttl <= 0:
            return
        with self._lock:
            self._items[key] = (self._clock() + self.ttl, copy.deepcopy(value))
            self._items.move_to_end(key)
            while len(self._items) > self.max_entries:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


def cache_key(kind: str, *, user_id, file_hash: str, topic: str, options: dict, model: str) -> tuple:
    """(kind, user, document hash, topic, options, model) - everything the generated text depends on."""
    return (kind, str(user_id), file_hash, topic.strip().lower(), tuple(sorted(options.items())), model)
