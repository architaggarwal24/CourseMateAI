import { SearchX } from "lucide-react";
import { Button } from "@/components/ui";

const GENERAL_SUGGESTIONS = ["Summarize the key concepts", "What are the main topics covered?"];
const LEADING = /^(?:please\s+)?(?:(?:what|who|when|where|why|how)\b(?:\s+(?:is|are|was|were|does|do|did|can|could|would|should|many|much))*|tell me about|explain|describe|define|can you|could you)\s+/i;

/** A rephrasing of the question that is likelier to match the document: its topic, asked openly. */
export function rephraseSuggestion(question: string): string | null {
  const topic = question.trim().replace(/[?!.\s]+$/, "").replace(LEADING, "").replace(/^(?:the|a|an)\s+/i, "").trim();
  if (!topic || topic.split(/\s+/).length > 12) return null;
  return `What does the document say about ${topic}?`;
}

/**
 * "I couldn't find that in your document": a calm note, not an error - the document simply doesn't cover the question.
 * Offers a rephrased question and two broad ones to ask instead.
 */
export default function NotFoundCard({ question, onAsk }: { question: string; onAsk: (question: string) => void }) {
  const rephrased = rephraseSuggestion(question);
  const suggestions = [...(rephrased ? [rephrased] : []), ...GENERAL_SUGGESTIONS];
  return (
    <section aria-label="Not found in your document" data-testid="not-found"
             className="study-notfound">
      <div className="flex gap-3">
        <SearchX size={20} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-base font-medium text-fg">I couldn&apos;t find that in your document</h3>
          <p className="mt-1 text-sm text-fg-2">Nothing in it matches &ldquo;{question}&rdquo;.</p>
          <p className="mt-3 text-sm text-fg-muted">Try rephrasing with words the document itself uses, or ask more broadly:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button key={s} size="sm" onClick={() => onAsk(s)} className="text-left">{s}</Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
