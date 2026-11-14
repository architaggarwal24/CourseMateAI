"use client";

import { useEffect } from "react";
import { ArrowLeft, ChevronRight, HelpCircle, Settings, Sparkles, UserCircle } from "@/components/ui/icons";
import { Button, ButtonLink, Modal } from "@/components/ui";
import SoundToggle from "@/components/fx/SoundToggle";
import { usePause } from "@/hooks/usePause";
import { useHeroPrefs, type HeroPrefs } from "@/hooks/useHeroPrefs";
import { ROUTES } from "@/lib/routes";
import { lastPage } from "@/lib/worlds";
import { portalCross } from "./PortalLink";

/** Every key the Hero world answers to (the Controls page). */
export const CONTROLS: { group: string; keys: [string, string][] }[] = [
  { group: "Anywhere in the Hero world", keys: [["Esc", "Pause menu"], ["↑ ↓", "Move through the menu"], ["Ctrl K", "Search"], ["Ctrl B", "Fold the side panel"]] },
  { group: "In a fight: your move", keys: [["Q", "Strike"], ["W", "Jab"], ["E", "Heavy"], ["R", "Guard"], ["Enter / Space", "The same move again"]] },
  { group: "In a fight: the question", keys: [["1 – 4", "Answer"], ["U", "Ultimate"], ["T", "Taunt"], ["Enter", "Next, after the verdict"]] },
  { group: "Final move and Continue", keys: [["F / Enter", "Final move"], ["P", "Continue with a potion"], ["C", "Continue with coins"], ["Esc", "Give up (on Continue?)"]] },
];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * The pause menu (the two worlds, Stage 3): Esc anywhere in the Hero world. Resume, Options (sound and the Hero
 * world's switches), Controls (every key), and the portal back to Study. In a fight it pauses the clock (the arena
 * listens to it). Esc that something else used (Continue's give up, a dialog) doesn't open it.
 */
export default function PauseMenu() {
  const open = usePause((s) => s.open);
  const view = usePause((s) => s.view);
  const { show, close, setView } = usePause.getState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat || typing(e.target) || usePause.getState().open) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      // after everyone else has heard it: an Esc a screen used for itself is not a pause
      setTimeout(() => { if (!e.defaultPrevented && !document.querySelector('[aria-modal="true"]')) show(); }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  const title = view === "options" ? "Options" : view === "controls" ? "Controls" : "Paused";
  return (
    <Modal open={open} onClose={close} title={<span className="pixel-font">{title}</span>} className="pause">
      {view === "menu" && (
        <div className="pause__menu" role="group" aria-label="Pause menu">
          <Button variant="primary" block onClick={close}><ChevronRight size={16} aria-hidden="true" />Resume</Button>
          <ButtonLink block href={ROUTES.heroProfile} onClick={close}><UserCircle size={16} aria-hidden="true" />Hero profile</ButtonLink>
          <Button block onClick={() => setView("options")}><Settings size={16} aria-hidden="true" />Options</Button>
          <Button block onClick={() => setView("controls")}><HelpCircle size={16} aria-hidden="true" />Controls</Button>
          <Button variant="ghost" block onClick={() => { close(); portalCross("study", lastPage("study")); }}><Sparkles size={16} aria-hidden="true" />Return to Study</Button>
          <p className="pause__hint">A fight&apos;s clock stops while you&apos;re here.</p>
        </div>
      )}
      {view === "options" && (
        <div className="pause__options">
          <div className="pause__row"><span>Sound</span><SoundToggle /></div>
          <div className="pause__row"><span>Arena music</span><SoundToggle kind="music" /></div>
          <PauseExtras />
          <Button variant="ghost" onClick={() => setView("menu")}><ArrowLeft size={16} aria-hidden="true" />Back</Button>
        </div>
      )}
      {view === "controls" && (
        <div className="pause__controls">
          {CONTROLS.map((g) => (
            <section key={g.group} aria-label={g.group}>
              <h3 className="pause__group pixel-font">{g.group}</h3>
              <dl className="pause__keys">
                {g.keys.map(([k, what]) => <div key={k + what}><dt><kbd className="kbd">{k}</kbd></dt><dd>{what}</dd></div>)}
              </dl>
            </section>
          ))}
          <Button variant="ghost" onClick={() => setView("menu")}><ArrowLeft size={16} aria-hidden="true" />Back</Button>
        </div>
      )}
    </Modal>
  );
}

/** The Hero world's own switches (Stage 4), kept in this browser. */
export const PREF_LABELS: { key: keyof HeroPrefs; label: string; hint: string }[] = [
  { key: "cursor", label: "Pixel cursor", hint: "A pixel-art pointer in the Hero world" },
  { key: "menuSounds", label: "Menu sounds", hint: "A blip as you move through the menu" },
  { key: "lobbyMusic", label: "Lobby music", hint: "Quiet chiptune outside of fights" },
  { key: "scanlines", label: "CRT scanlines", hint: "Like an old arcade screen" },
  { key: "nudge", label: "Study reminder", hint: "After a long while here, the Scribe suggests your reviews" },
];
function PauseExtras() {
  const prefs = useHeroPrefs();
  useEffect(() => { prefs.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {PREF_LABELS.map((p) => (
        <div key={p.key} className="pause__row">
          <span><span className="block">{p.label}</span><span className="pause__row-hint">{p.hint}</span></span>
          <Switch checked={prefs[p.key]} onChange={(on) => prefs.set({ [p.key]: on })} label={p.label} />
        </div>
      ))}
    </>
  );
}

/** An on/off switch (a button with aria-pressed, like the sound switch). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" className="pause__switch" aria-pressed={checked} aria-label={label} onClick={() => onChange(!checked)} data-on={checked || undefined}>
      <span aria-hidden="true">{checked ? "ON" : "OFF"}</span>
    </button>
  );
}
