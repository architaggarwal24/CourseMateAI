"use client";
import { cn } from "@/lib/utils";
import type { Look } from "@/lib/avatar/look";
import HeroFigure from "./HeroFigure";

/** The hero's head and shoulders in a round frame (the header and the profile menu). */
export default function HeroFace({ look, diameter = 48, className }: { look: Look; diameter?: number; className?: string }) {
  return (
    <span className={cn("hero-face", className)} style={{ width: diameter, height: diameter }}>
      <HeroFigure look={look} crop="face" size={diameter} withPet={false} withWeapon={false} />
    </span>
  );
}
