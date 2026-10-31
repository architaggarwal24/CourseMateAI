import { FileText } from "lucide-react";

/** Where an answer came from: one chip per source, as the server names it ("lecture.pdf · p.4"). */
export default function SourceChips({ sources }: { sources: string[] | undefined }) {
  const unique = Array.from(new Set((sources ?? []).filter(Boolean)));
  if (unique.length === 0) return null;
  return (
    <ul aria-label="Sources" className="mt-3 flex flex-wrap gap-1.5 list-none p-0 m-0">
      {unique.map((source) => (
        <li key={source}
            className="source-chip">
          <FileText size={12} className="shrink-0 text-fg-muted" aria-hidden="true" />
          <span>{source}</span>
        </li>
      ))}
    </ul>
  );
}
