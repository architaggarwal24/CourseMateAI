"use client";

import { useEffect, useRef } from "react";
import { ITEM_ICON_SPRITES, blit } from "@/lib/pixelArt";

type Size = "xs" | "sm" | "md" | "lg";

const SCALES: Record<Size, number> = {
  xs:  2,   // 16×16 → 32×32
  sm:  3,   // 16×16 → 48×48
  md:  4,   // 16×16 → 64×64
  lg:  5,   // 16×16 → 80×80
};

interface PixelSpriteProps {
  itemId: string;
  size?: Size;
  className?: string;
}

export default function PixelSprite({ itemId, size = "md", className = "" }: PixelSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = SCALES[size];
  const dim = 16 * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const sprFn = ITEM_ICON_SPRITES[itemId];
    if (!sprFn) {
      // Fallback: draw a question-mark placeholder
      ctx.save();
      ctx.fillStyle = "#3A2A5A";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#8866AA";
      ctx.font = `bold ${Math.floor(dim * 0.5)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", dim / 2, dim / 2);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.scale(scale, scale);
    blit(ctx, sprFn(), 0, 0);
    ctx.restore();
  }, [itemId, scale, dim]);

  return (
    <canvas
      ref={canvasRef}
      width={dim}
      height={dim}
      style={{ imageRendering: "pixelated" }}
      className={className}
    />
  );
}