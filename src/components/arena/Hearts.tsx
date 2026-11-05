import { Heart } from "lucide-react";

/** The player's hearts: one icon per point of HP, filled while it is left. Read as one image by a screen reader. */
export default function Hearts({ hp, max }: { hp: number; max: number }) {
  return (
    <span className="arena-hearts" role="img" aria-label={`${hp} of ${max} hearts`}>
      {Array.from({ length: max }, (_, i) => (
        <Heart key={i} size={18} aria-hidden="true" data-empty={i >= hp} fill={i < hp ? "currentColor" : "none"} strokeWidth={2} />
      ))}
    </span>
  );
}
