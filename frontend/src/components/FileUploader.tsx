"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Upload, FileText, X, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPDF } from "@/lib/api";

interface FileUploaderProps {
  sessionId: string;
  onUploadSuccess?: (fileName: string) => void;
}

export default function FileUploader({ sessionId, onUploadSuccess }: FileUploaderProps) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPageDragging, setIsPageDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleUpload = useCallback(async (file: File) => {
    if (!user) { toast.error("Please login first to upload PDFs"); return; }
    if (file.type !== "application/pdf") { toast.error("Please upload a PDF file"); return; }
    if (file.size > 50 * 1024 * 1024) { toast.error("File too large. Maximum size is 50MB"); return; }

    setUploading(true);
    setIsPageDragging(false);
    try {
      // Use uploadPDF from api.ts — single implementation, consistent error handling and auth
      await uploadPDF(file, sessionId);
      setUploadedFile(file.name);
      toast.success(`✅ ${file.name} ready!`);
      onUploadSuccess?.(file.name);
    } catch (error: any) {
      toast.error(error.message || "Failed to upload PDF");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [sessionId, user, onUploadSuccess]);

  // ── Global window drag-and-drop ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const counter = { n: 0 };

    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      counter.n++;
      setIsPageDragging(true);
    };
    const onLeave = () => {
      counter.n--;
      if (counter.n <= 0) { counter.n = 0; setIsPageDragging(false); }
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      counter.n = 0;
      setIsPageDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleUpload(file);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [user, handleUpload]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleLocalDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleRemove = () => {
    setUploadedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      {/* Drag overlay — rendered via portal at body root for true full-screen coverage */}
      {isPageDragging && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 2147483647, // max z-index
          background: "rgba(5,5,20,0.92)",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
          border: "3px dashed #FFCC00",
          margin: 0,
          pointerEvents: "none",
        }}>
          <div style={{ textAlign: "center", color: "#FFCC00", pointerEvents: "none" }}>
            <div style={{ fontSize: 64, marginBottom: 20, lineHeight: 1 }}>📄</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, letterSpacing: 1 }}>Drop your PDF anywhere</div>
            <div style={{ fontSize: 13, opacity: 0.65 }}>Release to upload immediately</div>
          </div>
        </div>,
        document.body
      )}

      <div className="relative">
        <input
          ref={inputRef} type="file" accept=".pdf"
          onChange={handleFileChange}
          disabled={uploading || !user}
          className="hidden"
          id={`pdf-upload-${sessionId}`}
        />
        {uploadedFile ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            <CheckCircle size={15} className="shrink-0" />
            <FileText size={14} className="shrink-0 text-green-300" />
            <span className="max-w-[140px] truncate text-xs font-medium" title={uploadedFile}>{uploadedFile}</span>
            <button onClick={handleRemove} className="ml-1 p-0.5 rounded hover:bg-green-500/20 text-green-400 hover:text-red-400 transition-colors" title="Remove PDF">
              <X size={13} />
            </button>
          </div>
        ) : (
          <label
            htmlFor={`pdf-upload-${sessionId}`}
            onDrop={handleLocalDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer select-none ${
              !user ? "opacity-40 cursor-not-allowed bg-bg-card border border-border text-text-muted"
              : uploading ? "opacity-70 cursor-wait bg-accent-blue/10 border border-accent-blue text-accent-blue"
              : isDragging ? "bg-accent-gold/20 border-2 border-accent-gold text-accent-gold scale-105"
              : "hover:bg-bg-hover border border-border text-text-secondary hover:text-text-primary hover:border-accent-gold/50"
            }`}
            title={!user ? "Login to upload" : "Click or drag a PDF anywhere on page"}
          >
            <Upload size={16} className={uploading ? "animate-pulse" : isDragging ? "animate-bounce" : ""} />
            <span>{!user ? "Login to Upload" : uploading ? "Uploading..." : isDragging ? "Drop PDF here" : "Upload PDF"}</span>
          </label>
        )}
      </div>
    </>
  );
}