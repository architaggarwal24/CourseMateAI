import { useCallback, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 80;

/**
 * Auto-scroll for a chat list that doesn't fight the reader. While the list is at (or near) the bottom, `follow()`
 * keeps it there as content grows; once the user scrolls up it stops until they come back down or press "latest".
 */
export function useStickToBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);          // scrolled up: show the way back

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stuck.current = near;
    setAway(!near);
  }, []);

  const toEnd = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /** Call when content changed: scrolls only if the reader is following along. */
  const follow = useCallback(() => { if (stuck.current) toEnd(); }, [toEnd]);

  /** The reader asked for the latest (sent a message, pressed the button): follow again. */
  const jump = useCallback(() => {
    stuck.current = true;
    setAway(false);
    toEnd();
  }, [toEnd]);

  return { ref, onScroll, follow, jump, away };
}
