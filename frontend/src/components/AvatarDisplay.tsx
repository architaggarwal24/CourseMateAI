"use client";

import { useEffect, useRef } from "react";
import { drawFigure } from "@/lib/avatar/render";
import { LAYOUT } from "@/lib/avatar/sprites";

const SCALES: Record<string, number> = { xs: 2, sm: 3, md: 4, lg: 5, xl: 6 };

export interface AvatarDisplayProps {
  equipped: {
    headgear?: string; armor?: string; outfit_id?: string; weapon?: string; pet?: string; title?: string;
    skin_id?: string; hair_id?: string; body_type_id?: string; eye_color_id?: string; lip_color_id?: string;
  };
  items?: any[];
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  skinId?: string;
  hairId?: string;
}

/** The whole hero, drawn by the shared avatar renderer (lib/avatar/render.ts). */
export default function AvatarDisplay({ equipped, size = "md", className = "", skinId, hairId }: AvatarDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = SCALES[size] ?? 4;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawFigure(ctx, {
      bodyTypeId: equipped.body_type_id, skinId: skinId ?? equipped.skin_id, hairId: hairId ?? equipped.hair_id,
      eyeColorId: equipped.eye_color_id, lipColorId: equipped.lip_color_id,
      armorId: equipped.armor ?? equipped.outfit_id, headId: equipped.headgear, weaponId: equipped.weapon, petId: equipped.pet,
    }, { scale });
  }, [equipped, skinId, hairId, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={LAYOUT.CW * scale}
      height={LAYOUT.CH * scale}
      style={{
        imageRendering: "pixelated",
        display: "block",
        filter: scale >= 4 ? "drop-shadow(0px 4px 8px rgba(0,0,0,0.5)) drop-shadow(0px 1px 2px rgba(0,0,0,0.8))" : undefined,
      }}
      className={className}
    />
  );
}
