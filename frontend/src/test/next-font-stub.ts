// next/font only works inside the Next compiler. In unit tests it is replaced by this stub (see vitest.config.mts).
export default function localFont() {
  return { className: "font-stub", variable: "font-stub-var", style: { fontFamily: "stub" } };
}
