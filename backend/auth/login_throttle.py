"""Failed logins per account (Phase 3 Stage 4d security pass; docs/security.md).

The per-client limit on /auth/login (5 a minute) stops one machine guessing fast; this stops many machines (or a
slow, patient one) guessing ONE account's password: after MAX_FAILURES wrong passwords for an email within WINDOW,
that email is refused for the rest of the window, whatever the client. A right password clears it. In memory:
a restart forgets it (it is a speed bump, not a ledger), and every server process keeps its own count.
"""
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60


class LoginThrottle:
    def __init__(self, max_failures: int = MAX_FAILURES, window: float = WINDOW_SECONDS, clock=time.monotonic):
        self.max, self.window, self.clock = max_failures, window, clock
        self._fails: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _key(self, email: str) -> str:
        return (email or "").strip().lower()

    def _trim(self, q: Deque[float], now: float) -> None:
        while q and q[0] <= now - self.window:
            q.popleft()

    def retry_after(self, email: str) -> int:
        """Seconds until this email may try again (0 = it may now)."""
        with self._lock:
            q, now = self._fails.get(self._key(email)), self.clock()
            if not q:
                return 0
            self._trim(q, now)
            return int(q[0] + self.window - now) + 1 if len(q) >= self.max else 0

    def failed(self, email: str) -> None:
        with self._lock:
            q, now = self._fails[self._key(email)], self.clock()
            self._trim(q, now)
            q.append(now)
            if len(self._fails) > 50_000:                 # never grows without bound
                for k in [k for k, v in self._fails.items() if not v or v[-1] <= now - self.window]:
                    self._fails.pop(k, None)

    def succeeded(self, email: str) -> None:
        with self._lock:
            self._fails.pop(self._key(email), None)

    def clear(self) -> None:
        with self._lock:
            self._fails.clear()
