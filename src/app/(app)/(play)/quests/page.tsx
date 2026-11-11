import { Suspense } from "react";
import PlayArea from "@/components/hero/PlayArea";

// /quests: today's quests and the daily chest, under the play header.
export default function QuestsPage() {
  return (
    <Suspense fallback={null}>
      <PlayArea page="quests" />
    </Suspense>
  );
}
