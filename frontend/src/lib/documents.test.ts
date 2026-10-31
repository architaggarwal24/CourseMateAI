import { describe, expect, it } from "vitest";
import { describeDocument, isInFlight, isUsable, stageIndex, stageLabel, STAGES } from "@/lib/documents";
import type { DocumentInfo } from "@/lib/api";

const doc = (status: DocumentInfo["status"], extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id: "s1", filename: "notes.pdf", file_hash: "h", status, error: null, chunks: null,
  embedding_model: null, created_at: "t", last_used_at: "t", ...extra,
});

describe("document stages", () => {
  it("lists the happy path in order", () => {
    expect(STAGES.map((s) => s.status)).toEqual(["queued", "reading", "indexing", "ready"]);
    expect(STAGES.map((s) => stageIndex(s.status))).toEqual([0, 1, 2, 3]);
  });

  it("only queued, reading and indexing are in flight", () => {
    expect((["queued", "reading", "indexing"] as const).every(isInFlight)).toBe(true);
    expect((["ready", "failed", "needs_reindex"] as const).some(isInFlight)).toBe(false);
    expect(isInFlight(undefined)).toBe(false);
  });

  it("only ready is usable", () => {
    expect(isUsable(doc("ready"))).toBe(true);
    expect(["queued", "failed", "needs_reindex"].some((s) => isUsable(doc(s as DocumentInfo["status"])))).toBe(false);
    expect(isUsable(null)).toBe(false);
  });

  it("has a label for every status", () => {
    expect(stageLabel("reading")).toBe("Reading PDF");
    expect(stageLabel("failed")).toBe("Failed");
    expect(stageLabel("needs_reindex")).toBe("Needs re-indexing");
  });

  it("describes a document in one line, using the server's error text for failures", () => {
    expect(describeDocument(doc("indexing"))).toBe("notes.pdf: indexing…");
    expect(describeDocument(doc("ready"))).toBe("notes.pdf is ready");
    expect(describeDocument(doc("failed", { error: "No readable text was found." }))).toBe("No readable text was found.");
    expect(describeDocument(doc("needs_reindex"))).toMatch(/upload it again/);
  });
});
