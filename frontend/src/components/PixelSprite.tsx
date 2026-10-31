"use client";

import { useEffect, useRef } from "react";
import { drawIcon } from "@/lib/avatar/render";

type Size = "xs" | "sm" | "md" | "lg";
const SCALES: Record<Size, number> = { xs: 2, sm: 3, md: 4, lg: 5 };   // 16x16 -> 32 / 48 / 64 / 80 px

interface PixelSpriteProps { itemId: string; size?: Size; className?: string }

/** An item's 16x16 icon, drawn by the shared avatar renderer. */
export default function PixelSprite({ itemId, size = "md", className = "" }: PixelSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = SCALES[size];
  const dim = 16 * scale;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawIcon(ctx, itemId, scale);
  }, [itemId, scale]);

  return <canvas ref={canvasRef} width={dim} height={dim} style={{ imageRendering: "pixelated" }} className={className} />;
}
