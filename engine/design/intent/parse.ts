// The intent language (prompts/intent.md): the author says what matters at each moment, never where,
// how big, what color or how it moves. Lenient: anything unclear is kept where it can be and reported as a note.
//
// Moment blocks parse inside today's scene files too: a line of today's scene language inside a moment (a `camera`, a
// `set`, a `row`, a `text` with a size, and any lines indented under it) becomes `Moment.pinned`, the strongest
// precedence (docs/DESIGN-BRAIN.md 6). A verb the engine does not know is kept as an Act with that verb and reported,
// never dropped; verbs are open (the depicter maps each onto what the thing can do).
//
// A pinned line may also make a thing a kit computes (a line that starts with a kind the scene language's kits make: a
// sort, a graph, a formula). Its id, and every dotted part of it, is then a name the rest of the plan may show, keep or
// reveal, in any moment.
import type { Act, IntentPlan, Moment, Pace, PartCard, Relation, RelationKind, Thing, Word } from "../types.ts";
import { kindsOf } from "../../kits/index.ts";
import { SCENE_WORDS } from "../../language/syntax.ts";

export type IntentProblem = { line: number; message: string };

const quoted = (s: string) => /"([^"]*)"/.exec(s)?.[1];
// A name: letters (any script), digits, underscores and inner hyphens, as a reader agent names a part ("bar-asphalt");
// a hyphen never starts or ends a name, so "a->b" still reads as an arrow. A material part is the card's name, a dot
// and the part's name; a part of a computed thing may go deeper (its id, then the kit's own part path).
const NAME = String.raw`[\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?`;
const REF = `${NAME}(?:\\.${NAME})*`;
const ID = new RegExp(`^${REF}$`, "u"); // a name, or a name and one of its parts
const PART = new RegExp(`^${NAME}(?:\\.${NAME})+$`, "u");
const re = (src: string, flags = "") => new RegExp(src.replaceAll("NAME", NAME).replaceAll("REF", REF), `u${flags}`);
const DECL = re(String.raw`^(NAME)\s*(.*)$`);
const MANY = re(String.raw`^(NAME)\s+(\d+)\s*(.*)$`);
const BECOMES = re(String.raw`^(REF)\s+becomes\s+(.*)$`, "i");
const FROM = re(String.raw`^(REF)\s+from\s+(REF)\s*$`, "i");
const ARROW = re(String.raw`^(REF)\s*->\s*(REF)\s*(.*)$`);
const ARROW_START = re(String.raw`^REF\s*->`);
const INTENT = new Set(["show", "keep", "compare", "ask", "reveal", "wrong", "stress", "pace", "plain"]);
// Scene-language words that are also plain English verbs an author may write about an object ("A drops into B").
const SCENE = new Set(SCENE_WORDS.filter((w) => w !== "drop"));

/** The first word of a line of the scene language and the id after it (a graph's id ends at its colon). */
export const idLine = (text: string): [string | undefined, string | undefined] => {
  const [head, id] = text.split(/\s+/);
  return [head, id?.replace(/:.*$/, "")];
};

/** A thing a pinned line makes with a kit: its id, its kind, the line, and the moment (by index in the plan) that pins it. */
export type Computed = { id: string; kind: string; line: number; moment: number; text: string };

/**
 * The things the plan's pinned lines make with a kit, by id (the first line that makes each). `kinds` are the kinds the
 * scene language's kits make (engine/kits); nothing here names one.
 */
export function computedOf(plan: Pick<IntentPlan, "moments">, kinds: Iterable<string> = kindsOf()): Map<string, Computed> {
  const known = new Set(kinds);
  const out = new Map<string, Computed>();
  plan.moments.forEach((m, i) => {
    for (const p of m.pinned) {
      const [head, id] = idLine(p.text);
      if (head && id && known.has(head) && ID.test(id) && !id.includes(".") && !out.has(id)) out.set(id, { id, kind: head, line: p.line, moment: i, text: p.text });
    }
  });
  return out;
}

/** The computed things a moment's pinned lines make or play (`do steps demo1 ...`), by id. */
export function computedIn(m: Moment, computed: Map<string, Computed>): string[] {
  const out = new Set<string>();
  for (const p of m.pinned) {
    const [head, id] = idLine(p.text);
    const named = head === "do" ? p.text.split(/\s+/).slice(2).filter((t) => !t.includes("=")) : id ? [id] : [];
    for (const t of named) if (computed.has(t.split(".")[0]!)) out.add(t.split(".")[0]!);
  }
  return [...out];
}

const newMoment = (word: number, line: number): Moment => ({ word, line, keep: [], becomes: [], from: [], arrows: [], wrong: [], stress: false, pace: "normal", acts: [], pinned: [] });

// Speed words after a verb: the author's, read as a pace. Anything else stays in `arg`.
const FAST = /\b(fast|quick|quickly|rapid|rapidly)\b/i;
const SLOW = /\b(slow|slowly|one at a time|bit by bit|little by little)\b/i;
function speedOf(rest: string): Pace | undefined {
  if (FAST.test(rest)) return "fast";
  if (SLOW.test(rest)) return "slow";
  return undefined;
}

// Particles that belong to a verb ("drips into", "moves to", "lights up"): grammar, not a list of verbs.
const PARTICLES = new Set(["into", "onto", "in", "on", "to", "toward", "towards", "out", "up", "down", "over", "off", "through", "away", "back", "across", "around", "under", "from", "at", "along", "by", "with"]);
// Words that say how, not what: kept out of the argument.
const FILLER = new Set(["together", "again", "then", "now", "all", "both"]);

/**
 * An act line: one or more things, the author's verb (with its particles), an optional other thing, then a quoted
 * argument or a value. "A drips into B fast", "A B fall", "A turns "faint green"", "A runs 30 s", "A moves to B".
 */
export function readAct(line: string, isThing: (t: string) => boolean): Omit<Act, "line"> | undefined {
  const q = quoted(line);
  const toks = line.replace(/"[^"]*"/g, " ").trim().split(/\s+/).filter(Boolean);
  const ids: string[] = [];
  let i = 0;
  while (i < toks.length && ID.test(toks[i]!) && isThing(toks[i]!)) ids.push(toks[i++]!);
  if (!ids.length || i >= toks.length) return undefined;
  const verb = [toks[i++]!.toLowerCase()];
  while (i < toks.length && PARTICLES.has(toks[i]!.toLowerCase()) && !isThing(toks[i]!)) verb.push(toks[i++]!.toLowerCase());
  let to: string | undefined;
  if (i < toks.length && isThing(toks[i]!)) to = toks[i++];
  const rest = toks.slice(i).join(" ");
  const speed = speedOf(rest);
  const left = rest.replace(FAST, " ").replace(SLOW, " ").split(/\s+/).filter((t) => t && !FILLER.has(t.toLowerCase())).join(" ");
  return { verb: verb.join(" "), ids, ...(to ? { to } : {}), ...(q !== undefined ? { arg: q } : left ? { arg: left } : {}), ...(speed ? { speed } : {}) };
}

// Where things are: the relation words of the language, longest first, each to the one kind of placement the composer
// stages. Words before them say how the thing is there ("sits", "tied", "hangs") and are kept as the author's words.
const RELATION_WORDS: [string, RelationKind][] = [
  ["in front of", "front"], ["on top of", "on"], ["to the left of", "left"], ["to the right of", "right"], ["left of", "left"], ["right of", "right"],
  ["next to", "beside"], ["close to", "beside"], ["beside", "beside"], ["alongside", "beside"], ["near", "beside"], ["by", "beside"], ["against", "against"],
  ["behind", "behind"], ["underneath", "under"], ["beneath", "under"], ["below", "under"], ["under", "under"], ["above", "over"], ["over", "over"],
  ["onto", "on"], ["upon", "on"], ["atop", "on"], ["on", "on"], ["inside", "in"], ["within", "in"], ["into", "in"], ["in", "in"], ["around", "around"],
  ["to", "to"], ["from", "to"], ["at", "at"],
];
const PLACE_OF = /\b(at|on|in) the ([\p{L}\p{N} -]+?) of$/u; // "at the end of", "on the edge of", "in the middle of"
const LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|km|in|ft)\s*$/i;
const LENGTH_CM: Record<string, number> = { mm: 0.1, cm: 1, m: 100, km: 100000, in: 2.54, ft: 30.48 };

/**
 * A relation line: a thing, the author's words ending in a relation ("sits on", "tied to", "in front of", "at the end
 * of"), another thing (or a part of it, as b.part), then a quoted place on the other thing or a distance. "cup on
 * table", "sign tied to post "top"", "lamp above table "1 m"".
 */
export function readRelation(line: string, isThing: (t: string) => boolean): Omit<Relation, "line"> | undefined {
  const q = quoted(line);
  const toks = line.replace(/"[^"]*"/g, " ").trim().split(/\s+/).filter(Boolean);
  if (toks.length < 3) return undefined;
  const a = toks[0]!;
  const last = toks.at(-1)!;
  const [bRoot, ...bPart] = last.split(".");
  if (!ID.test(a) || !isThing(a) || !ID.test(last) || !isThing(bRoot!)) return undefined;
  const words = toks.slice(1, -1).join(" ").toLowerCase();
  let kind: RelationKind | undefined;
  let at = bPart.length ? bPart.join(".").replace(/[_-]+/g, " ") : undefined;
  const place = PLACE_OF.exec(words);
  if (place) {
    kind = place[1] === "at" ? "at" : place[1] === "on" ? "on" : "in";
    at ??= place[2]!.trim();
  } else {
    const hit = RELATION_WORDS.find(([w]) => words === w || words.endsWith(` ${w}`));
    if (!hit) return undefined;
    kind = hit[1];
  }
  const len = q !== undefined ? LENGTH.exec(q) : null;
  const gapCm = len ? Number(len[1]) * LENGTH_CM[len[2]!.toLowerCase()]! : undefined;
  if (q !== undefined && !len && q.trim()) at = q.trim().replace(/^(at|on|in|by) the /i, "").replace(/^the /i, "");
  return { a, kind, b: bRoot!, words, ...(at ? { at } : {}), ...(gapCm !== undefined ? { gapCm } : {}) };
}

/** A relation as the plan's line, in the author's words: `rope tied to post "top"`, `lamp above table "100 cm"`. */
export const relationLine = (r: Omit<Relation, "line">) => `${r.a} ${r.words} ${r.b}${r.at ? ` "${r.at}"` : r.gapCm !== undefined ? ` "${r.gapCm} cm"` : ""}`;

export function parseIntent(src: string, kinds: Iterable<string> = kindsOf()): IntentPlan {
  const kits = new Set(kinds);
  const computed = new Set<string>();
  const notes: string[] = [];
  const things: Thing[] = [];
  const moments: Moment[] = [];
  const declared = new Map<string, Thing>();
  const relations: Relation[] = [];
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
      const m = DECL.exec(rest);
      if (!m) return void notes.push(`line ${ln}: thing needs an id and a text, ignored`);
      return declare({ id: m[1]!, kind: "thing", text: quoted(m[2]!) ?? (m[2]!.trim() || m[1]!), line: ln });
    }
    if (key === "object") {
      const m = DECL.exec(rest);
      if (!m) return void notes.push(`line ${ln}: object needs an id and a description, ignored`);
      return declare({ id: m[1]!, kind: "object", desc: quoted(m[2]!) ?? (m[2]!.trim() || m[1]!), line: ln });
    }
    if (key === "many") {
      const m = MANY.exec(rest);
      if (!m) return void notes.push(`line ${ln}: many needs an id, a count and a unit, ignored`);
      return declare({ id: m[1]!, kind: "many", many: { n: Math.max(1, Number(m[2])), unit: quoted(m[3]!) ?? (m[3]!.trim() || m[1]!) }, line: ln });
    }
    if (!cur) {
      // Where things are: a standing fact of the scene, said once before the moments.
      const r = readRelation(line, (t) => declared.has(t));
      if (r) return void relations.push({ ...r, line: ln });
      return void notes.push(`line ${ln}: "${line}" comes before the first moment, kept out of the plan`);
    }
    if ((SCENE.has(key) || kits.has(key)) && !INTENT.has(key) && !declared.has(head) && !ARROW_START.test(line) && !/\s+(becomes|from)\s+/.test(line)) {
      // Today's scene language: pinned to this moment, with any lines indented under it. A line that makes a computed
      // thing names it for the rest of the plan.
      cur.pinned.push({ line: ln, text: line });
      const made = idLine(line)[1];
      if (kits.has(key) && made && ID.test(made)) computed.add(made);
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
    if ((m = BECOMES.exec(line)) && declared.get(m[1]!)?.kind !== "object") {
      const v = m[2]!.trim();
      if (/^\d+(\.\d+)?$/.test(v)) cur.becomes.push({ id: m[1]!, n: Number(v) });
      else cur.becomes.push({ id: m[1]!, text: quoted(v) ?? v });
    } else if ((m = FROM.exec(line))) cur.from.push({ a: m[1]!, b: m[2]! });
    else if ((m = ARROW.exec(line))) cur.arrows.push({ a: m[1]!, b: m[2]!, label: quoted(m[3]!) ?? "" });
    else {
      // What things do, in the author's own plain verbs: open. The depicter maps each verb onto what the thing can do.
      const a = readAct(line, (t) => declared.has(t) || computed.has(t) || PART.test(t));
      if (a) act(a);
      else notes.push(`line ${ln}: "${line}" names no thing it is about: kept out of the plan`);
    }
  });
  return { feel, audience, things, moments, notes, ...(relations.length ? { relations } : {}) };
}

// Every id a moment names, with where it is named (for the author repair loop and the composer).
export function idsOf(m: Moment): string[] {
  return [m.show, ...m.keep, ...m.becomes.map((b) => b.id), ...m.from.flatMap((f) => [f.a, f.b]), ...(m.compare ?? []), ...m.arrows.flatMap((a) => [a.a, a.b]), m.reveal, ...m.wrong, ...m.acts.flatMap((a) => [...a.ids, ...(a.to ? [a.to] : [])])].filter((x): x is string => !!x);
}

// Problems an author can repair, each with its line: word numbers that are not words or go backwards, ids that were never
// declared and are not the user's material, material parts that do not exist, moments with nothing to look at, a picture asked to become something else.
// A thing a pinned line computes (in any moment) is declared, with every dotted part of it; which parts it really has
// is the composer's to check, since only the kit knows.
export function checkIntent(plan: IntentPlan, words: Word[], material: PartCard[] = [], kinds: Iterable<string> = kindsOf()): IntentProblem[] {
  const out: IntentProblem[] = [];
  const things = new Map(plan.things.map((t) => [t.id, t]));
  const cards = new Map(material.map((c) => [c.name, c]));
  const computed = computedOf(plan, kinds);
  let last = -1;
  if (!plan.moments.length) out.push({ line: 1, message: "The plan has no moments. Start one with @N on a spoken word." });
  for (const m of plan.moments) {
    if (m.word < 0 || m.word >= words.length) out.push({ line: m.line, message: `@${m.word} is not a word of the narration (0 to ${words.length - 1}).` });
    else if (m.word <= last) out.push({ line: m.line, message: `@${m.word} comes after @${last}: moments must go up.` });
    last = Math.max(last, m.word);
    if (!m.show && !m.reveal) out.push({ line: m.line, message: `@${m.word} has no show: say the one thing the eye must be on${m.ask ? " while the question stands" : ""}.` });
    for (const id of new Set(idsOf(m))) {
      const [name, ...rest] = id.split(".");
      const part = rest.length ? rest.join(".") : undefined;
      if (computed.has(name!) && !cards.has(name!) && !things.has(name!)) continue;
      const card = cards.get(name!);
      if (card) {
        if (part && !card.parts[part] && !card.data?.texts?.[part]) out.push({ line: m.line, message: `@${m.word}: ${name} has no part "${part}". Its parts: ${Object.keys(card.parts).join(", ")}.` });
      } else if (part) out.push({ line: m.line, message: `@${m.word}: "${id}" names a part of "${name}", which is not the user's material.` });
      else if (!things.has(id)) out.push({ line: m.line, message: `@${m.word}: "${id}" was never declared. Declare it with thing, many or object before the first moment.` });
    }
    for (const b of m.becomes) if (cards.has(b.id.split(".")[0]!)) out.push({ line: m.line, message: `@${m.word}: ${b.id} is the user's material and cannot become something else.` });
    for (const b of m.becomes) if (things.get(b.id)?.kind === "many" && b.n === undefined) out.push({ line: m.line, message: `@${m.word}: ${b.id} is a many thing: it becomes a count, as in ${b.id} becomes 12.` });
    for (const a of m.acts) for (const id of a.ids) if (things.has(id) && things.get(id)!.kind !== "object") out.push({ line: a.line, message: `${id} ${a.verb}: only an object does things; declare ${id} as an object, or say how it changes with becomes.` });
  }
  // Where things are: both ends are objects (what is drawn as itself stands somewhere), never one thing twice.
  for (const r of plan.relations ?? []) {
    for (const id of [r.a, r.b]) if (things.get(id)?.kind !== "object") out.push({ line: r.line, message: `${r.a} ${r.words} ${r.b}: ${id} is ${things.has(id) ? `a ${things.get(id)!.kind}, not an object` : "not declared"}; only objects stand in a scene, so declare it as an object or leave the line out.` });
    if (r.a === r.b) out.push({ line: r.line, message: `${r.a} ${r.words} ${r.b}: a thing is not placed relative to itself.` });
  }
  const placedBy = new Map<string, number>();
  for (const r of plan.relations ?? []) if (["on", "over", "under", "in", "to", "at"].includes(r.kind)) {
    if (placedBy.has(`${r.a}|${r.b}`)) out.push({ line: r.line, message: `${r.a} is placed relative to ${r.b} again (line ${placedBy.get(`${r.a}|${r.b}`)}): say where it is once.` });
    placedBy.set(`${r.a}|${r.b}`, r.line);
  }
  for (const c of computed.values()) if (things.has(c.id) || cards.has(c.id)) out.push({ line: c.line, message: `${c.id} is made here by a ${c.kind} line and is also ${cards.has(c.id) ? "the user's material" : `declared at line ${things.get(c.id)!.line}`}: one name is one thing, so give one of them another id.` });
  return out;
}
