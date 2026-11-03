// Material: the user's files read once into part cards (engine/design/types.ts PartCard), and the requirements one
// file states about another. Code reads what code can read exactly (tables, code, text documents); a reader agent reads
// pictures; every reading is checked against its source and repaired by the reader until it checks. Everything that
// needs a model goes through a Reasoner, so it runs on Spark in production and on files answered by agents in
// development (engine/design/reasoner.ts).
import type { Answer, PartCard, Reasoner, Requirement } from "../types.ts";
import { CHECK, checkCard, type CheckSettings, type Source } from "./check.ts";
import { formatOf, pictureSize, type MaterialFile } from "./files.ts";
import { checkRequirements, linkTask, resolve, tidy } from "./link.ts";
import { cardFromPicture, pictureTask, repairTask, type PictureAnswer } from "./picture.ts";
import { parseTable, readCode, readDoc, readSections, readTable } from "./text.ts";

export { CHECK, checkCard, boxProblems, chartProblems, expectedBar, tableProblems, type CheckSettings, type Source } from "./check.ts";
export { formatOf, pictureSize, type Format, type MaterialFile } from "./files.ts";
export { cardSummary, checkRequirements, linkSchema, linkTask, LINKER_SYSTEM, resolve, tidy } from "./link.ts";
export { cardFromPicture, pictureSchema, pictureTask, READER_SYSTEM, repairTask, type PictureAnswer } from "./picture.ts";
export { numberOf, parseTable, readCode, readDoc, readSections, readTable, splitRow } from "./text.ts";
export { decodeText, expand, isPaged, probe } from "./expand.ts";
export { layoutPage, probePdf, readPdf, type Piece } from "./pdf.ts";
export { readDocx, readPptx, readXlsx, toCsv, type Extracted } from "./office.ts";
export { readZip } from "./zip.ts";

export type ReadOptions = {
  /** How many times a reading may go back to its reader to be repaired: a budget, set per project. */
  rounds: number;
  check: CheckSettings;
  /** Tables elsewhere in the project, which a chart may show. */
  tables?: Source["tables"];
};
export const READ: ReadOptions = { rounds: 3, check: CHECK };

/** Reads one file into a card. Text formats are read by code at once; a picture is asked of the reasoner and repaired
 * until it checks or the rounds run out (then the card says so in `checked`). */
export async function readMaterial(f: MaterialFile, reasoner: Reasoner, opts: Partial<ReadOptions> = {}): Promise<Answer<PartCard>> {
  const o = { ...READ, ...opts };
  const format = formatOf(f);
  if (format !== "picture") {
    const card = format === "table" ? readTable(f) : format === "code" ? readCode(f) : f.sections ? readSections(f) : readDoc(f);
    // A table's parts are its cells as parsed, so they are checked against the cells, whatever spacing the file has.
    const t = format === "table" ? parseTable(f.text ?? "") : undefined;
    const source = t ? [t.header.join(", "), ...t.rows.map((r) => r.cells.join(", ")), ...t.notes.map((n) => n.text)].join("\n") : (card.text ?? f.text ?? "");
    const problems = checkCard(card, { text: source, tables: o.tables }, o.check);
    card.checked = { ok: !problems.length, notes: problems.length ? problems : card.checked.notes };
    return { status: "answered", value: card };
  }
  const file = { ...f, size: f.size ?? (f.path ? pictureSize(f.path) : undefined) };
  let task = pictureTask(file);
  for (let round = 0; ; round++) {
    const a = await reasoner.ask<PictureAnswer>(task);
    if (a.status === "pending") return a;
    const card = cardFromPicture(file, a.value);
    const problems = checkCard(card, { tables: o.tables }, o.check);
    if (!problems.length) {
      card.checked = { ok: true, notes: [round ? `checked after ${round} repair${round > 1 ? "s" : ""}` : "checked"] };
      return { status: "answered", value: card };
    }
    if (round >= o.rounds) {
      card.checked = { ok: false, notes: problems };
      return { status: "answered", value: card };
    }
    task = repairTask(task, a.value, problems, round + 1);
  }
}

export type ProjectReading = { cards: PartCard[]; requirements: Requirement[]; pending: string[]; problems: string[] };

/** Reads every file, then links the cards into requirements. Pending tasks are listed; run again once answered. */
export async function readProject(files: MaterialFile[], reasoner: Reasoner, opts: Partial<ReadOptions> & { request?: string } = {}): Promise<ProjectReading> {
  const tables = [...(opts.tables ?? []), ...files.filter((f) => formatOf(f) === "table" && f.text).map((f) => ({ file: f.file, text: f.text! }))];
  const out: ProjectReading = { cards: [], requirements: [], pending: [], problems: [] };
  for (const f of files) {
    const a = await readMaterial(f, reasoner, { ...opts, tables: tables.filter((t) => t.file !== f.file) });
    if (a.status === "pending") out.pending.push(a.file);
    else out.cards.push(a.value);
  }
  if (out.pending.length || !out.cards.length) return out;
  const rounds = opts.rounds ?? READ.rounds;
  let task = linkTask(out.cards, opts.request);
  for (let round = 0; ; round++) {
    const a = await reasoner.ask<{ requirements: Requirement[] }>(task);
    if (a.status === "pending") {
      out.pending.push(a.file);
      return out;
    }
    const problems = checkRequirements(a.value.requirements, out.cards);
    if (!problems.length || round >= rounds) {
      out.problems.push(...problems);
      out.requirements = a.value.requirements.map((r) => tidy(r, out.cards));
      break;
    }
    task = repairTask(task, a.value, problems, round + 1);
  }
  // Each card carries the requirements about it, so a designer composing with one piece sees what is asked of it.
  for (const c of out.cards) c.requirements = out.requirements.filter((r) => r.applies && resolve(r.applies, [c]));
  return out;
}
