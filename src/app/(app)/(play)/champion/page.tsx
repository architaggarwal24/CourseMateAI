import { Suspense } from "react";
import PlayArea from "@/components/play/PlayArea";

// /champion?tab=<champion|inventory|forge|shop|achievements|mastery>: your champion, gear and progress.
export default function ChampionPage() {
  return (
    <Suspense fallback={null}>
      <PlayArea page="champion" />
    </Suspense>
  );
}
