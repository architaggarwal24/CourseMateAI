import { NOINDEX } from "@/lib/site";
import { WifiOff } from "@/components/ui/icons";

// A utility page for the installed app: never indexed.
export const metadata = { title: "Offline", robots: NOINDEX };

// What the installed app shows when there is no connection (public/sw.js caches this page).
export default function OfflinePage() {
  return (
    <main id="main-content" className="offline">
      <div className="offline__card">
        <span className="offline__icon" aria-hidden="true"><WifiOff size={28} /></span>
        <h1>You&apos;re offline</h1>
        <p>CourseMateAI needs a connection for your documents and AI answers. Reconnect and this page will work again.</p>
        <a className="ui-btn ui-btn--primary" href="/study">Try again</a>
      </div>
    </main>
  );
}
