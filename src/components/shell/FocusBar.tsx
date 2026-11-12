"use client";

import { useEffect, useState } from "react";
import { Coffee, Pause, Play, X } from "@/components/ui/icons";
import { toast } from "@/components/ui/Toast";
import { useFocusMode } from "@/hooks/useFocusMode";
import { useHUDStore } from "@/hooks/useHUD";
import { AMBIENTS } from "@/lib/sound/ambient";
import { clock, postFocusSession } from "@/lib/game/focus";

/**
 * Study's focus mode bar (the two worlds, Stage 6): the Pomodoro clock (25 minutes of focus, 5 of rest), pause,
 * the ambient sound, and the way out. A finished focus session charges Insight for the Hero world. The rest of the
 * frame (side panel, tab bar, hints) steps aside while it is on.
 */
export default function FocusBar() {
  const { phase, endsAt, pausedLeft, sessions, sound, togglePause, exit, setSound } = useFocusMode();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const left = pausedLeft ?? Math.max(0, (endsAt ?? now) - now);

  // the phase ran out: a focus session is counted (Insight), then the rest; after the rest, focus again
  useEffect(() => {
    if (pausedLeft !== null || endsAt === null || now < endsAt) return;
    const next = useFocusMode.getState().advance();
    if (next === "break") {
      postFocusSession()
        .then((r) => {
          void useHUDStore.getState().refresh();
          toast.success(r.counted ? `Focus session done: +20 Insight for your next fight. Rest for 5 minutes.` : "Focus session done. Rest for 5 minutes.");
        })
        .catch(() => toast.success("Focus session done. Rest for 5 minutes."));
    } else toast.info("Back to it: 25 minutes of focus.");
  }, [now, endsAt, pausedLeft]);

  // Esc leaves focus mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[aria-modal="true"]')) exit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  return (
    <section className="focusbar" aria-label="Focus mode" data-phase={phase}>
      <span className="focusbar__phase">{phase === "focus" ? "Focus" : <><Coffee size={14} aria-hidden="true" />Rest</>}</span>
      <span className="focusbar__clock num" role="timer" aria-label={`${clock(left)} of ${phase === "focus" ? "focus" : "rest"} left`}>{clock(left)}</span>
      <button type="button" className="focusbar__btn" onClick={togglePause} aria-label={pausedLeft !== null ? "Resume the clock" : "Pause the clock"}>
        {pausedLeft !== null ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
      </button>
      <span className="focusbar__count">{sessions} {sessions === 1 ? "session" : "sessions"} done</span>
      <div role="radiogroup" aria-label="Ambient sound" className="focusbar__sounds">
        {AMBIENTS.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={sound === a.id} className="focusbar__sound" onClick={() => setSound(a.id)}>{a.label}</button>
        ))}
      </div>
      <button type="button" className="focusbar__btn focusbar__exit" onClick={exit}><X size={15} aria-hidden="true" />Leave focus</button>
    </section>
  );
}
