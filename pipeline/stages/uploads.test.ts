// The user's files: what may be uploaded, where it may land, each type read with a fake reasoner, and the stage's cache.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync, deflateSync } from "node:zlib";
import { encodePng, expand, formatOf, readDocx, readPdf, readPptx, readProject, readXlsx, type MaterialFile } from "../../engine/design/material/index.ts";
import type { AgentTask, Answer, Reasoner } from "../../engine/design/types.ts";
import type { Project, Shot } from "../../schemas/project.ts";
import { materialNote, materialText, picturesText } from "../lib/material.ts";
import type { Planned } from "./director.ts";
import { freeName, inside, safeName, sizeProblem, storeMaterial, UPLOAD_LIMITS, uploadProblem } from "../lib/uploads.ts";

const temp = () => mkdtempSync(join(tmpdir(), "uploads-"));

function zip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let at = 0;
  for (const [name, body] of Object.entries(entries)) {
    const data = Buffer.from(body);
    const packed = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(at, 42);
    locals.push(local, n, packed);
    central.push(dir, n);
    at += 30 + n.length + packed.length;
  }
  const c = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, c, end]);
}

const PNG = encodePng(64, 64, 1, Buffer.alloc(64 * 64, 128), false);

const docx = () => zip({
  "word/document.xml": `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Field method</w:t></w:r></w:p><w:p><w:r><w:t>We sampled 12 ponds &amp; 3 rivers.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>site</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>count</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>north</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  "word/media/image1.png": PNG,
});
const pptx = () => zip({
  "ppt/slides/slide2.xml": `<p:sld><p:sp><p:nvPr><p:ph type="title"/></p:nvPr><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sp></p:sld>`,
  "ppt/slides/slide1.xml": `<p:sld><p:sp><p:nvPr><p:ph type="title"/></p:nvPr><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:sp><p:sp><a:p><a:r><a:t>Revenue rose 9%.</a:t></a:r></a:p></p:sp></p:sld>`,
  "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="r1" Type="http://x/relationships/image" Target="../media/image1.png"/><Relationship Id="r2" Type="http://x/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
  "ppt/notesSlides/notesSlide1.xml": `<p:notes><p:sp><p:ph type="body"/><a:p><a:r><a:t>Say this slowly.</a:t></a:r></a:p></p:sp></p:notes>`,
  "ppt/media/image1.png": PNG,
});
const xlsx = () => zip({
  "xl/workbook.xml": `<workbook><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>month</t></si><si><t>units</t></si><si><t>day</t></si></sst>`,
  "xl/styles.xml": `<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>May</t></is></c><c r="B2"><v>41</v></c><c r="D2" s="1"><v>45000</v></c></row></sheetData></worksheet>`,
});

function pdf(pages: string[], extra: string[] = [], xobjects = ""): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s) ;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Resources << /Font << /F1 3 0 R >> ${xobjects} >> >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n")];
  const push = (n: number, dict: string, stream?: Buffer) => parts.push(Buffer.from(`${n} 0 obj\n${dict}\n`), ...(stream ? [Buffer.from("stream\n"), stream, Buffer.from("\nendstream\n")] : []), Buffer.from("endobj\n"));
  objs.forEach((o, i) => push(i + 1, o));
  pages.forEach((c, i) => {
    push(4 + i * 2, `<< /Type /Page /Parent 2 0 R /Contents ${5 + i * 2} 0 R >>`);
    const z = deflateSync(Buffer.from(c));
    push(5 + i * 2, `<< /Length ${z.length} /Filter /FlateDecode >>`, z);
  });
  extra.forEach((e) => parts.push(Buffer.from(e)));
  parts.push(Buffer.from("trailer << /Root 1 0 R >>\n%%EOF\n"));
  return Buffer.concat(parts);
}

function scripted(): Reasoner & { asked: AgentTask[] } {
  const asked: AgentTask[] = [];
  return {
    asked,
    async ask<T>(t: AgentTask): Promise<Answer<T>> {
      asked.push(t);
      if (t.id.startsWith("link")) return { status: "answered", value: { requirements: [] } as T };
      return { status: "answered", value: { kind: "photo", about: "a grey square", parts: { all: { box: [0, 0, 1, 1], about: "all of it" } }, words: [] } as T };
    },
  };
}

test("names are made safe and cannot leave the folder", () => {
  assert.equal(safeName("../../etc/passwd"), "passwd");
  assert.equal(safeName("..\\..\\win.ini"), "win.ini");
  assert.equal(safeName(".env"), "env");
  assert.equal(safeName("my report (final).pdf"), "my-report-final-.pdf");
  assert.equal(safeName("..."), "file");
  assert.equal(safeName("a".repeat(300) + ".csv").length, 100);
  assert.equal(safeName("résumé.txt"), "résumé.txt");
  assert.equal(freeName("a.txt", (n) => n === "a.txt" || n === "a-2.txt"), "a-3.txt");
  assert.throws(() => inside("/tmp/x", "../y"));
  assert.throws(() => inside("/tmp/x", ".."));
  assert.equal(inside("/tmp/x", "y.txt"), "/tmp/x/y.txt");
});

test("uploads are checked for what they really are, with a clear message", () => {
  assert.equal(uploadProblem("a.png", PNG), undefined);
  assert.match(uploadProblem("a.png", Buffer.from("not a picture"))!, /does not look like/);
  assert.match(uploadProblem("a.txt", Buffer.alloc(0))!, /empty/);
  assert.match(uploadProblem("a.doc", Buffer.from("x"))!, /Save it as DOCX/);
  assert.match(uploadProblem("a.zip", Buffer.from("x"))!, /cannot be read/);
  assert.match(uploadProblem("a.svg", Buffer.from("<svg/>"))!, /PNG, JPG/);
  assert.match(uploadProblem("a.pdf", Buffer.from("hello"))!, /could not be read: it is not a PDF/);
  assert.match(uploadProblem("a.docx", Buffer.from("hello"))!, /could not be read/);
  assert.match(uploadProblem("a.dat", Buffer.from([1, 0, 2]))!, /not a text file/);
  assert.equal(uploadProblem("notes", Buffer.from("some notes")), undefined);
  assert.equal(uploadProblem("a.pdf", pdf(["BT /F1 12 Tf (Hello) Tj ET"])), undefined);
});

test("size limits say which limit was reached", () => {
  const l = UPLOAD_LIMITS.public;
  assert.match(sizeProblem("a", l.file + 1, [], l)!, /per file/);
  assert.match(sizeProblem("a", 1, Array(l.files).fill(1), l)!, /more than/);
  assert.match(sizeProblem("a", l.file, [l.total - 1], l)!, /limit for one video/);
  assert.equal(sizeProblem("a", 1, [1], l), undefined);
  assert.ok(l.file < UPLOAD_LIMITS.local.file);
});

test("files are stored only in the project's material folder, and a bad one stops with its name", () => {
  const from = temp();
  const project = temp();
  writeFileSync(join(from, "notes (1).md"), "# Notes\n\nA fact.\n");
  writeFileSync(join(from, ".hidden"), "secret");
  const files = storeMaterial(from, project);
  assert.deepEqual(files.map((f) => f.name), ["notes-1-.md"]);
  assert.ok(existsSync(join(project, "material", "notes-1-.md")));
  assert.ok(!existsSync(join(project, "material", ".hidden")));
  assert.equal(files[0]!.type, "MD");
  writeFileSync(join(from, "bad.pdf"), "nope");
  assert.throws(() => storeMaterial(from, temp()), /bad\.pdf could not be read/);
});

test("a DOCX gives text, its table as a table, and its picture", () => {
  const x = readDocx(docx());
  assert.match(x.sections[0]!.text, /# Field method/);
  assert.match(x.sections[0]!.text, /12 ponds & 3 rivers/);
  assert.deepEqual(x.tables[0]!.rows, [["site", "count"], ["north", "7"]]);
  assert.equal(x.images[0]!.ext, "png");
});

test("a PPTX gives slides in order with their numbers, notes, and pictures", () => {
  const x = readPptx(pptx());
  assert.deepEqual(x.sections.map((s) => s.where), ["slide 1", "slide 1 speaker notes", "slide 2"]);
  assert.match(x.sections[0]!.text, /# First slide/);
  assert.equal(x.images[0]!.where, "slide 1");
});

test("an XLSX gives each sheet as a table, keeping empty cells and dates", () => {
  const x = readXlsx(xlsx());
  assert.equal(x.tables[0]!.where, "sheet Sales");
  assert.deepEqual(x.tables[0]!.rows, [["month", "units", "", "day"], ["May", "41", "", "2023-03-15"]]);
});

test("a PDF gives text by page, in the page tree's order", () => {
  const x = readPdf(pdf(["BT /F1 12 Tf 72 700 Td (First line.) Tj 0 -14 Td [(Sec) -10 (ond) -300 (line.)] TJ ET", "BT /F1 12 Tf (Page \\050two\\051.) Tj ET"]));
  assert.deepEqual(x.sections, [{ where: "page 1", text: "First line.\nSecond line." }, { where: "page 2", text: "Page (two)." }]);
});

test("a PDF's simple fonts use their named encoding and its changes", () => {
  const b = Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Contents 4 0 R /Resources << /Font << /M 5 0 R /D 6 0 R >> >> >>\nendobj\n4 0 obj\n<< >>\nstream\nBT /M 9 Tf (\\322x\\323) Tj ET BT /D 9 Tf 1 0 0 1 0 5 Tm (\\001\\002\\001) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Subtype /TrueType /Encoding /MacRomanEncoding >>\nendobj\n6 0 obj\n<< /Subtype /Type1 /Encoding << /Differences [1 /H /space] >> >>\nendobj\n");
  assert.match(readPdf(b).sections[0]!.text, /^\u201Cx\u201D\s+H H$/);
});

test("a PDF font's map turns glyph codes into letters", () => {
  const cmap = deflateSync(Buffer.from("begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfchar <0001> <0048> endbfchar 1 beginbfrange <0002> <0002> <0069> endbfrange"));
  const b = Buffer.concat([
    Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"),
    Buffer.from("4 0 obj\n<< /Length 30 >>\nstream\nBT /F1 12 Tf <00010002> Tj ET  \nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >>\nendobj\n"),
    Buffer.from(`6 0 obj\n<< /Length ${cmap.length} /Filter /FlateDecode >>\nstream\n`), cmap, Buffer.from("\nendstream\nendobj\n"),
  ]);
  assert.equal(readPdf(b).sections[0]!.text, "Hi");
});

test("a scanned PDF page comes back as a picture; a page with no readable font says so", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const scan = Buffer.concat([
    Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 9 >>\nstream\n/Im0 Do  \nendstream\nendobj\n"),
    Buffer.from(`5 0 obj\n<< /Subtype /Image /Width 800 /Height 600 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream\nendobj\n"),
  ]);
  const x = readPdf(scan);
  assert.equal(x.sections.length, 0);
  assert.equal(x.images[0]!.ext, "jpg");
  assert.throws(() => readPdf(Buffer.from("%PDF-1.5\ntrailer << /Encrypt 3 0 R >>\n")), /password|encrypted/);
});

test("one file of each type reads into cards, with locations, through a fake reasoner", async () => {
  const folder = temp();
  const out: MaterialFile[] = [];
  const add = (file: string, body: string | Buffer) => {
    writeFileSync(join(folder, file), body);
    const x = expand({ name: file, file, path: join(folder, file) }, join(folder, ".extracted"));
    assert.deepEqual(x.problems, []);
    out.push(...x.files);
  };
  add("a.pdf", pdf(["BT /F1 12 Tf (A fact on the page.) Tj ET"]));
  add("b.docx", docx());
  add("c.pptx", pptx());
  add("d.xlsx", xlsx());
  add("e.txt", "A plain note.\n");
  add("f.md", "# Heading\n\nBody text here.\n");
  add("g.csv", "city,people\nOslo,5\n");
  add("h.py", "print(1)\n");
  add("i.png", PNG);
  add("j.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const r = scripted();
  const read = await readProject(out, r, { request: "x" });
  const by = Object.fromEntries(read.cards.map((c) => [c.name, c]));
  assert.equal(by["a.pdf"]!.parts["page-1.sentence.1"]!.about, "a sentence (page 1)");
  assert.ok(by["c.pptx"]!.parts["slide-1.heading.1"]);
  assert.equal(by["b.docx.table-1.csv"]!.data!.values[0], 7);
  assert.equal(by["d.xlsx.sheet-sales.csv"]!.parts["row.1"]!.text, "May, 41, , 2023-03-15");
  assert.equal(by["g.csv"]!.kind, "table");
  assert.equal(by["h.py"]!.kind, "code");
  assert.equal(by["i.png"]!.kind, "photo");
  assert.ok(by["b.docx.image-1.png"], "an embedded picture is its own card");
  assert.equal(formatOf({ name: "x", file: "b.docx.image-1.png" }), "picture");
  for (const c of read.cards) assert.ok(c.checked.ok, `${c.name}: ${c.checked.notes.join(" ")}`);
});

// The project folder is fixed when the pipeline's modules load, so every stage test shares one root.
const root = temp();
async function stageProject(id: string) {
  process.env.PROJECTS_DIR = root;
  process.env.BUDGET_USD = "1000";
  const { material, materialKey } = await import("./material.ts");
  const folder = join(root, id, "material");
  mkdirSync(folder, { recursive: true });
  const p: Project = { id, createdAt: "", input: { prompt: "make it", style: "collage", persona: "auto", mode: "explain", seconds: 0 }, stages: {}, costs: [] };
  return { p, folder, material, materialKey };
}

test("the stage reads once, caches on the files' hash, and reports what cannot be read", async () => {
  const { p, folder, material, materialKey } = await stageProject("reads");
  await material(p); // no files: nothing happens
  assert.equal(p.stages.material, undefined);
  writeFileSync(join(folder, "n.md"), "# H\n\nThe count is 9.\n");
  writeFileSync(join(folder, "bad.pdf"), "%PDF-1.5 nothing");
  writeFileSync(join(folder, "i.png"), PNG);
  p.input.files = [{ name: "n.md", type: "MD", size: 1, hash: "a" }, { name: "bad.pdf", type: "PDF", size: 1, hash: "b" }, { name: "i.png", type: "PNG", size: 1, hash: "c" }];
  const r = scripted();
  await material(p, false, r);
  const first = r.asked.length;
  assert.equal(first, 2); // the picture and the linker
  assert.equal(p.material!.key, materialKey(p));
  assert.deepEqual(p.material!.uploaded!.cards, ["n.md", "i.png"]);
  assert.match(p.material!.problems[0]!, /^bad\.pdf: could not be read/);
  assert.equal(p.material!.uploaded!.pictures["i.png"], join("material", "i.png"));
  await material(p, false, r);
  assert.equal(r.asked.length, first, "unchanged files are not read again");
  p.input.files[0]!.hash = "changed";
  await material(p, false, r);
  assert.ok(r.asked.length > first, "a changed file is read again");

  assert.match(materialText(p, 10000), /n\.md\.sentence\.1: a sentence \(line 3\) \| "The count is 9\."/);
  assert.match(materialText(p, 10000), /do not guess[\s\S]*bad\.pdf/);
  assert.match(materialNote(p), /n\.md \(document\)/);
  assert.match(picturesText(p), /i\.png \(photo\)/);
  assert.doesNotMatch(picturesText(p), /n\.md/);
});

test("a run with nothing readable stops and says why", async () => {
  const { p, folder, material } = await stageProject("nothing");
  writeFileSync(join(folder, "bad.pdf"), "nope");
  p.input.files = [{ name: "bad.pdf", type: "PDF", size: 1, hash: "b" }];
  await assert.rejects(material(p, false, scripted()), /None of the files could be read.*bad\.pdf/);
  assert.ok(readFileSync(join(root, "nothing", "project.json"), "utf8"));
});

test("a long file keeps its headings and says what is not listed", async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join("\n");
  const r = await readProject([{ name: "long.md", file: "long.md", text: `Start\n\n${lines}\n\n# Last heading\n\nEnd of it.` }], scripted());
  const p = { material: { ...r, key: "k", uploaded: { key: "k", cards: ["long.md"], problems: [], pictures: {} } } } as unknown as Project;
  const t = materialText(p, 3000);
  assert.ok(t.length < 4000);
  assert.match(t, /Last heading/);
  assert.match(t, /more parts of long\.md are not listed/);
});

test("the director's shot of the user's picture names it, and a wrong name is caught", async () => {
  process.env.PROJECTS_DIR = root;
  const { request, wrongPictures } = await import("./director.ts");
  const planned = { type: "cutout_on_paper", kind: "own", query: "i.png", focus: "the lid", prompt: "", broadQuery: "", draw: "", subject: "x" } as unknown as Planned;
  const shot = { id: "s", beatId: "b", type: "cutout_on_paper", start: 0, end: 1 } as unknown as Shot;
  assert.deepEqual(request(planned, shot), { kind: "own", query: "i.png", prompt: "", focus: "the lid" });
  assert.equal(shot.type, "photo_kenburns");
  const p = { material: { cards: [{ name: "i.png", requirements: [] }], uploaded: { cards: ["i.png"], pictures: { "i.png": "material/i.png" } } } } as unknown as Project;
  assert.deepEqual(wrongPictures(p, [planned]), []);
  assert.deepEqual(wrongPictures(p, [{ ...planned, query: "nope.png" }]), ['"nope.png"']);
});
