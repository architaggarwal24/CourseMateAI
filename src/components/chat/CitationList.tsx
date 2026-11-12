import { FileText } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { citationText, type Citation } from "@/lib/study/citations";
import "@/components/pdf/pdf.css";             // .cite-list / .cite-chip (also needed before the viewer has loaded)

/** The sources of an answer, numbered like its [n] markers. Each opens the PDF at its page, passage highlighted. */
export default function CitationList({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  if (!citations.length) return null;
  return (
    <ul aria-label="Sources" className="cite-list">
      {citations.map((c) => (
        <li key={c.n}>
          <Button size="sm" variant="ghost" className="cite-chip" onClick={() => onOpen(c)} title={c.snippet}>
            <span className="sr-only">Open source </span>
            <span className="cite-chip__n">[{c.n}]</span>
            <FileText size={12} aria-hidden="true" />
            <span>{c.label || citationText(c)}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
