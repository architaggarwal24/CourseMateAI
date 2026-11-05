/** The ambient page backdrop: drifting colour blobs, a fading dot grid and film grain. Purely decorative. */
export default function Aurora({ grid = true }: { grid?: boolean }) {
  return (
    <div className="fx-aurora" aria-hidden="true">
      <span className="fx-aurora__blob fx-aurora__blob--a" />
      <span className="fx-aurora__blob fx-aurora__blob--b" />
      <span className="fx-aurora__blob fx-aurora__blob--c" />
      {grid && <span className="fx-aurora__grid" />}
      <span className="fx-grain" />
    </div>
  );
}
