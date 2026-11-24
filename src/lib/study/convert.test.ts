// Word, PowerPoint, Excel and text files read in the browser (lib/study/convert.ts): real zip archives are built
// here (stored and deflated entries), so the zip reader, the XML reading and the page splitting are all exercised.
import { describe, expect, it } from "vitest";
import { intoParts, PART_CHARS, readOtherDocument, zipEntries } from "./convert";
import { DOCUMENT_ACCEPT, formatOf, pageLabel, unsupportedReason } from "./formats";

const enc = new TextEncoder();

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } })
    .pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** A zip archive (no CRCs: the reader doesn't check them). Entries alternate stored and deflated. */
async function zip(files: Record<string, string>): Promise<ArrayBuffer> {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let i = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const method = i++ % 2 ? 8 : 0;
    const data = method === 8 ? await deflate(raw) : raw;
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30); local.set(data, 30 + n.length);
    const dir = new Uint8Array(46 + n.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(10, method, true);
    dv.setUint32(20, data.length, true); dv.setUint32(24, raw.length, true); dv.setUint16(28, n.length, true);
    dv.setUint32(42, offset, true); dir.set(n, 46);
    locals.push(local); central.push(dir);
    offset += local.length;
  }
  const dirSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const part of [...locals, ...central, end]) { out.set(part, at); at += part.length; }
  return out.buffer;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const file = (name: string) => new File(["x"], name);

describe("formats", () => {
  it("are told apart by name, with citations in each one's own words", () => {
    expect(["a.pdf", "b.DOCX", "c.pptx", "d.xlsx", "e.md", "f.csv", "g.doc", "h.png", "i.heic"].map(formatOf)).toEqual(["pdf", "docx", "pptx", "xlsx", "text", "text", null, "image", null]);
    expect(pageLabel("Board.jpg", 1)).toBe("Board.jpg · photo");
    expect(unsupportedReason("snap.heic")).toBe("snap.heic can't be read: save the photo as JPG or PNG first.");
    expect(pageLabel("Bio.pdf", 2)).toBe("Bio.pdf · p.2");
    expect(pageLabel("Cells.pptx", 4)).toBe("Cells.pptx · slide 4");
    expect(pageLabel("Notes.docx", 3)).toBe("Notes.docx · part 3");
    expect(unsupportedReason("old.ppt")).toBe("old.ppt is an old PowerPoint file. Save it as .pptx (or PDF) first.");
    expect(DOCUMENT_ACCEPT).toContain(".docx");
  });
});

describe("reading Word", () => {
  it("keeps paragraphs, marks headings and reads table rows; long text is cut into parts between paragraphs", async () => {
    const para = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${t}</w:t></w:r></w:p>`;
    const long = "Mitochondria make ATP through respiration. ".repeat(80);
    const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
      ${para("Cell biology", "Heading1")}${para("The membrane controls ")}<w:p><w:r><w:t>what</w:t></w:r><w:r><w:tab/><w:t>enters.</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc>${para("Organelle")}</w:tc><w:tc>${para("Job")}</w:tc></w:tr><w:tr><w:tc>${para("Ribosome")}</w:tc><w:tc>${para("Makes proteins")}</w:tc></w:tr></w:tbl>
      ${para(long)}${para("Genetics", "Heading2")}${para("DNA holds the code.")}</w:body></w:document>`;
    const buf = await zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": doc });
    const read = await readOtherDocument(file("Bio.docx"), buf);
    expect(read.pages[0].text).toBe("# Cell biology\nThe membrane controls\nwhat enters.\nOrganelle | Job\nRibosome | Makes proteins");
    expect(read.pages.at(-1)!.text).toBe("# Genetics\nDNA holds the code.");
    expect(read.pages.every((p) => p.text.length <= PART_CHARS)).toBe(true);
    expect(read.pages.map((p) => p.page)).toEqual(read.pages.map((_, i) => i + 1));
  });
});

describe("reading PowerPoint", () => {
  it("one page a slide, in slide order (10 after 2), with its speaker notes", async () => {
    const slide = (lines: string[]) => `<p:sld ${A}><p:cSld><p:spTree>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:spTree></p:cSld></p:sld>`;
    const buf = await zip({
      "ppt/slides/slide10.xml": slide(["Summary"]),
      "ppt/slides/slide1.xml": slide(["Photosynthesis", "Light becomes sugar"]),
      "ppt/slides/slide2.xml": slide(["Chlorophyll"]),
      "ppt/slides/_rels/slide2.xml.rels": `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>`,
      "ppt/notesSlides/notesSlide7.xml": slide(["Green pigment in chloroplasts", "2"]),
    });
    const read = await readOtherDocument(file("Plants.pptx"), buf);
    expect(read.pages.map((p) => p.text)).toEqual([
      "Slide 1\nPhotosynthesis\nLight becomes sugar",
      "Slide 2\nChlorophyll\nSpeaker notes: Green pigment in chloroplasts",
      "Slide 3\nSummary",
    ]);
  });
});

describe("reading Excel", () => {
  it("one page a sheet, named, rows as cells with shared, inline and number values; empty sheets skipped", async () => {
    const buf = await zip({
      "xl/workbook.xml": `<workbook ${S}><sheets><sheet name="Marks" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml" Type="x"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst ${S}><si><t>Name</t></si><si><t>Score</t></si><si><r><t>Asha</t></r><r><t> K</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c t="s"><v>2</v></c><c><v>91</v></c></row><row r="3"><c t="inlineStr"><is><t>Ravi</t></is></c><c t="b"><v>1</v></c></row><row r="4"/></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": `<worksheet ${S}><sheetData/></worksheet>`,
    });
    const read = await readOtherDocument(file("Marks.xlsx"), buf);
    expect(read.pages).toEqual([{ page: 1, text: "Sheet: Marks\nName | Score\nAsha K | 91\nRavi | TRUE" }]);
  });
});

describe("text files and failures", () => {
  it("text in parts; a broken file, an empty one and a file with no text say so plainly", async () => {
    const md = enc.encode("# Revision\n\nOsmosis moves water across a membrane.\n\n# Next\nDiffusion spreads particles out.").buffer;
    expect((await readOtherDocument(file("rev.md"), md)).pages[0].text).toContain("Osmosis moves water");
    await expect(readOtherDocument(file("broken.docx"), enc.encode("not a zip at all").buffer)).rejects.toMatchObject({ code: "invalid_file" });
    await expect(readOtherDocument(file("blank.txt"), enc.encode("   \n  ").buffer)).rejects.toMatchObject({ code: "no_text" });
    const noBody = await zip({ "word/document.xml": `<w:document ${W}><w:body></w:body></w:document>` });
    await expect(readOtherDocument(file("empty.docx"), noBody)).rejects.toMatchObject({ code: "no_text" });
    expect(zipEntries(noBody).has("word/document.xml")).toBe(true);
  });

  it("parts are cut between paragraphs, a heading starts a new one, and a huge paragraph is split", () => {
    expect(intoParts(["a".repeat(20), "b".repeat(20), "c".repeat(20)], 50)).toEqual([`${"a".repeat(20)}\n${"b".repeat(20)}`, "c".repeat(20)]);
    expect(intoParts(["x".repeat(20), "# New", "y"], 50)).toEqual(["x".repeat(20), "# New\ny"]);
    expect(intoParts(["z".repeat(120)], 50)).toEqual(["z".repeat(50), "z".repeat(50), "z".repeat(20)]);
  });
});
