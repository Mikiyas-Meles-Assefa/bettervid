// The intent language (scripts/design-brain/intent-prompt.md): the author says what matters at each moment, never where,
// how big, what color or how it moves. Lenient: anything unclear is kept where it can be and reported as a note.
//
// Moment blocks parse inside today's scene files too: a line of today's scene language inside a moment (a `camera`, a
// `set`, a `row`, a `text` with a size, and any lines indented under it) becomes `Moment.pinned`, the strongest
// precedence (docs/DESIGN-BRAIN.md 6). A verb the engine does not know is kept as an Act with that verb and reported,
// never dropped.
import type { Act, IntentPlan, Moment, Pace, PartCard, Thing, Word } from "../types.ts";
import { SCENE_WORDS } from "../../language/syntax.ts";

export type IntentProblem = { line: number; message: string };

const quoted = (s: string) => /"([^"]*)"/.exec(s)?.[1];
const ID = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/; // a name, or a material name and one of its parts
const INTENT = new Set(["show", "keep", "compare", "ask", "reveal", "wrong", "stress", "pace", "plain"]);
// Scene-language words that are also plain English verbs an author may write about an object ("A drops into B").
const SCENE = new Set(SCENE_WORDS.filter((w) => w !== "drop"));

const newMoment = (word: number, line: number): Moment => ({ word, line, keep: [], becomes: [], from: [], arrows: [], wrong: [], stress: false, pace: "normal", acts: [], pinned: [] });

// Speed words after a verb: the author's, read as a pace. Anything else stays in `arg`.
function speedOf(rest: string): Pace | undefined {
  if (/\b(fast|quick|quickly|stream|rapid)\b/i.test(rest)) return "fast";
  if (/\b(slow|slowly|one at a time|drop by drop|one drop)\b/i.test(rest)) return "slow";
  return undefined;
}

export function parseIntent(src: string): IntentPlan {
  const notes: string[] = [];
  const things: Thing[] = [];
  const moments: Moment[] = [];
  const declared = new Map<string, Thing>();
  let feel: string | undefined;
  let audience: string | undefined;
  let cur: Moment | undefined;
  let pinIndent = -1; // indentation of the pinned line that holds the lines indented under it
  src.split(/\r?\n/).forEach((raw, i) => {
    const ln = i + 1;
    const text = raw.replace(/[“”]/g, '"').replace(/\t/g, "  ");
    const line = text.trim();
    const indent = text.length - text.trimStart().length;
    if (!line || line.startsWith("```") || line.startsWith("#") || line.startsWith("//")) return;
    if (cur && pinIndent >= 0 && indent > pinIndent) return void cur.pinned.push({ line: ln, text: line });
    pinIndent = -1;
    const at = /^@\s*(\d+)\s*(.*)$/.exec(line);
    if (at) {
      cur = newMoment(Number(at[1]), ln);
      moments.push(cur);
      // Settings on the moment line itself (today's state line, `@12 keep`) are pinned to the moment.
      if (at[2]!.trim()) cur.pinned.push({ line: ln, text: `@${at[1]} ${at[2]!.trim()}` });
      return;
    }
    const head = line.split(/\s+/)[0]!;
    const key = head.toLowerCase().replace(/:$/, "");
    const rest = line.slice(head.length).trim();
    const ids = (s: string) => s.split(/[\s,]+/).filter(Boolean).filter((x) => (ID.test(x) ? true : (notes.push(`line ${ln}: "${x}" is not an id, ignored`), false)));
    const declare = (t: Thing) => {
      if (declared.has(t.id)) notes.push(`line ${ln}: ${t.id} is declared again: the later one is used`);
      declared.set(t.id, t);
      const j = things.findIndex((x) => x.id === t.id);
      if (j >= 0) things[j] = t;
      else things.push(t);
    };
    if (key === "feel" && !cur) return void (feel = rest.split(/\s+/)[0]?.toLowerCase());
    if (key === "for" && !cur) return void (audience = rest.split(/\s+/)[0]?.toLowerCase());
    if (key === "thing") {
      const m = /^(\w+)\s*(.*)$/.exec(rest);
      if (!m) return void notes.push(`line ${ln}: thing needs an id and a text, ignored`);
      return declare({ id: m[1]!, kind: "thing", text: quoted(m[2]!) ?? (m[2]!.trim() || m[1]!), line: ln });
    }
    if (key === "object") {
      const m = /^(\w+)\s*(.*)$/.exec(rest);
      if (!m) return void notes.push(`line ${ln}: object needs an id and a description, ignored`);
      return declare({ id: m[1]!, kind: "object", desc: quoted(m[2]!) ?? (m[2]!.trim() || m[1]!), line: ln });
    }
    if (key === "many") {
      const m = /^(\w+)\s+(\d+)\s*(.*)$/.exec(rest);
      if (!m) return void notes.push(`line ${ln}: many needs an id, a count and a unit, ignored`);
      return declare({ id: m[1]!, kind: "many", many: { n: Math.max(1, Number(m[2])), unit: quoted(m[3]!) ?? (m[3]!.trim() || m[1]!) }, line: ln });
    }
    if (!cur) return void notes.push(`line ${ln}: "${line}" comes before the first moment, kept out of the plan`);
    if (SCENE.has(key) && !INTENT.has(key) && !/^[\w.]+\s*->/.test(line) && !/\s+(becomes|from)\s+/.test(line)) {
      // Today's scene language: pinned to this moment, with any lines indented under it.
      cur.pinned.push({ line: ln, text: line });
      pinIndent = indent;
      return;
    }
    if (key === "show") {
      const [first, ...more] = ids(rest);
      if (!first) return void notes.push(`line ${ln}: show needs an id`);
      if (cur.show && cur.show !== first) (notes.push(`line ${ln}: a second show in @${cur.word}: "${first}" is kept as support`), cur.keep.push(first));
      else cur.show = first;
      if (more.length) (notes.push(`line ${ln}: show takes one id: ${more.join(", ")} kept as support`), cur.keep.push(...more));
      return;
    }
    if (key === "keep") return void cur.keep.push(...ids(rest));
    if (key === "compare") {
      const [a, b] = ids(rest);
      if (a && b) cur.compare = [a, b];
      else notes.push(`line ${ln}: compare needs two ids, ignored`);
      return;
    }
    if (key === "reveal") return void (cur.reveal = ids(rest)[0] ?? cur.reveal);
    if (key === "wrong") return void cur.wrong.push(...ids(rest));
    if (key === "stress") return void (cur.stress = true);
    if (key === "plain") return void (cur.plain = true);
    if (key === "pace") {
      const p = rest.toLowerCase();
      if (p === "slow" || p === "normal" || p === "fast") cur.pace = p;
      else notes.push(`line ${ln}: pace "${rest}" is not slow, normal or fast, ignored`);
      return;
    }
    if (key === "ask") return void (cur.ask = quoted(rest) ?? (rest || undefined));
    const act = (a: Omit<Act, "line">) => cur!.acts.push({ ...a, line: ln });
    const arg = (t: string | undefined) => (t === undefined ? undefined : quoted(t) ?? (t.trim() || undefined));
    let m: RegExpExecArray | null;
    if ((m = /^([\w.]+)\s+(drips|pours|flows|drains|drops|leaks|trickles)\s+(?:into|onto|in)\s+([\w.]+)\s*(.*)$/i.exec(line))) act({ verb: "flows", ids: [m[1]!], to: m[3]!, arg: m[2]!.toLowerCase(), speed: speedOf(m[4]!) ?? (/pours|flows/i.test(m[2]!) ? "fast" : undefined) });
    else if ((m = /^([\w.]+)\s+(turns|changes to|goes)\s+(.*)$/i.exec(line))) act({ verb: "turns", ids: [m[1]!], arg: arg(m[3]), speed: speedOf(m[3]!) });
    else if ((m = /^([\w.]+)\s+(flashes|blushes|glows)\s*(.*)$/i.exec(line))) act({ verb: "flashes", ids: [m[1]!], arg: arg(m[3]) });
    else if ((m = /^([\w.]+)\s+(swirls|shakes|spins|rocks|wobbles|stirs)\b\s*(.*)$/i.exec(line))) act({ verb: "sways", ids: [m[1]!], arg: m[2]!.toLowerCase(), speed: speedOf(m[3]!) });
    else if ((m = /^((?:[\w.]+\s+)+?)(falls?|drops?)\b\s*(together)?\s*(.*)$/i.exec(line))) act({ verb: "falls", ids: m[1]!.trim().split(/\s+/), speed: speedOf(m[4]!), arg: arg(m[4]) });
    else if ((m = /^([\w.]+)\s+(fills|empties|rises|drains)\s*(.*)$/i.exec(line))) act({ verb: "fills", ids: [m[1]!], arg: /empties|drains/i.test(m[2]!) ? "0%" : arg(m[3]) });
    else if ((m = /^([\w.]+)\s+reads\s*(.*)$/i.exec(line))) act({ verb: "reads", ids: [m[1]!], arg: arg(m[2]) });
    else if ((m = /^([\w.]+)\s+(runs|counts|ticks)\s*(.*)$/i.exec(line))) act({ verb: "runs", ids: [m[1]!], arg: arg(m[3]) });
    else if ((m = /^([\w.]+)\s+moves\s+to\s+([\w.]+)\s*(.*)$/i.exec(line))) act({ verb: "moves", ids: [m[1]!], to: m[2]!, speed: speedOf(m[3]!) });
    else if ((m = /^(\w+)\s+becomes\s+(.*)$/i.exec(line)) && declared.get(m[1]!)?.kind === "object") act({ verb: "turns", ids: [m[1]!], arg: arg(m[2]) });
    else if ((m = /^([\w.]+)\s+becomes\s+(.*)$/i.exec(line))) {
      const v = m[2]!.trim();
      if (/^\d+(\.\d+)?$/.test(v)) cur.becomes.push({ id: m[1]!, n: Number(v) });
      else cur.becomes.push({ id: m[1]!, text: quoted(v) ?? v });
    } else if ((m = /^([\w.]+)\s+from\s+([\w.]+)\s*$/i.exec(line))) cur.from.push({ a: m[1]!, b: m[2]! });
    else if ((m = /^([\w.]+)\s*->\s*([\w.]+)\s*(.*)$/.exec(line))) cur.arrows.push({ a: m[1]!, b: m[2]!, label: quoted(m[3]!) ?? "" });
    else {
      // A verb the engine does not know: kept with the author's words, so an agent or a later ability can act on it.
      const toks = line.split(/\s+/);
      const first = toks[0]!;
      const subj = ID.test(first) && toks.length > 1 ? first : undefined;
      const verb = (subj ? toks[1]! : first).toLowerCase();
      const others = toks.slice(subj ? 2 : 1).filter((t) => declared.has(t) || /\./.test(t));
      act({ verb, ids: subj ? [subj, ...others] : others, arg: quoted(line) ?? (toks.slice(subj ? 2 : 1).join(" ") || undefined) });
      notes.push(`line ${ln}: "${verb}" is not a verb the engine knows: kept as an act and reported`);
    }
  });
  return { feel, audience, things, moments, notes };
}

// Every id a moment names, with where it is named (for the author repair loop and the composer).
export function idsOf(m: Moment): string[] {
  return [m.show, ...m.keep, ...m.becomes.map((b) => b.id), ...m.from.flatMap((f) => [f.a, f.b]), ...(m.compare ?? []), ...m.arrows.flatMap((a) => [a.a, a.b]), m.reveal, ...m.wrong, ...m.acts.flatMap((a) => [...a.ids, ...(a.to ? [a.to] : [])])].filter((x): x is string => !!x);
}

export const KNOWN_VERBS = ["flows", "turns", "flashes", "sways", "falls", "fills", "reads", "runs", "moves"];

// Problems an author can repair, each with its line: word numbers that are not words or go backwards, ids that were never
// declared and are not the user's material, material parts that do not exist, moments with nothing to look at, verbs the
// engine does not know, a picture asked to become something else.
export function checkIntent(plan: IntentPlan, words: Word[], material: PartCard[] = []): IntentProblem[] {
  const out: IntentProblem[] = [];
  const things = new Map(plan.things.map((t) => [t.id, t]));
  const cards = new Map(material.map((c) => [c.name, c]));
  let last = -1;
  if (!plan.moments.length) out.push({ line: 1, message: "The plan has no moments. Start one with @N on a spoken word." });
  for (const m of plan.moments) {
    if (m.word < 0 || m.word >= words.length) out.push({ line: m.line, message: `@${m.word} is not a word of the narration (0 to ${words.length - 1}).` });
    else if (m.word <= last) out.push({ line: m.line, message: `@${m.word} comes after @${last}: moments must go up.` });
    last = Math.max(last, m.word);
    if (!m.show && !m.reveal) out.push({ line: m.line, message: `@${m.word} has no show: say the one thing the eye must be on${m.ask ? " while the question stands" : ""}.` });
    for (const id of new Set(idsOf(m))) {
      const [name, part] = id.split(".");
      const card = cards.get(name!);
      if (card) {
        if (part && !card.parts[part] && !card.data?.texts?.[part]) out.push({ line: m.line, message: `@${m.word}: ${name} has no part "${part}". Its parts: ${Object.keys(card.parts).join(", ")}.` });
      } else if (part) out.push({ line: m.line, message: `@${m.word}: "${id}" names a part of "${name}", which is not the user's material.` });
      else if (!things.has(id)) out.push({ line: m.line, message: `@${m.word}: "${id}" was never declared. Declare it with thing, many or object before the first moment.` });
    }
    for (const b of m.becomes) if (cards.has(b.id.split(".")[0]!)) out.push({ line: m.line, message: `@${m.word}: ${b.id} is the user's material and cannot become something else.` });
    for (const b of m.becomes) if (things.get(b.id)?.kind === "many" && b.n === undefined) out.push({ line: m.line, message: `@${m.word}: ${b.id} is a many thing: it becomes a count, as in ${b.id} becomes 12.` });
    for (const a of m.acts) if (!KNOWN_VERBS.includes(a.verb)) out.push({ line: a.line, message: `"${a.verb}" is not a verb the engine knows. Use the nearest of: drips into, pours into, turns, flashes, swirls, falls, fills, reads, runs, moves to.` });
    for (const a of m.acts) for (const id of a.ids) if (things.has(id) && things.get(id)!.kind !== "object" && a.verb !== "moves") out.push({ line: a.line, message: `${id} ${a.verb}: only an object can ${a.verb}; declare ${id} as an object.` });
  }
  return out;
}
