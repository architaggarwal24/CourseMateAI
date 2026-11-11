"use client";

import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { cn } from "@/lib/utils";
import { useChampionLook } from "./useChampionLook";
import "./champion.css";

/**
 * The player's avatar everywhere a face is shown (sidebar menu, Hero header, profile): the pixel champion's head
 * and shoulders in a round frame, wearing its skins. `withPet` adds the pet idling beside the frame.
 *
 * Accessibility: decorative by default (the menu / header say who it is in words). Pass `label` when the picture
 * is the only thing naming the champion.
 */
export default function ChampionAvatar({ size = 48, withPet = false, preview = false, label, className }: {
  size?: number; withPet?: boolean;
  /** Include the item being tried on (shop / Champion tab). */
  preview?: boolean;
  label?: string; className?: string;
}) {
  const { hero, petId, petStage } = useChampionLook({ preview });
  return (
    <span className={cn("champ-avatar", className)} data-champion={hero.id} style={{ "--champ-size": `${size}px`, "--hero-accent": hero.accent } as React.CSSProperties}>
      <span className="champ-avatar__face">
        <PixelSprite hero={hero} portrait label={label} className="champ-avatar__sprite" />
      </span>
      {withPet && petId && (
        <span className="champ-avatar__pet" data-pet={petId}>
          <PixelSprite pet={petId} petStage={petStage} className="champ-avatar__pet-sprite" />
        </span>
      )}
    </span>
  );
}
