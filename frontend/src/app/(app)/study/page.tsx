import { Suspense } from "react";
import StudyWorkspace from "@/components/shell/StudyWorkspace";

// /study?tab=<chat|quiz|notes|flashcards>[&doc=<document id>][&session=<saved session id>]. The old /study/<tab>
// paths redirect here (next.config.ts); an unknown or missing tab is the chat tab.
export default function StudyPage() {
  return (
    <Suspense fallback={null}>
      <StudyWorkspace />
    </Suspense>
  );
}
