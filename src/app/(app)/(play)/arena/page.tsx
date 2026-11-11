import { Suspense } from "react";
import PlayArea from "@/components/hero/PlayArea";

// /arena (?doc=&topic= from the concept map, ?hunt=<species> from the Bestiary): the battle arena.
export default function ArenaPage() {
  return (
    <Suspense fallback={null}>
      <PlayArea page="arena" />
    </Suspense>
  );
}
