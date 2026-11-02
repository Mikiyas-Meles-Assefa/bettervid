// Has Spark write a scene, and sends every error back to it until the scene builds. No fallback: a scene that cannot be
// repaired is reported as a failure, not swapped for something lesser.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { text } from "../../pipeline/lib/meta.ts";
import { BEHAVIORS } from "../core/behaviors.ts";
import { EASES } from "../core/ease.ts";
import type { CompileContext } from "../core/types.ts";
import { build, formatProblems, type BuildOptions, type BuildResult } from "./build.ts";
import { LIMITS } from "./sandbox.ts";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");
const read = (name: string) => readFileSync(join(PROMPTS, name), "utf8");
const MAX_PROBLEMS = 25;

export type Ask = (system: string, user: string) => Promise<{ value: string; usd: number }>;
export type Round = { round: number; states: number; programs: number; problems: string[]; usd: number; chars: number; failed?: string };
export type Authored = { source: string; result: BuildResult; rounds: Round[]; usd: number; ok: boolean };
export type AuthorRequest = { topic: string; words: { text: string; start: number }[]; wishes?: string };

const list = (items: string[]) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "- none yet");

// What each motion behavior does and the settings it takes, read from the comment above it in engine/motion, so the
// guide never falls behind the code and a model does not have to guess a behavior's settings.
let motionCache: Record<string, string> | undefined;
export function motionDocs(): Record<string, string> {
  if (motionCache) return motionCache;
  const out: Record<string, string> = {};
  for (const file of ["moves.ts", "parts.ts", "effects.ts"]) {
    let src = "";
    try {
      src = readFileSync(join(PROMPTS, "..", "engine", "motion", file), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(/((?:^ {2}\/\/.*\n)+)^ {2}(\w+): /gm)) {
      const text = m[1]!.split("\n").map((l) => l.replace(/^\s*\/\/\s?/, "").trim()).filter(Boolean).join(" ");
      out[m[2]!] = `\`do ${m[2]} id key=value\`: ${text.replace(/\bargs:/, "Settings:")}`;
    }
  }
  return (motionCache = out);
}

// The language guide, filled in with what this engine can really do right now, so new abilities reach Spark by themselves.
export function languagePrompt(opts: BuildOptions): string {
  const { ctx } = opts;
  const kits = ctx.kits ?? [];
  const kinds = kits.flatMap((k) => Object.keys(k.kinds ?? {}).map((name) => ({ name, doc: k.docs?.[name] })));
  const docs: Record<string, string> = { ...motionDocs(), flow: "`do flow id color=accent frames=20`: a pulse of color runs along a line", pulse: "`do pulse id size=1.25 frames=16`: a quick grow and return", shake: "`do shake id size=14`: a short shake" };
  const behaviors = [...Object.keys(BEHAVIORS).map((name) => docs[name] ?? `\`do ${name} id\``), ...kits.flatMap((k) => Object.keys(k.behaviors ?? {}).map((name) => k.docs?.[name] ?? `\`do ${name} id\``))];
  const assets = Object.keys(opts.assets ?? {});
  const fill: Record<string, string> = {
    fps: String(ctx.fps),
    width: String(ctx.width),
    height: String(ctx.height),
    eases: Object.keys(EASES).join("|"),
    colors: Object.keys(ctx.theme.colors).join(", "),
    behaviors: list(behaviors),
    programs: list((opts.library ?? []).map((p) => `\`${p.name}\` (${Object.entries(p.params).map(([k, v]) => `${k}=${v}`).join(" ") || "no settings"}): ${p.doc}`)),
    kits: kinds.length ? `\nOther things, written as \`KIND id key=value\`, with JSON allowed in a value:\n${list(kinds.map((k) => (k.doc ? `\`${k.name}\`: ${k.doc}` : `\`${k.name}\``)))}` : "",
    assets: assets.length ? `Assets: ${assets.join(", ")}\n` : "",
    cpu: String(LIMITS.cpuMs),
    nodes: String(LIMITS.nodes),
  };
  return read("engine-language.md").replace(/\{\{(\w+)\}\}/g, (_, k: string) => fill[k] ?? "");
}

const spark: Ask = async (system, user) => {
  const r = await text({ system, user, effort: "medium", maxOutput: 32000 });
  return { value: r.value, usd: r.usd };
};

export const requestText = (r: AuthorRequest) => `Topic: ${r.topic}\n\n${r.wishes ? `${r.wishes}\n\n` : ""}Spoken words (number, seconds, word):\n${r.words.map((w, i) => `${i} ${w.start.toFixed(1)} ${w.text}`).join("\n")}`;

export function numbered(source: string): string {
  return source.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
}

export async function author(req: AuthorRequest, opts: Omit<BuildOptions, "ctx" | "words"> & { ctx: CompileContext; ask?: Ask; rounds?: number; start?: string; log?: (line: string) => void }): Promise<Authored> {
  const ask = opts.ask ?? spark;
  const log = opts.log ?? (() => {});
  const buildOpts: BuildOptions = { ...opts, words: req.words.map((w) => w.text) };
  const system = languagePrompt(buildOpts);
  const user = requestText(req);
  const rounds: Round[] = [];
  let source = "";
  let usd = 0;
  let result: BuildResult = { problems: [], stats: { states: 0, parts: 0, programs: 0, programMs: 0 } };
  let next = user;
  for (let round = 1; round <= (opts.rounds ?? 4); round++) {
    let reply: { value: string; usd: number };
    try {
      // `start` begins from an existing scene, so the loop can also repair a scene someone edited.
      reply = round === 1 && opts.start !== undefined ? { value: opts.start, usd: 0 } : await ask(system, next);
    } catch (e) {
      const spent = (e as { usd?: number }).usd ?? 0;
      usd += spent;
      rounds.push({ round, states: 0, programs: 0, problems: [], usd: spent, chars: 0, failed: (e as Error).message.slice(0, 200) });
      log(`  round ${round}: the model failed: ${(e as Error).message.slice(0, 160)}`);
      continue;
    }
    usd += reply.usd;
    source = reply.value;
    result = await build(source, buildOpts);
    const problems = result.problems.map((p) => (p.line ? `line ${p.line}: ${p.message}` : p.message));
    rounds.push({ round, states: result.stats.states, programs: result.stats.programs, problems, usd: reply.usd, chars: source.length });
    log(`  round ${round}: ${result.stats.states} states, ${result.stats.programs} programs, ${problems.length} problems, $${reply.usd.toFixed(3)}`);
    for (const p of problems.slice(0, 5)) log(`    ${p.slice(0, 180)}`);
    if (!problems.length) return { source, result, rounds, usd, ok: true };
    next = `${user}\n\nYour scene, with line numbers added for reference. Do not include the numbers:\n${numbered(source)}\n\n${read("engine-repair.md")}\nProblems:\n${formatProblems(result.problems.slice(0, MAX_PROBLEMS))}`;
  }
  return { source, result, rounds, usd, ok: false };
}
