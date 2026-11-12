"use client";

import { useEffect } from "react";
import { useHeroPrefs } from "@/hooks/useHeroPrefs";
import { music } from "@/lib/sound/chip";

/**
 * The Hero world's ambience (the two worlds, Stage 4): the lobby music (when switched on: the arena's own track
 * takes over in a fight and hands back after), and the switches the frame reads (pixel cursor, scanlines) - set as
 * attributes on the frame. Mounted only in the Hero world; leaving it stops the music.
 */
export default function HeroWorldFx() {
  const { loaded, load, lobbyMusic, cursor, scanlines } = useHeroPrefs();
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!loaded) return;
    music.background(lobbyMusic ? "lobby" : null);
    return () => music.background(null);
  }, [loaded, lobbyMusic]);
  useEffect(() => {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    shell.toggleAttribute("data-cursor", loaded && cursor);
    shell.toggleAttribute("data-scanlines", loaded && scanlines);
    return () => { shell.removeAttribute("data-cursor"); shell.removeAttribute("data-scanlines"); };
  }, [loaded, cursor, scanlines]);
  return null;
}
