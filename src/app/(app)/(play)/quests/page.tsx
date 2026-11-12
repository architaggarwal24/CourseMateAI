import { Suspense } from "react";
import PlayArea from "@/components/play/PlayArea";

// /quests: today's quests and the daily chest, under the play header.
export default function QuestsPage() {
  return (
    <Suspense fallback={null}>
      <PlayArea page="quests" />
    </Suspense>
  );
}
