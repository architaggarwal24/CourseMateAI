// The installable app (Phase 3 Stage 4d): the service worker (public/sw.js) and the browser's install prompt.
import { create } from "zustand";

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

interface PwaState {
  /** The browser offered to install (Chrome / Edge / Android); null until then, or once used. */
  prompt: InstallPrompt | null;
  installed: boolean;
  install: () => Promise<boolean>;
}

export const usePwa = create<PwaState>()((set, get) => ({
  prompt: null,
  installed: false,
  install: async () => {
    const p = get().prompt;
    if (!p) return false;
    await p.prompt();
    const { outcome } = await p.userChoice;
    set({ prompt: null, installed: outcome === "accepted" });
    return outcome === "accepted";
  },
}));

export function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

let started = false;

/** Once per page: listen for the install prompt, and (in a production build only) register the service worker. */
export function startPwa(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  usePwa.setState({ installed: isStandalone() });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); usePwa.setState({ prompt: e as InstallPrompt }); });
  window.addEventListener("appinstalled", () => usePwa.setState({ prompt: null, installed: true }));
  if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* not fatal: the app works without it */ });
  }
}
