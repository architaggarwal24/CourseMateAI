/** The review queue's due count on the Review nav item. Says itself in words; hidden at zero. */
export default function ReviewBadge({ due, compact = false }: { due: number; compact?: boolean }) {
  if (due <= 0) return null;
  const text = due > 99 ? "99+" : String(due);
  return (
    <span className="nav-badge" data-compact={compact || undefined} data-testid="review-badge">
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">, {due} {due === 1 ? "card" : "cards"} to review</span>
    </span>
  );
}
