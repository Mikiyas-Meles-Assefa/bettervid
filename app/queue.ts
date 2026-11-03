// The line of videos waiting to be made. Each entry is a real project record (project.json with the request and no
// stages yet), so it shows in the studio and survives a restart. The server makes them one at a time, behind the
// pipeline's budget cap. The line itself is a small file next to the projects: the order and whether it is paused.
// BATCH_DRY=1 only ever creates the records: nothing is started, for testing the page without spending anything.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dir, ROOT, save, spent } from "../pipeline/lib/project.ts";
import { storeMaterial, UPLOAD_LIMITS } from "../pipeline/lib/uploads.ts";
import { hash } from "../pipeline/lib/util.ts";
import type { Project } from "../schemas/project.ts";

export const DRY = process.env.BATCH_DRY === "1";
// The same cap the pipeline stops at (pipeline/lib/project.ts), so the line pauses before a run would be refused.
export const BUDGET = Number(process.env.BUDGET_USD ?? 100);
const FILE = () => join(ROOT, "queue.json");

type Line = { paused: boolean; why?: string; items: string[] };
let line: Line | undefined;

export function queue(): Line {
  if (line) return line;
  try {
    line = JSON.parse(readFileSync(FILE(), "utf8")) as Line;
  } catch {
    line = { paused: process.env.QUEUE_PAUSED === "1", items: [] };
  }
  line.items = line.items.filter((id) => existsSync(join(ROOT, id, "project.json")));
  // Starting with QUEUE_PAUSED=1 always holds the line, whatever it was left as.
  if (process.env.QUEUE_PAUSED === "1" && !line.paused) [line.paused, line.why] = [true, "Paused when the server started."];
  return line;
}
function keep() {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(FILE(), JSON.stringify(queue(), null, 2));
}

export const position = (id: string) => {
  const i = queue().items.indexOf(id);
  return i < 0 ? undefined : i + 1;
};

// A project record for a request, made the way `pipeline new` makes one, so `pipeline <id>` runs it from the start.
export async function create(input: { prompt: string; style: string; persona: string; seconds: number; staged?: string; publicSite: boolean }): Promise<Project> {
  const slug = input.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "video";
  const p: Project = {
    id: `${slug}-${hash(input.prompt, Date.now(), Math.random()).slice(0, 6)}`,
    createdAt: new Date().toISOString(),
    input: { prompt: input.prompt, style: input.style, persona: input.persona, mode: "explain", seconds: input.seconds },
    stages: {},
    costs: [],
  };
  if (input.staged) p.input.files = await storeMaterial(input.staged, dir(p), input.publicSite ? UPLOAD_LIMITS.public : UPLOAD_LIMITS.local);
  await save(p);
  return p;
}

export function enqueue(ids: string[]) {
  queue().items.push(...ids);
  keep();
}

// Takes a waiting project out of the line. One that never started is deleted, since it is only a request.
export function remove(id: string): boolean {
  const q = queue();
  if (!q.items.includes(id)) return false;
  q.items = q.items.filter((x) => x !== id);
  keep();
  try {
    const p = JSON.parse(readFileSync(join(ROOT, id, "project.json"), "utf8")) as Project;
    if (!Object.keys(p.stages).length && !p.costs.length) rmSync(join(ROOT, id), { recursive: true, force: true });
  } catch {}
  return true;
}

export function pause(paused: boolean, why?: string) {
  const q = queue();
  q.paused = paused;
  q.why = paused ? why : undefined;
  keep();
}

// The next project to make, taken off the line, or undefined when the line is paused, empty, dry or out of budget.
export function next(): string | undefined {
  const q = queue();
  if (DRY || q.paused || !q.items.length) return undefined;
  if (spent() >= BUDGET) {
    pause(true, `The budget of $${BUDGET} is used up, so the line is paused.`);
    return undefined;
  }
  const id = q.items.shift()!;
  keep();
  return id;
}

export function state() {
  const q = queue();
  return { paused: q.paused, why: q.why, dry: DRY, items: [...q.items], spent: +spent().toFixed(2), budget: BUDGET };
}
