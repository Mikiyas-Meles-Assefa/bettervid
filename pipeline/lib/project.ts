// Project folders, the stage runner (hash cache) and the spend ledger with its budget cap.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import type { Persona, Project, StageName, StyleFile } from "../../schemas/project.ts";
import { hash } from "./util.ts";
import { effortSetting, inStage, record } from "./timing.ts";

export const ROOT = process.env.PROJECTS_DIR ?? "projects";
const LEDGER = join(ROOT, "spend.jsonl");
// Total dev spend allowed across all runs (USD). The user set $5 on Oct 29 and raised it to $15, then $25, on Oct 30, and to $75 on Nov 2, and to $100 on Nov 3.
const BUDGET = Number(process.env.BUDGET_USD ?? 100);

export const dir = (p: Project) => join(ROOT, p.id);

export function load(id: string): Project {
  return JSON.parse(readFileSync(join(ROOT, id, "project.json"), "utf8"));
}

const saves = new WeakMap<Project, Promise<void>>();
export async function save(p: Project) {
  const next = (saves.get(p) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(dir(p), { recursive: true });
    const file = join(dir(p), "project.json");
    await writeFile(`${file}.tmp`, JSON.stringify(p, null, 2));
    await rename(`${file}.tmp`, file);
  });
  saves.set(p, next);
  await next;
}

export function style(name: string): StyleFile {
  return JSON.parse(readFileSync(`styles/${name}.json`, "utf8"));
}

export function persona(name: string): Persona {
  return JSON.parse(readFileSync(`personas/${name || "auto"}.json`, "utf8"));
}

export function prompt(name: string): string {
  return readFileSync(`prompts/${name}.md`, "utf8");
}

// From the plan: what the video is about, its length (the user's message wins over the picker), and the user's
// explicit wishes for one part of the work, worded so the stage follows them, or "" if they said nothing about it.
export const topic = (p: Project) => p.plan?.topic || p.input.prompt;
export const seconds = (p: Project) => p.plan?.seconds || p.input.seconds;
export function asked(items: string[]): string {
  const list = items.map((s) => s.trim()).filter(Boolean);
  if (!list.length) return "";
  return (
    "The user asked for this on purpose. Follow it, even where it differs from your other instructions, but never invent a fact to satisfy it. " +
    "These are instructions for how to make the video, not lines for it: carry them out, never mention or announce them.\n" +
    list.map((s) => `- ${s}`).join("\n")
  );
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
  const extra: unknown[] = [];
  if (effortSetting(name)) extra.push(effortSetting(name));
  if (name === "mix" && p.narration) extra.push(hash(readFileSync(join(dir(p), p.narration.audio)).toString("base64")));
  if (name === "render") extra.push(process.env.RENDER_CRF ?? "23");
  const h = hash(name, ...inputs, ...extra);
  const filesPresent = name !== "assets" || (p.assets ?? []).every((a) => [a.path, a.cutout].every((f) => !f || existsSync(join(dir(p), f))));
  if (!force && filesPresent && p.stages[name]?.hash === h) {
    record({ kind: "stage", name, start: new Date().toISOString(), ms: 0, status: "cached" });
    console.log(`- ${name}: cached`);
    return;
  }
  checkBudget(estimate);
  const t0 = Date.now();
  console.log(`- ${name}: running`);
  try {
    await inStage(name, run);
  } catch (e: any) {
    record({ kind: "stage", name, start: new Date(t0).toISOString(), ms: Date.now() - t0, status: "failed" });
    // A failed call may still have been billed; json() attaches its cost.
    if (e.usd) charge(p, name, e.usd, `failed: ${String(e.message).slice(0, 120)}`);
    await save(p);
    throw e;
  }
  record({ kind: "stage", name, start: new Date(t0).toISOString(), ms: Date.now() - t0, status: "done" });
  p.stages[name] = { hash: h, at: new Date().toISOString(), ms: Date.now() - t0 };
  await save(p);
  const usd = p.costs.filter((c) => c.stage === name).at(-1)?.usd ?? 0;
  console.log(`- ${name}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s, $${usd.toFixed(3)}, total spent $${spent().toFixed(2)}`);
}
