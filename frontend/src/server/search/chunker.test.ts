/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";

describe("chunkText", () => {
  it("keeps a short page whole and skips empty ones", () => {
    expect(chunkText("  The cell is the unit of life.  ")).toEqual(["The cell is the unit of life."]);
    expect(chunkText(" \n\n ")).toEqual([]);
  });

  it("cuts long text at paragraphs first, every chunk at most 1000 characters, with overlap", () => {
    const para = (n: number) => `Paragraph ${n}. ` + "Mitochondria make ATP for the cell. ".repeat(12);
    const text = Array.from({ length: 6 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks[0].startsWith("Paragraph 0.")).toBe(true);
    expect(chunks.join(" ")).toContain("Paragraph 5.");
  });

  it("falls back to words, then characters, for text with no breaks", () => {
    const words = chunkText(Array.from({ length: 400 }, (_, i) => `word${i}`).join(" "));
    expect(words.every((c) => c.length <= 1000)).toBe(true);
    expect(words[1].split(" ")[0]).not.toBe("word0");
    const overlapStart = words[1].split(" ")[0];
    expect(words[0]).toContain(overlapStart);                        // the next chunk starts inside the previous one
    const solid = chunkText("x".repeat(2500));
    expect(solid.every((c) => c.length <= 1000)).toBe(true);
    expect(solid.join("").length).toBeGreaterThanOrEqual(2500);
  });
});
