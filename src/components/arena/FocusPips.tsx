/** Focus, the resource right answers build and Heavy / spells spend: a row of pips that light up. */
export default function FocusPips({ focus, cap }: { focus: number; cap: number }) {
  return (
    <span className="arena-focus" role="img" aria-label={`Focus ${focus} of ${cap}`}>
      {Array.from({ length: cap }, (_, i) => <span key={i} className="arena-focus__pip" data-on={i < focus || undefined} />)}
    </span>
  );
}
