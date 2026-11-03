// The stage that reads the user's files, once, before anything is planned from them. Paged files are opened by code into
// text by location, tables and pictures (engine/design/material/expand.ts), and readProject reads them into cards and
// finds what one file requires of the video. Unchanged files are not read again (`key`). A file that cannot be read is
// reported by name and goes to every later stage as such; with nothing readable at all the run stops and says why.
import { join, relative } from "node:path";
import { expand, formatOf, readProject, type MaterialFile } from "../../engine/design/material/index.ts";
import type { Reasoner } from "../../engine/design/types.ts";
import type { Project } from "../../schemas/project.ts";
import { materialDir } from "../lib/uploads.ts";
import { charge, checkBudget, dir, stage } from "../lib/project.ts";
import { metaReasoner } from "../lib/reasoner-meta.ts";
import { hash } from "../lib/util.ts";

// Bump when extraction changes, so files are read again under the new rules.
const READER_VERSION = 1;

export const materialKey = (p: Project) => hash(READER_VERSION, (p.input.files ?? []).map((f) => [f.name, f.hash]), p.input.prompt);

export async function readUploads(p: Project, reasoner: Reasoner): Promise<NonNullable<Project["material"]>> {
  const folder = materialDir(dir(p));
  const files: MaterialFile[] = [];
  const problems: string[] = [];
  for (const f of p.input.files ?? []) {
    try {
      const x = expand({ name: f.name, file: f.name, path: join(folder, f.name) }, join(folder, ".extracted"));
      files.push(...x.files);
      problems.push(...x.problems.map((m) => `${f.name}: ${m}`));
    } catch (e) {
      problems.push(`${f.name}: could not be read: ${(e as Error).message}`);
    }
  }
  if (!files.length) throw new Error(`None of the files could be read. ${problems.join(" ")}`);
  const r = await readProject(files, reasoner, { request: p.input.prompt });
  if (r.pending.length) throw new Error(`material: the reader left ${r.pending.length} tasks unanswered: ${r.pending.slice(0, 3).join(", ")}`);
  for (const c of r.cards.filter((c) => !c.checked.ok)) problems.push(`${c.name}: the reading did not check against the file: ${c.checked.notes.slice(0, 2).join(" | ")}`);
  problems.push(...r.problems);
  const pictures = Object.fromEntries(files.filter((f) => formatOf(f) === "picture" && f.path).map((f) => [f.name, relative(dir(p), f.path!)]));
  return { cards: r.cards, requirements: r.requirements, problems, key: materialKey(p), uploaded: { key: materialKey(p), cards: r.cards.map((c) => c.name), problems, pictures } };
}

export async function material(p: Project, force = false, reasoner?: Reasoner) {
  const files = p.input.files ?? [];
  if (!files.length) return;
  await stage(p, "material", [materialKey(p)], 0.05 + files.length * 0.03, async () => {
    const use = reasoner ?? metaReasoner({ checkBudget: () => checkBudget(0.02), charge: (usd, detail) => charge(p, "material", usd, detail) });
    const read = await readUploads(p, use);
    p.material = read;
    for (const c of read.cards) console.log(`  ${c.name}: ${c.about}`);
    for (const x of read.problems) console.log(`  !!! ${x}`);
  }, force);
}
