import { describe, expect, it } from "vitest";
import { citationNumber, citedFirst, linkCitations } from "./citations";
import { passageItems } from "./pdf";

const cite = (n: number) => ({ n, doc_id: "d1", doc_name: "bio.pdf", page: n, label: `bio.pdf · p.${n}`, snippet: "", text: "" });

describe("citation markers", () => {
  it("links the answer's [n] markers it has passages for, never code or a real link", () => {
    const md = "ATP is made [1][2]. See [3] and [x](http://a) and `arr[1]`.\n```\nlist[2]\n```";
    expect(linkCitations(md, 2)).toBe(
      "ATP is made [\\[1\\]](#cite-1)[\\[2\\]](#cite-2). See [3] and [x](http://a) and `arr[1]`.\n```\nlist[2]\n```");
    expect(linkCitations(md, 0)).toBe(md);
    expect([citationNumber("#cite-2"), citationNumber("http://x"), citationNumber("#cite-0")]).toEqual([2, null, null]);
  });

  it("lists the sources in the order the answer cites them, then the rest", () => {
    expect(citedFirst("B [3], then A [1] and [3].", [cite(1), cite(2), cite(3)]).map((c) => c.n)).toEqual([3, 1, 2]);
    expect(citedFirst("no markers", [cite(1), cite(2)]).map((c) => c.n)).toEqual([1, 2]);
  });
});

describe("finding the cited passage on a page", () => {
  const items = ["Chapter 2", "Cell respiration", "Mitochondria produce most of the", "cell's ATP through oxidative",
                 "phosphorylation.", "Glycolysis happens in the cytoplasm."].map((str) => ({ str }));

  it("marks the text runs of the passage, whatever the spacing, case or punctuation", () => {
    expect(passageItems(items, "mitochondria produce most of the cell’s ATP — through oxidative phosphorylation"))
      .toEqual([2, 3, 4]);
  });

  it("still finds a passage that starts or ends off the page", () => {
    const long = "Lots of words from the previous page that are not here at all and keep going for quite a while. " +
                 "Glycolysis happens in the cytoplasm.";
    expect(passageItems(items, long)).toContain(5);
  });

  it("finds nothing for a passage that isn't on the page", () => {
    expect(passageItems(items, "Covalent bonds share electron pairs between atoms")).toEqual([]);
    expect(passageItems([], "anything")).toEqual([]);
  });
});
