import { Sparkles } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import type { KitHud } from "@/lib/arena/types";

/**
 * The champion's ultimate: a meter that fills from right answers, and the button (key U) once it is full.
 * The meter is a progressbar with its value in words; "Ready" is said, not only glowed.
 */
export default function UltimateMeter({ kit, onCast, disabled, busy, compact = false }: {
  kit: KitHud | null | undefined; onCast?: () => void; disabled?: boolean; busy?: boolean; compact?: boolean;
}) {
  if (!kit) return null;
  const pct = Math.round((kit.meter / Math.max(1, kit.max)) * 100);
  const label = `Ultimate: ${kit.ultimate.name}`;
  return (
    <div className="arena-ult" data-ready={kit.ready || undefined} data-active={kit.active || undefined} data-compact={compact || undefined}>
      <div className="arena-ult__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={kit.max} aria-valuenow={kit.meter}
           aria-valuetext={kit.ready ? `${kit.ultimate.name} ready` : `${pct}% charged`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <Button size="sm" variant={kit.ready ? "reward" : "secondary"} disabled={!kit.ready || disabled || kit.active} loading={busy}
                aria-keyshortcuts="U" onClick={onCast} title={kit.ultimate.text}>
          <Sparkles size={15} aria-hidden="true" />{kit.ultimate.name}
          <span className="arena-item-count pixel-font">{kit.active ? "on" : kit.ready ? "U" : `${pct}%`}</span>
        </Button>
      )}
      {!compact && <span className="sr-only">{kit.ultimate.text}</span>}
      {!compact && kit.signature && (
        <span className="arena-ult__sig" title={kit.signature.text}>Signature weapon · {kit.signature.name}<span className="sr-only">: {kit.signature.text}</span></span>
      )}
    </div>
  );
}
