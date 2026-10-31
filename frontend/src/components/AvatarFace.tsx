"use client";

import { useEffect, useRef } from "react";
import { drawFace } from "@/lib/avatar/render";

interface Props {
  equipped: { headgear?: string; armor?: string; weapon?: string; pet?: string };
  items?: any[];
  diameter?: number;
  className?: string;
  skinId?: string;
  hairId?: string;
}

/** A head-and-shoulders portrait in a ring (the profile menu), drawn by the shared avatar renderer. */
export default function AvatarFace({ equipped, diameter = 40, className = "", skinId, hairId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawFace(ctx, { armorId: equipped.armor, headId: equipped.headgear, skinId, hairId }, diameter);
  }, [equipped, diameter, skinId, hairId]);

  return (
    <canvas
      ref={canvasRef}
      width={diameter}
      height={diameter}
      style={{ imageRendering: "pixelated", borderRadius: "50%", display: "block" }}
      className={className}
    />
  );
}
