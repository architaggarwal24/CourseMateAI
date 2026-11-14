import { Suspense } from "react";
import PlayArea from "@/components/play/PlayArea";

// /adventurer: your hero's profile (the Adventurer card, arena and study bonuses, the Hero world's settings).
export default function AdventurerPage() {
  return (
    <Suspense fallback={null}>
      <PlayArea page="adventurer" />
    </Suspense>
  );
}
