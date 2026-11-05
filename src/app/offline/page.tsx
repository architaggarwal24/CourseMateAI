import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline · CourseMateAI" };

// What the installed app shows when there is no connection (public/sw.js caches this page).
export default function OfflinePage() {
  return (
    <main id="main-content" className="offline">
      <div className="offline__card">
        <span className="offline__icon" aria-hidden="true"><WifiOff size={28} /></span>
        <h1>You&apos;re offline</h1>
        <p>CourseMate needs a connection for your documents and AI answers. Reconnect and this page will work again.</p>
        <a className="ui-btn ui-btn--primary" href="/study">Try again</a>
      </div>
    </main>
  );
}
