// The thing on your desk for each study tool (the unslop pass, "a desk at exam time"): a question slip for a quiz,
// index cards for flashcards, lined paper for notes, a timed paper for the mock exam, a note in the margin for the
// tutor. It replaces the same floating icon-in-a-box every tool had, so each screen says what it is at a glance.
// Flat shapes in the theme's own colours; the highlighter stroke is the one bit of colour. Decorative.

export type DeskKind = "quiz" | "flashcards" | "notes" | "exam" | "chat";


export default function DeskObject({ kind, className }: { kind: DeskKind; className?: string }) {
  return (
    <svg className={`desk-object${className ? ` ${className}` : ""}`} data-kind={kind} viewBox="0 0 72 72" width="72" height="72" aria-hidden="true" focusable="false">
      {kind === "quiz" && (
        <g>
          <rect x="10" y="8" width="52" height="58" rx="4" className="dk-paper" />
          <rect x="17" y="16" width="30" height="5" rx="1.5" className="dk-ink" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <circle cx="21" cy={31 + i * 9} r="3" className={i === 1 ? "dk-dot dk-dot--on" : "dk-dot"} />
              {i === 1 && <rect x="27" y={28 + i * 9} width="26" height="6" rx="1.5" className="dk-mark" />}
              <rect x="28" y={30 + i * 9} width={i === 2 ? 16 : 22} height="2.4" rx="1.2" className="dk-faint" />
            </g>
          ))}
        </g>
      )}
      {kind === "flashcards" && (
        <g>
          <rect x="16" y="18" width="46" height="32" rx="3" className="dk-paper" transform="rotate(-8 39 34)" />
          <rect x="10" y="26" width="48" height="34" rx="3" className="dk-paper" />
          <line x1="10" y1="34" x2="58" y2="34" className="dk-rule" />
          <rect x="17" y="40" width="26" height="6" rx="1.5" className="dk-mark" />
          <rect x="18" y="42" width="24" height="2.4" rx="1.2" className="dk-ink" />
          <rect x="18" y="50" width="32" height="2.4" rx="1.2" className="dk-faint" />
        </g>
      )}
      {kind === "notes" && (
        <g>
          <rect x="12" y="6" width="48" height="60" rx="3" className="dk-paper" />
          <line x1="22" y1="6" x2="22" y2="66" className="dk-rule dk-rule--soft" />
          {[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1="12" y1={18 + i * 8} x2="60" y2={18 + i * 8} className="dk-line" />)}
          <rect x="26" y="20" width="22" height="6" rx="1.5" className="dk-mark" />
          <rect x="27" y="22" width="20" height="2.4" rx="1.2" className="dk-ink" />
          <rect x="27" y="30" width="26" height="2.4" rx="1.2" className="dk-ink dk-ink--soft" />
          <rect x="27" y="38" width="18" height="2.4" rx="1.2" className="dk-ink dk-ink--soft" />
        </g>
      )}
      {kind === "exam" && (
        <g>
          <rect x="8" y="10" width="44" height="56" rx="3" className="dk-paper" />
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="14" y={20 + i * 8} width={i % 2 ? 22 : 30} height="2.4" rx="1.2" className={i ? "dk-faint" : "dk-ink"} />)}
          <circle cx="52" cy="22" r="13" className="dk-ring" />
          <path d="M52 14v8l5 4" className="dk-hand" />
          <rect x="14" y="56" width="20" height="6" rx="1.5" className="dk-mark" />
        </g>
      )}
      {kind === "chat" && (
        <g>
          <rect x="8" y="12" width="44" height="30" rx="6" className="dk-paper" />
          <path d="M16 42l-2 9 9-9" className="dk-paper dk-join" />
          <rect x="15" y="20" width="24" height="2.4" rx="1.2" className="dk-ink" />
          <rect x="15" y="27" width="30" height="2.4" rx="1.2" className="dk-faint" />
          <rect x="30" y="38" width="34" height="22" rx="6" className="dk-paper" />
          <rect x="35" y="44" width="16" height="6" rx="1.5" className="dk-mark" />
          <rect x="36" y="46" width="14" height="2.4" rx="1.2" className="dk-ink" />
          <rect x="36" y="52" width="22" height="2.4" rx="1.2" className="dk-faint" />
        </g>
      )}
    </svg>
  );
}
