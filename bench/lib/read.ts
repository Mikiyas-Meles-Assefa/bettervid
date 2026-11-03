// The bench's material step: every case's material read into part cards, with the requirements one file states about
// another, through the file Reasoner (engine/design/reasoner.ts). Text, tables and code are read by code at once; each
// picture and the linker are tasks for agents, written to <case folder>/read/ask/<task>.md and answered in
// <case folder>/read/answer/<task>.json. Run the step again after agents answer: readings are checked, problems go back
// to the reader as repair tasks, and once everything checks <case folder>/cards.json holds the cards and requirements.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileReasoner } from "../../engine/design/reasoner.ts";
import { readProject, type MaterialFile } from "../../engine/design/material/index.ts";
import type { PartCard, Requirement } from "../../engine/design/types.ts";
import { MATERIAL, loadCase, type Case } from "./case.ts";
import { folderOf } from "./paths.ts";

export type Cards = { cards: PartCard[]; requirements: Requirement[]; problems: string[] };

export const filesOf = (c: Case): MaterialFile[] =>
  (c.material ?? []).map((m) => ({ name: m.name, file: m.file ?? m.name, kind: m.kind, about: m.about, ...(m.text !== undefined ? { text: m.text } : {}), ...(m.size ? { size: m.size } : {}), ...(m.file ? { path: join(MATERIAL, m.file) } : {}) }));

export const cardsFile = (run: string, id: string) => join(folderOf(run, id), "cards.json");
export const loadCards = (run: string, id: string): Cards | undefined => (existsSync(cardsFile(run, id)) ? JSON.parse(readFileSync(cardsFile(run, id), "utf8")) : undefined);

export async function readCase(run: string, id: string): Promise<{ pending: string[]; cards?: Cards }> {
  const c = loadCase(id);
  const folder = folderOf(run, id);
  mkdirSync(folder, { recursive: true });
  const r = await readProject(filesOf(c), fileReasoner(join(folder, "read")), { request: c.request });
  if (r.pending.length) return { pending: r.pending };
  const cards: Cards = { cards: r.cards, requirements: r.requirements, problems: r.problems };
  writeFileSync(cardsFile(run, id), JSON.stringify(cards, null, 1));
  return { pending: [], cards };
}

export const read = async (run: string, ids: string[]) => {
  const waiting: string[] = [];
  for (const id of ids) {
    if (!loadCase(id).material?.length) continue;
    const r = await readCase(run, id);
    if (r.pending.length) {
      waiting.push(...r.pending);
      console.log(`${id}: waiting on ${r.pending.length} task${r.pending.length > 1 ? "s" : ""}`);
      continue;
    }
    const k = r.cards!;
    const bad = k.cards.filter((x) => !x.checked.ok);
    console.log(`${id}: ${cardsFile(run, id)}: ${k.cards.length} cards (${k.cards.map((x) => `${x.name} ${x.kind}, ${Object.keys(x.parts).length} parts`).join("; ")}), ${k.requirements.length} requirements${bad.length ? `; NOT CHECKED: ${bad.map((x) => `${x.name}: ${x.checked.notes.join(" | ")}`).join("; ")}` : ""}${k.problems.length ? `; linker problems: ${k.problems.join(" | ")}` : ""}`);
  }
  if (waiting.length) console.log(`\nTasks for reader agents (read each, write the answer file it names, then run read again):\n${waiting.join("\n")}`);
};
