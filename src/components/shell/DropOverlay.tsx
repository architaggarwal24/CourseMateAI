"use client";
// The full-screen "drop it here" layer while files are dragged over a screen that takes them (useFileDrop). It is
// drawn at the body root so it covers everything, and lets the drop through (pointer-events: none).
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileUp } from "@/components/ui/icons";
import "./drop-overlay.css";

export default function DropOverlay({ show, title, hint = "Release to upload" }: { show: boolean; title: ReactNode; hint?: ReactNode }) {
  if (!show || typeof document === "undefined") return null;
  return createPortal(
    <div role="presentation" className="drop-overlay">
      <div className="drop-overlay__card">
        <FileUp size={40} className="drop-overlay__icon" aria-hidden="true" />
        <div className="text-xl font-semibold">{title}</div>
        <div className="text-sm text-fg-muted">{hint}</div>
      </div>
    </div>,
    document.body,
  );
}
