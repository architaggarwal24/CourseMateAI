/**
 * The Hero world's loading line: four pixel blocks hopping in turn, then what is loading ("Lighting the forge").
 * Replaces the bare "Loading…" text. Under reduced motion the blocks stand still.
 */
export default function PixelLoader({ label, className }: { label: string; className?: string }) {
  return (
    <div className={`px-loader${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <span className="px-loader__blocks" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="px-loader__text">{label}</span>
    </div>
  );
}
