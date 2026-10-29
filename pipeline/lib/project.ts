// Project folders, the stage runner (hash cache) and the spend ledger with its budget cap.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, StageName, StyleFile } from "../../schemas/project.ts";
import { hash, write } from "./util.ts";

export const ROOT = process.env.PROJECTS_DIR ?? "projects";
const LEDGER = join(ROOT, "spend.jsonl");
// Total dev spend allowed across all runs (USD). The user set $5 on Oct 29.
const BUDGET = Number(process.env.BUDGET_USD ?? 5);

export const dir = (p: Project) => join(ROOT, p.id);

export function load(id: string): Project {
  return JSON.parse(readFileSync(join(ROOT, id, "project.json"), "utf8"));
}

export async function save(p: Project) {
  await write(join(dir(p), "project.json"), JSON.stringify(p, null, 2));
}

export function style(name: string): StyleFile {
  return JSON.parse(readFileSync(`styles/${name}.json`, "utf8"));
}

export function prompt(name: string): string {
  return readFileSync(`prompts/${name}.md`, "utf8");
}

export function spent(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + JSON.parse(l).usd, 0);
}

export function charge(p: Project, stage: StageName, usd: number, detail: string) {
  const row = { project: p.id, stage, usd: +usd.toFixed(5), detail, at: new Date().toISOString() };
  p.costs.push({ stage, usd: row.usd, detail, at: row.at });
  appendFileSync(LEDGER, JSON.stringify(row) + "\n");
}

export function checkBudget(estimate: number) {
  const s = spent();
  if (s + estimate > BUDGET) throw new Error(`budget: spent $${s.toFixed(2)} of $${BUDGET}, next step needs ~$${estimate}. Ask before raising BUDGET_USD.`);
}

// Runs a stage unless its inputs are unchanged since the last run. `inputs` must cover everything the stage reads.
export async function stage(p: Project, name: StageName, inputs: unknown[], estimate: number, run: () => Promise<void>, force = false) {
  const h = hash(name, ...inputs);
  if (!force && p.stages[name]?.hash === h) {
    console.log(`- ${name}: cached`);
    return;
  }
  checkBudget(estimate);
  const t0 = Date.now();
  console.log(`- ${name}: running`);
  try {
    await run();
  } catch (e: any) {
    // A failed call may still have been billed; json() attaches its cost.
    if (e.usd) charge(p, name, e.usd, `failed: ${String(e.message).slice(0, 120)}`);
    await save(p);
    throw e;
  }
  p.stages[name] = { hash: h, at: new Date().toISOString(), ms: Date.now() - t0 };
  await save(p);
  const usd = p.costs.filter((c) => c.stage === name).at(-1)?.usd ?? 0;
  console.log(`- ${name}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s, $${usd.toFixed(3)}, total spent $${spent().toFixed(2)}`);
}
