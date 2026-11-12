import { Suspense } from "react";
import PlayArea from "@/components/play/PlayArea";

// /bestiary: the book of creatures.
export default function BestiaryPage() {
  return (
    <Suspense fallback={null}>
      <PlayArea page="bestiary" />
    </Suspense>
  );
}
