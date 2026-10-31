import { Suspense } from "react";
import HeroArea from "@/components/hero/HeroArea";

// /hero?tab=<quests|arena|shop|inventory|avatar|forge|achievements>. The old /hero/<screen> paths redirect here
// (next.config.ts); an unknown or missing tab is the quests tab.
export default function HeroPage() {
  return (
    <Suspense fallback={null}>
      <HeroArea />
    </Suspense>
  );
}
