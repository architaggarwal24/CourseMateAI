"use client";

import { Download, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui";
import { usePwa } from "@/lib/pwa";

/** Settings -> App: install CourseMate (Chrome / Edge / Android offer it; on iPhone it's the Share sheet). */
export default function InstallApp() {
  const { prompt, installed, install } = usePwa();
  if (installed) {
    return <p className="m-0 flex items-center gap-2 text-sm text-fg-2"><MonitorSmartphone size={16} aria-hidden="true" />CourseMate is installed on this device.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="m-0 flex-1 min-w-[16rem] text-sm text-fg-2">
        {prompt
          ? "Install CourseMate as an app: its own window and icon, and it opens straight to your study."
          : "To install CourseMate, use your browser's Install app button (in the address bar), or on iPhone: Share, then Add to Home Screen."}
      </p>
      {prompt && <Button variant="primary" onClick={() => void install()}><Download size={15} aria-hidden="true" />Install app</Button>}
    </div>
  );
}
