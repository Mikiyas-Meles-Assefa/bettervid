// Has Spark write a scene, and sends every error back to it until the scene builds. No fallback: a scene that cannot be
// repaired is reported as a failure, not swapped for something lesser.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { text } from "../../pipeline/lib/meta.ts";
import { BEHAVIORS } from "../core/behaviors.ts";
import { EASES } from "../core/ease.ts";
import { ROLES, type CompileContext, type Kit } from "../core/types.ts";
import { build, formatProblems, type BuildOptions, type BuildResult } from "./build.ts";
import { LIMITS } from "./sandbox.ts";
import { parse, type Item, type State } from "./syntax.ts";

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

// What each role is for, read from the comments beside `ROLES` in engine/core/types.ts, so the guide follows the contract.
let roleCache: { name: string; doc: string }[] | undefined;
export function roleDocs(): { name: string; doc: string }[] {
  if (roleCache) return roleCache;
  const docs = new Map<string, string>();
  try {
    const src = readFileSync(join(PROMPTS, "..", "engine", "core", "types.ts"), "utf8");
    const block = /export const ROLES = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "";
    for (const m of block.matchAll(/"(\w+)",\s*\/\/\s*(.+)/g)) docs.set(m[1]!, m[2]!.trim());
  } catch {
    // the names alone still teach the roles
  }
  return (roleCache = ROLES.map((name) => ({ name, doc: docs.get(name) ?? "" })));
}

// Whether the language takes `role=` yet. The guide teaches roles once it does, and plain looks until then, so a guide
// never teaches a word the engine would refuse.
export function rolesSupported(kitKinds: Iterable<string> = []): boolean {
  return !parse(`@0\ntext a "x" role=title\nrow r role=panel\n  box b "y" role=key\n`, kitKinds).problems.length;
}

// Fills `[[roles]]...[[/roles]]` and `[[looks]]...[[/looks]]` blocks, keeping the one this engine supports, and
// `{{as ROLE|ATTRS}}`, which becomes ` role=ROLE` or ` ATTRS`.
export function withLooks(text: string, roles: boolean): string {
  return text
    .replace(/\[\[(roles|looks)\]\]\n?([\s\S]*?)\[\[\/\1\]\]\n?/g, (_, kind: string, body: string) => ((kind === "roles") === roles ? body : ""))
    .replace(/\{\{as (\w+)\|([^}]*)\}\}/g, (_, role: string, attrs: string) => (roles ? ` role=${role}` : attrs ? ` ${attrs}` : ""));
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
    roles: roleDocs().map((r) => `- \`${r.name}\`${r.doc ? `: ${r.doc}` : ""}`).join("\n"),
    truthKinds: truthKinds(kits).map((k) => `\`${k}\``).join(", ") || "none in this engine",
  };
  const roles = rolesSupported(kinds.map((k) => k.name));
  return withLooks(read("engine-language.md"), roles).replace(/\{\{(\w+)\}\}/g, (_, k: string) => fill[k] ?? "");
}

// Kinds whose kit plays computed steps: the things that work a process out for real.
export function truthKinds(kits: Kit[]): string[] {
  return kits.filter((k) => k.behaviors?.steps).flatMap((k) => Object.keys(k.kinds ?? {}));
}

// ---------------------------------------------------------------------------------------------------------------------
// Craft notes: what code can see in a scene that builds but may not show its subject at its best. They are feedback the
// writer weighs, never errors: the writer keeps a choice that serves the words.

const FORMULA = /[̀-ͯ√∑Σ∫∏²³⁴⁵⁶⁷⁸⁹⁰¹ⁿ₀₁₂₃₄₅₆₇₈₉ᵢⱼ]|\\(?:frac|sqrt|bar|sum|hat)\b|\w\^[\w(]|\w_\{?\w/;
const NUMBER = /^[−-]?\d+(?:[.,]\d+)?$/;
// A formula, not a sentence with a symbol in passing: formula signs, and few words around them.
const isFormula = (t: string) => FORMULA.test(t) && (t.match(/\p{L}{3,}/gu) ?? []).length <= 3;

type Shown = { line: number; text: string };

// Every piece of words a scene writes itself, by line: texts, shape labels, atom lines and tags.
function writtenText(items: Item[], out: Shown[] = []): Shown[] {
  for (const i of items) {
    if (i.kind === "atoms") {
      const atoms = (i.parts ?? []).flatMap((p) => (p.type === "text" ? [p.atom] : p.type === "frac" ? [...p.num, ...p.den] : p.rows.flat()));
      out.push({ line: i.line, text: atoms.map((a) => a.text).join(" ") });
    } else if (i.text && i.kind !== "code") out.push({ line: i.line, text: i.text });
    writtenText(i.children, out);
  }
  return out;
}

// Numbers a scene writes as things of their own, by id: shape labels, texts and atoms that are only a number.
type Value = { id: string; value: string };
function ownValue(i: Item): Value[] {
  if (i.kind === "atoms") return (i.parts ?? []).flatMap((p) => (p.type === "text" && NUMBER.test(p.atom.text.trim()) ? [{ id: p.atom.id, value: p.atom.text.trim() }] : []));
  return i.kind !== "code" && i.text !== undefined && NUMBER.test(i.text.trim()) ? [{ id: i.id, value: i.text.trim() }] : [];
}
// Every number in reading order.
const allValues = (items: Item[]): Value[] => items.flatMap((i) => [...ownValue(i), ...allValues(i.children)]);
// Numbers that sit side by side: the children of one arrangement, or the atoms of one line.
function valueGroups(items: Item[], out: { line: number; values: Value[] }[] = []): { line: number; values: Value[] }[] {
  for (const i of items) {
    const values = i.kind === "atoms" ? ownValue(i) : i.children.flatMap(ownValue);
    if (values.length >= 2) out.push({ line: i.line, values });
    valueGroups(i.children, out);
  }
  return out;
}

// Whether a scene puts numbers it showed into a new order by hand, either moving the same things or writing the same
// values again as new things. Returns the two lines that show it.
function reordered(states: State[]): { first: number; then: number; before: string[]; after: string[] } | undefined {
  for (let a = 0; a < states.length; a++) {
    if (states[a]!.keep) continue;
    const base = allValues(states[a]!.items);
    if (base.length < 3) continue;
    const ids = base.map((v) => v.id);
    const values = base.map((v) => v.value);
    for (const s of states.slice(a + 1)) {
      for (const g of valueGroups(s.items)) {
        const same = g.values.every((v) => ids.includes(v.id));
        // New things carrying shown values count only when each value names one thing: in a table, repeated small
        // numbers are new results, not copies.
        const once = (v: Value) => values.filter((x) => x === v.value).length === 1 && g.values.filter((x) => x.value === v.value).length === 1;
        const fresh = g.values.every((v) => !ids.includes(v.id) && once(v));
        const order = g.values.map((v) => (same ? ids.indexOf(v.id) : values.indexOf(v.value)));
        if ((same || fresh) && order.some((x, k) => k > 0 && x < order[k - 1]!)) return { first: states[a]!.line, then: g.line, before: values, after: g.values.map((v) => v.value) };
      }
    }
  }
  return undefined;
}

// Rows of a table written as separate lines outside a grid (atom lines or rows with the same number of values, or
// words split by bars or wide gaps), whose columns cannot line up. The first such run, as lines and its column count.
export function tableRows(states: State[]): { from: number; to: number; cols: number } | undefined {
  const cellsOf = (i: Item): number => {
    if (i.kind === "atoms" && (i.parts ?? []).every((p) => p.type === "text")) return i.parts!.length;
    if (i.kind === "row" && i.children.length > 1 && i.children.every((c) => c.kind === "text" || c.kind === "atoms")) return i.children.length;
    if (i.kind === "text" && i.text) {
      const bars = i.text.split("|").length;
      if (bars >= 3) return bars;
      const wide = i.text.trim().split(/\s{2,}/).length;
      if (wide >= 3) return wide;
    }
    return 0;
  };
  const look = (list: Item[], inGrid: number): { from: number; to: number; cols: number } | undefined => {
    for (let a = 0; a < list.length; a++) {
      const n = cellsOf(list[a]!);
      if (n < 2) continue;
      let b = a;
      while (b + 1 < list.length && cellsOf(list[b + 1]!) === n) b++;
      if (b - a >= 2 && inGrid !== n) return { from: list[a]!.line, to: list[b]!.line, cols: n };
      a = b;
    }
    for (const i of list) {
      const deep = look(i.children, i.kind === "grid" ? Number(i.attrs.cols ?? 2) : 0);
      if (deep) return deep;
    }
    return undefined;
  };
  for (const s of states) {
    const hit = look(s.items, 0);
    if (hit) return hit;
  }
  return undefined;
}

export function craftNotes(source: string, opts: { kitKinds?: string[]; truthKinds?: string[]; math?: boolean } = {}): string[] {
  const { doc } = parse(source, opts.kitKinds ?? []);
  const notes: string[] = [];
  const kinds = new Set(doc.states.flatMap((s) => s.items).flatMap(function all(i: Item): string[] {
    return [i.kind, ...i.children.flatMap(all)];
  }));
  // Formulas typed as characters, when real typesetting is there.
  if (opts.math) {
    const typed = new Map<string, number>();
    for (const s of doc.states) {
      for (const t of writtenText(s.items)) if (isFormula(t.text) && !typed.has(t.text)) typed.set(t.text, t.line);
      for (const c of s.commands) if (c.do === "tag" && isFormula(c.text) && !typed.has(c.text)) typed.set(c.text, c.line);
    }
    if (typed.size) {
      const shown = [...typed].slice(0, 4).map(([text, line]) => `line ${line}: "${text}"`).join("; ");
      notes.push(`These are formulas typed as characters: ${shown}. Typed marks such as a bar over a letter or a root over a fraction can drop out or sit wrong, and the symbols cannot be pointed at one by one. \`math id latex="..."\` typesets them for real. Keep characters only where it is plain words with a symbol in passing.`);
    }
  }
  // Rows of values typed as lines, when a grid would line their columns up.
  const rows = tableRows(doc.states);
  if (rows) notes.push(`Lines ${rows.from} to ${rows.to} are rows of a table written as separate lines, so their columns cannot line up and the values crowd together. Put the rows in \`grid id cols=${rows.cols}\`, one line per row: an atom line or a row with ${rows.cols} values puts each value in its own cell, the first row is the header in the style's table look, and each line's id still names its whole row (to light, tag or mark it).`);
  // Values put in a new order by hand, when a kit can work the process out.
  const truth = (opts.truthKinds ?? []).filter((k) => !kinds.has(k));
  const moved = truth.length && truth.length === (opts.truthKinds ?? []).length ? reordered(doc.states) : undefined;
  if (moved) notes.push(`The state at line ${moved.first} shows ${moved.before.join(", ")}, and line ${moved.then} puts ${moved.after.join(", ")} in a new order by hand. If a kit in your guide works this process out (${truth.map((k) => `\`${k}\``).join(", ")}), let it: every step is then right, each part can be pointed at, and \`do steps\` ties each step to the words that say it, slowly the first time and faster after. Keep the hand-made version only if no kit does what the words describe.`);
  return notes;
}

// Lines that type numbers a truth thing computes, so the writer can point at the computed parts instead.
export function typedResults(source: string, truth: NonNullable<BuildResult["truth"]>, kitKinds: string[] = []): string[] {
  const computed = new Set(truth.flatMap((t) => t.steps.join(" ").match(/[−-]?\d+(?:[.,]\d+)?/g) ?? []));
  const { doc } = parse(source, kitKinds);
  const out = new Map<number, string>();
  for (const s of doc.states) {
    const texts = [...writtenText(s.items), ...s.commands.flatMap((c) => (c.do === "tag" ? [{ line: c.line, text: c.text }] : []))];
    for (const t of texts) {
      const nums = t.text.match(/[−-]?\d+(?:[.,]\d+)?/g) ?? [];
      if (nums.length >= 2 && nums.every((n) => computed.has(n))) out.set(t.line, t.text);
    }
  }
  return [...out].map(([line, text]) => `line ${line}: "${text}"`);
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
  let aligned = false;
  let built: Authored | undefined; // the last scene that built, kept in case the alignment round breaks it
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
    if (!problems.length) {
      // Once, what code can see about the built scene goes back to the writer: the steps truth things really computed,
      // numbered, so it can bind each step to the words that speak it, and craft notes it can weigh.
      const kinds = (opts.ctx.kits ?? []).flatMap((k) => Object.keys(k.kinds ?? {}));
      const review = aligned ? "" : reviewText(source, result, { kitKinds: kinds, truthKinds: truthKinds(opts.ctx.kits ?? []), math: kinds.includes("math") });
      if (!review || round >= (opts.rounds ?? 4)) return { source, result, rounds, usd, ok: true };
      aligned = true;
      built = { source, result, rounds: [...rounds], usd, ok: true };
      next = `${user}\n\nYour scene builds. Here it is, with line numbers added for reference. Do not include the numbers:\n${numbered(source)}\n\n${review}`;
      continue;
    }
    next = `${user}\n\nYour scene, with line numbers added for reference. Do not include the numbers:\n${numbered(source)}\n\n${read("engine-repair.md")}\nProblems:\n${formatProblems(result.problems.slice(0, MAX_PROBLEMS))}`;
  }
  if (built) return { ...built, rounds, usd };
  return { source, result, rounds, usd, ok: false };
}

// The numbered steps of every truth thing in a scene, for one alignment round. With the scene's source, lines that type
// numbers the truth things compute are named, so the writer can point at the computed parts instead.
export function truthText(truth: NonNullable<BuildResult["truth"]>, source?: string, kitKinds: string[] = []): string {
  const list = truth.map((t) => `${t.kind} ${t.id}:\n${t.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`).join("\n");
  const typed = source ? typedResults(source, truth, kitKinds) : [];
  const typedNote = typed.length ? `\n\nThese lines type numbers that the truth things compute: ${typed.slice(0, 5).join("; ")}. A typed copy can disagree with what is computed and cannot follow the steps; where a line shows a result, point at the part that shows it (light, tag, mark) instead. A line that only quotes the narration's words can stay.` : "";
  return `These are the steps the truth things in your scene really compute, in order:\n${list}\n\nCheck that each \`do steps\` plays these steps on the spoken words that talk about them (at=, or from= and to= across states), and that tags, marks and lights point at the parts that show computed results rather than writing results as text yourself.${typedNote}`;
}

// What goes back to the writer once a scene builds: computed steps to bind, craft notes to weigh, or both. Empty when
// there is nothing to say. `extra` adds notes only the caller can see, such as how the part sits with its pictures.
export function reviewText(source: string, result: BuildResult, opts: { kitKinds?: string[]; truthKinds?: string[]; math?: boolean; extra?: string[] } = {}): string {
  const notes = [...craftNotes(source, opts), ...(result.notes ?? []), ...(opts.extra ?? [])];
  const parts = [
    result.truth?.length ? truthText(result.truth, source, opts.kitKinds) : "",
    notes.length ? `Notes on how the scene reads. They are not errors: act on a note where it makes the scene serve its words better, and leave the scene as it is where your choice already does:\n${notes.map((n) => `- ${n}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("\n\n")}\n\nChange only what needs it, and return the whole scene again, with no commentary.` : "";
}
