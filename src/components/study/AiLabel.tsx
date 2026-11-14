// "Written by AI" (legal and trust pass, BreakingBreach launch checklist 32: label AI-generated content). Quiet, one
// line, under what the AI wrote: answers, notes, flashcards. Printed with the notes too.
import { Sparkles } from "@/components/ui/icons";

export default function AiLabel({ what = "answer", className }: { what?: string; className?: string }) {
  return (
    <p className={`ai-label${className ? ` ${className}` : ""}`}>
      <Sparkles size={12} aria-hidden="true" />
      <span>AI-written {what}. Check anything important against your PDF.</span>
    </p>
  );
}
