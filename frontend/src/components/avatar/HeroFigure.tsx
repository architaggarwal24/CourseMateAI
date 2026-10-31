"use client";
// The hero, drawn as one SVG from the pieces in ./art: pet, cape, body, outfit, head, hat and weapon, in that order.
// One component serves every screen: the shop preview, the forge, the arena scene (with poses) and, cropped to the
// head, the header and the profile menu.
import { useId } from "react";
import { bodyOf, eyeOf, hairOf, lipOf, skinOf, type Look } from "@/lib/avatar/look";
import { cn } from "@/lib/utils";
import { Arm, CX, Face, HairBack, HairFront, Head, Legs, SHOULDER_Y, Shoes, Torso, type Expression, type Tints } from "./art/body";
import { outfitOf } from "./art/armor";
import { hatOf } from "./art/headgear";
import { petOf } from "./art/pets";
import { ArtRoot, ell } from "./art/primitives";
import { weaponOf } from "./art/weapons";
import "./avatar.css";

export type Pose = "idle" | "attack" | "hurt" | "victory" | "defeat";

export interface HeroFigureProps {
  look: Look;
  pose?: Pose;
  /** override the face (defaults to the pose's) */
  expression?: Expression;
  /** CSS size of the drawing's width, e.g. 160 or "100%" */
  size?: number | string;
  /** a gentle idle breathing; off by default (the arena turns it on) */
  animate?: boolean;
  /** show the companion pet */
  withPet?: boolean;
  /** show the weapon */
  withWeapon?: boolean;
  /** crop to the head and shoulders */
  crop?: "full" | "face";
  /** face the other way (the boss is on the left) */
  flip?: boolean;
  className?: string;
  title?: string;
}

const POSE_FACE: Record<Pose, Expression> = { idle: "idle", attack: "shout", hurt: "hurt", victory: "happy", defeat: "sad" };

// A fixed frame: a wizard hat, a flame or a dragon never gets clipped, and hero size is the same in every outfit.
const FULL_BOX = "-60 -34 320 330";
const FACE_BOX = "40 16 120 124";

export default function HeroFigure({
  look, pose = "idle", expression, size = 160, animate = false, withPet = true, withWeapon = true,
  crop = "full", flip = false, className, title,
}: HeroFigureProps) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const b = bodyOf(look.bodyTypeId);
  const tints: Tints = { skin: skinOf(look.skinId), hair: hairOf(look.hairId), eye: eyeOf(look.eyeColorId), lip: lipOf(look.lipColorId) };
  const outfit = outfitOf(look.armorId);
  const hat = hatOf(look.headId);
  const weapon = withWeapon && look.weaponId ? weaponOf(look.weaponId) : undefined;
  const pet = withPet && look.petId ? petOf(look.petId) : undefined;
  const ctx = { b, skin: tints.skin };
  const half = b.sw / 2;
  const [vx, vy, vw, vh] = (crop === "face" ? FACE_BOX : FULL_BOX).split(" ").map(Number);
  const sleeve = outfit.sleeve;

  const heldWeapon = (hand: "L" | "R") => weapon && (hand === "R" || weapon.twin) ? <g transform={`translate(0 64) rotate(${hand === "R" ? 26 : -26})`}>{weapon.draw()}</g> : null;

  return (
    <svg
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      width={size}
      height={typeof size === "number" ? (size * vh) / vw : undefined}
      className={cn("hf", className)}
      data-pose={pose}
      data-animate={animate || undefined}
      style={{ aspectRatio: `${vw} / ${vh}`, overflow: "visible", transform: flip ? "scaleX(-1)" : undefined }}
      role="img"
      aria-label={title ?? "Your hero"}
    >
      <ArtRoot id={gid}>
        {crop === "full" && <path className="hf-shadow" d={ell(CX, 272, 62, 8)} fill="#0b0618" opacity={0.35} />}

        {pet && crop === "full" && (
          <g className="hf-pet" transform={`translate(${-6 - (pet.scale - 1) * 20} ${272 - (pet.lift ?? 0)}) scale(${pet.scale * 1.15})`}>{pet.draw()}</g>
        )}

        <g className="hf-body">
          {outfit.back?.(ctx)}
          <HairBack b={b} hair={tints.hair} />

          <Legs b={b} skin={tints.skin} />
          {outfit.legs?.(ctx)}
          {!outfit.hideFeet && <Shoes b={b} color={outfit.shoes ?? "#f4f1fb"} />}
          <Torso b={b} skin={tints.skin} />
          {outfit.torso?.(ctx)}

          {/* the arm on the viewer's left */}
          <g transform={`translate(${CX - half + 5} ${SHOULDER_Y + 2})`}>
            <g className="hf-armL">
              <Arm b={b} skin={tints.skin} sleeve={sleeve} held={heldWeapon("L")} />
            </g>
          </g>
          {outfit.front?.(ctx)}

          <Head b={b} skin={tints.skin} />
          <HairFront b={b} hair={tints.hair} />
          <Face b={b} tints={tints} expression={expression ?? POSE_FACE[pose]} />
          {hat?.draw()}

          {/* the weapon arm, on top of everything */}
          <g transform={`translate(${CX + half - 5} ${SHOULDER_Y + 2})`}>
            <g className="hf-armR" data-armed={weapon ? "true" : undefined}>
              <Arm b={b} skin={tints.skin} sleeve={sleeve} held={heldWeapon("R")} />
            </g>
          </g>
        </g>
      </ArtRoot>
    </svg>
  );
}
