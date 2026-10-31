// Effects: pointer light, ambient backgrounds, motion text and numbers. Styles in ./fx.css (imported by app/layout).
export { default as Aurora } from "./Aurora";
export { default as Starfield } from "./Starfield";
export { default as Spotlight, type SpotlightProps } from "./Spotlight";
export { default as Magnetic } from "./Magnetic";
export { default as TiltCard, type TiltCardProps } from "./TiltCard";
export { default as AnimatedNumber } from "./AnimatedNumber";
export { default as TextReveal } from "./TextReveal";
export { usePointerVars } from "./usePointerVars";
export { mergeRefs } from "./mergeRefs";
export { reducedMotion, sparkBurst, ripple, SPRING, EASE_OUT_EXPO } from "./motion";
