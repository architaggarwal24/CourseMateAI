import type { CSSProperties, ElementType } from "react";

/**
 * Text that arrives word by word, each word rising out of a soft blur. The full sentence is the accessible name
 * (aria-label); the animated words are hidden from assistive tech.
 *
 * Plain CSS (fx.css, .fx-word), not motion/react: it starts with the first paint, so a server-rendered headline is
 * never stuck invisible while the JavaScript loads. Reduced motion shows it at once (globals.css).
 */
export default function TextReveal({ text, as: Tag = "span", className, delay = 0, stagger = 0.045 }: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  stagger?: number;
}) {
  const words = text.split(/(\s+)/);
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => /^\s+$/.test(w) ? w : (
        <span key={i} aria-hidden="true" className="fx-word"
              style={{ "--fx-delay": `${Math.round((delay + i * stagger) * 1000)}ms` } as CSSProperties}>
          {w}
        </span>
      ))}
    </Tag>
  );
}
