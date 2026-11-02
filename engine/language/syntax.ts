// Reads the scene language into a plain tree. It never throws: every mistake becomes a problem with a line number and a
// message exact enough for a model to fix it, and all of them are found in one pass.

export type Problem = { line: number; message: string };
export type Time = { word: number; offset: number };
export type Attrs = Record<string, string>;
export type Size = "huge" | "big" | "normal" | "small" | "note";
export type Atom = { id: string; text: string };
export type AtomPart = { type: "text"; atom: Atom } | { type: "frac"; num: Atom[]; den: Atom[] } | { type: "matrix"; rows: Atom[][]; bars: boolean };

export type Item = {
  kind: string; // row, stack, grid, ring, chain, free, atoms, text, code, image, graph, run, space, a shape, or a kit's kind
  id: string;
  line: number;
  attrs: Attrs;
  children: Item[];
  text?: string; // a label or a text's words
  size?: Size; // atoms
  parts?: AtomPart[]; // atoms
  lines?: string[]; // code
  edges?: { from: string; to: string; weight?: number }[]; // graph
  loose?: string[]; // graph: nodes with no edge
  program?: string; // run
};

export type Command =
  | { do: "arrow"; line: number; from: string; to: string; head: boolean; text?: string; attrs: Attrs }
  | { do: "mark"; line: number; shape: string; targets: string[]; text?: string; attrs: Attrs }
  | { do: "tag"; line: number; target: string; text: string; attrs: Attrs }
  | { do: "light" | "dim" | "focus" | "drop"; line: number; targets: string[]; attrs: Attrs }
  | { do: "set"; line: number; targets: string[]; attrs: Attrs }
  | { do: "play"; line: number; behavior: string; targets: string[]; attrs: Attrs }
  | { do: "emit"; line: number; name: string; attrs: Attrs };

export type State = { line: number; at: Time; keep: boolean; attrs: Attrs; items: Item[]; commands: Command[] };
export type ProgramDef = { name: string; line: number; params: Attrs; doc?: string; source: string };
export type Document = { background?: string; programs: ProgramDef[]; states: State[] };

export const SIZES = ["huge", "big", "normal", "small", "note"];
export const SHAPES = ["box", "circle", "pill", "diamond", "dot", "tri"];
export const MARKS = ["ring", "box", "underline", "cross", "brace"];
const CONTAINERS = ["row", "stack", "grid", "ring", "chain", "free"];
const PLACING = ["at", "into", "before", "after"];
const LOOK = ["color", "fill", "stroke", "weight", "opacity", "rotate", "strokeWidth"];
const ATTRS: Record<string, string[]> = {
  row: ["gap", "align", ...PLACING],
  stack: ["gap", "align", ...PLACING],
  grid: ["cols", "gap", ...PLACING],
  ring: ["size", "arrows", ...PLACING],
  chain: ["dir", "gap", ...PLACING],
  free: ["w", "h", ...PLACING],
  atoms: ["gap", ...PLACING, ...LOOK],
  text: ["size", "w", "font", "align", ...PLACING, ...LOOK],
  code: ["size", ...PLACING],
  image: ["asset", "w", "h", ...PLACING, "opacity"],
  graph: ["w", "h", "radius", ...PLACING],
  shape: ["w", "h", "size", ...PLACING, ...LOOK],
  space: ["h", ...PLACING],
  arrow: ["id", "bend", "color", "strokeWidth", "both"],
  mark: ["id", "color", "strokeWidth", "side"],
  tag: ["id", "side", "color", "size"],
  light: ["color"],
  dim: ["amount"],
  focus: ["color", "amount"],
  state: ["enter", "move", "ease"],
};
const COMMANDS = ["arrow", "link", "mark", "tag", "light", "dim", "focus", "drop", "set", "do", "emit"];
const LEAVES = ["text", "code", "image", "graph", "run", "space", ...SHAPES];
const WORDS = [...CONTAINERS, ...SIZES, ...COMMANDS, ...LEAVES, "program", "bg"];
export const ID = /^[A-Za-z0-9][\w-]*(\.[\w-]+)*$/;
const BAD_IDS = new Set(["constructor", "prototype"]);

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length]!;
}
export function suggest(word: string, options: Iterable<string>): string {
  let best = "";
  let score = 3;
  for (const o of options) {
    const d = distance(word.toLowerCase(), o.toLowerCase());
    if (d < score) [best, score] = [o, d];
  }
  return best ? ` Did you mean ${best}?` : "";
}

// Splits a line into tokens. Quotes keep spaces, also after key=. Returns null when a quote is left open.
export function tokenize(line: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t") {
      i++;
      continue;
    }
    let tok = "";
    while (i < line.length && line[i] !== " " && line[i] !== "\t") {
      if (line[i] === '"') {
        const end = line.indexOf('"', i + 1);
        if (end < 0) return null;
        tok += line.slice(i, end + 1);
        i = end + 1;
      } else tok += line[i++];
    }
    out.push(tok);
  }
  return out;
}

const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') && s.length > 1 ? s.slice(1, -1) : s);
const isQuoted = (s: string) => s.length > 1 && s.startsWith('"') && s.endsWith('"');
const pair = (tok: string) => {
  const at = tok.indexOf("=");
  return at > 0 && !tok.startsWith('"') ? [tok.slice(0, at), unquote(tok.slice(at + 1))] as const : null;
};

// Parses a moment such as @12, @12+5 or @12-3.
export function parseTime(tok: string): Time | null {
  const m = /^@(\d+)(?:([+-])(\d+))?$/.exec(tok);
  return m ? { word: Number(m[1]), offset: m[2] ? Number(`${m[2]}${m[3]}`) : 0 } : null;
}

type Fail = (message: string) => void;

// Separates plain tokens from key=value settings, checking the settings allowed on this kind of line.
function split(toks: string[], allowed: string[] | null, what: string, fail: Fail) {
  const plain: string[] = [];
  const attrs: Attrs = {};
  for (const t of toks) {
    const p = pair(t);
    if (!p) {
      plain.push(t);
      continue;
    }
    if (allowed && !allowed.includes(p[0])) fail(`${what} has no setting "${p[0]}".${suggest(p[0], allowed)} It takes: ${allowed.join(", ")}.`);
    attrs[p[0]] = p[1];
  }
  return { plain, attrs };
}

function checkId(id: string, fail: Fail) {
  if (!ID.test(id) || BAD_IDS.has(id)) fail(`"${id}" is not a usable id. Ids use letters, digits, _ and -, with dots between parts, and start with a letter or digit.`);
}

// Parses the tokens after `big:` into atoms, fractions and matrices.
function parseAtoms(toks: string[], line: string, fail: Fail): AtomPart[] {
  const seen = new Map<string, number>();
  const atom = (tok: string): Atom => {
    if (isQuoted(tok)) tok = unquote(tok);
    else {
      const p = pair(tok);
      if (p && ID.test(p[0]) && !BAD_IDS.has(p[0])) return { id: p[0], text: p[1].replace(/_/g, " ") };
      if (p) tok = p[1]; // something like +=+ has no usable id, but its meaning is clear: the atom says +
    }
    // No id given: an anonymous atom keeps its identity by what it says, so it can still travel between states.
    const slug = tok.replace(/[^A-Za-z0-9]/g, (c) => c.charCodeAt(0).toString(36)) || "x";
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    return { id: `t${slug}.${line}.${n}`, text: tok.replace(/_/g, " ") };
  };
  const parts: AtomPart[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const close = t === "{" ? "}" : t === "[" ? "]" : t === "|" ? "|" : "";
    if (!close) {
      if (t === "}" || t === "]") fail(`"${t}" closes something that was never opened.`);
      else parts.push({ type: "text", atom: atom(t) });
      continue;
    }
    const inner: string[] = [];
    for (i++; i < toks.length && toks[i] !== close; i++) inner.push(toks[i]!);
    if (i >= toks.length) {
      fail(`"${t}" is never closed with "${close}". Separate these symbols with spaces.`);
      break;
    }
    if (close === "}") {
      const cut = inner.indexOf("/");
      if (cut < 1 || cut === inner.length - 1) {
        fail(`a fraction needs parts on both sides of a spaced "/", as in { a=1 / b=2 }.`);
        continue;
      }
      parts.push({ type: "frac", num: inner.slice(0, cut).map(atom), den: inner.slice(cut + 1).map(atom) });
    } else {
      const rows: Atom[][] = [[]];
      for (const x of inner) x === ";" ? rows.push([]) : rows.at(-1)!.push(atom(x));
      if (rows.some((r) => r.length !== rows[0]!.length) || !rows[0]!.length) fail(`every row of a matrix needs the same number of entries; these rows have ${rows.map((r) => r.length).join(", ")}.`);
      else parts.push({ type: "matrix", rows, bars: close === "|" });
    }
  }
  return parts;
}

// Reads one graph edge or node, such as A-B:4, A-B or Z.
function parseGraph(item: Item, toks: string[], fail: Fail) {
  item.edges = [];
  item.loose = [];
  for (const t of toks) {
    const m = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)(?::(-?[\d.]+))?$/.exec(t);
    if (m) item.edges.push({ from: m[1]!, to: m[2]!, ...(m[3] ? { weight: Number(m[3]) } : {}) });
    else if (/^[A-Za-z0-9_]+$/.test(t)) item.loose.push(t);
    else fail(`"${t}" is not a graph part. Write edges as A-B or A-B:4 and lone nodes as A.`);
  }
}

export type ParseResult = { doc: Document; problems: Problem[] };

export function parse(source: string, kitKinds: Iterable<string> = []): ParseResult {
  const kits = new Set(kitKinds);
  const lines = source.replace(/\r/g, "").split("\n");
  const problems: Problem[] = [];
  const doc: Document = { programs: [], states: [] };
  let state: State | undefined;
  let stack: { indent: number; item: Item }[] = [];
  let auto = 0;

  for (let n = 0; n < lines.length; n++) {
    const number = n + 1;
    const raw = lines[n]!;
    const fail: Fail = (message) => problems.push({ line: number, message: `${message} The line reads: ${raw.trim().slice(0, 120)}` });
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("```")) continue;
    const indent = raw.length - raw.trimStart().length;
    const toks = tokenize(line);
    if (!toks) {
      fail(`A quote is never closed.`);
      continue;
    }
    const head = toks[0]!;

    if (head === "bg") {
      doc.background = toks[1];
      if (!toks[1]) fail(`bg needs a color name.`);
      continue;
    }

    if (head === "program") {
      const { plain, attrs } = split(toks.slice(1), null, "program", fail);
      const name = plain[0];
      if (!name || !/^[A-Za-z][\w-]*$/.test(name)) fail(`A program needs a name made of letters, digits and hyphens, as in: program spiral n=40`);
      if (doc.programs.some((p) => p.name === name)) fail(`There is already a program called ${name}.`);
      const body: string[] = [];
      let closed = false;
      for (n++; n < lines.length; n++) {
        if (lines[n]!.trim() === "end") {
          closed = true;
          break;
        }
        body.push(lines[n]!);
      }
      if (!closed) problems.push({ line: number, message: `The program ${name ?? ""} has no "end" line.` });
      const { doc: about, ...params } = attrs;
      doc.programs.push({ name: name ?? "", line: number, params, ...(about ? { doc: about } : {}), source: body.join("\n") });
      continue;
    }

    if (head.startsWith("@")) {
      const at = parseTime(head);
      if (!at) {
        fail(`"${head}" is not a moment. Write @12, or @12+5 for 5 frames after word 12.`);
        state = undefined;
        continue;
      }
      const { plain, attrs } = split(toks.slice(1), ATTRS.state!, "A state", fail);
      const extra = plain.filter((p) => p !== "keep");
      if (extra.length) fail(`A state line only takes "keep" and settings, not "${extra[0]}". Put content on the lines below it.`);
      state = { line: number, at, keep: plain.includes("keep"), attrs, items: [], commands: [] };
      doc.states.push(state);
      stack = [];
      auto = 0; // unnamed lines count per state, so an unnamed line in a later plain state is the same line
      continue;
    }

    if (!state) {
      fail(WORDS.includes(head.replace(/:$/, "")) ? `This is outside any state. Start a state with @WORD first.` : `Unknown line.${suggest(head, WORDS)}`);
      continue;
    }

    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const holder = stack.at(-1)?.item;
    const add = (item: Item, holds: boolean) => {
      (holder ? holder.children : state!.items).push(item);
      if (holds) stack.push({ indent, item });
    };

    // A literal line of code.
    if (head.startsWith("|") && holder?.kind === "code") {
      const text = raw.slice(raw.indexOf("|") + 1);
      holder.lines!.push(text.startsWith(" ") ? text.slice(1) : text);
      continue;
    }

    const atoms = /^(huge|big|normal|small|note)(?:\s+([^\s:]+))?((?:\s+\w+=[^\s:]+)*)\s*:\s*(.*)$/.exec(line);
    if (atoms) {
      const rest = tokenize(atoms[4]!)!;
      const { attrs } = split(tokenize(atoms[3]!.trim()) ?? [], ATTRS.atoms!, "A line of atoms", fail);
      const id = atoms[2] ?? `${state.keep ? `k${doc.states.length}-` : ""}line${++auto}`;
      if (atoms[2]) checkId(id, fail);
      const parts = parseAtoms(rest, id, fail);
      if (!parts.length) fail(`This line has nothing on it. Write parts after the colon, as in big: a=1 b=+ c=2`);
      add({ kind: "atoms", id, line: number, attrs, children: [], size: atoms[1] as Size, parts }, false);
      continue;
    }

    if (CONTAINERS.includes(head)) {
      const { plain, attrs } = split(toks.slice(1), ATTRS[head]!, head, fail);
      if (plain.length > 1) fail(`${head} takes one id and settings, not "${plain[1]}". Put its contents on indented lines below.`);
      const id = plain[0] ?? `${head}${++auto}`;
      if (plain[0]) checkId(id, fail);
      add({ kind: head, id, line: number, attrs, children: [] }, true);
      continue;
    }

    if (SIZES.includes(head)) {
      fail(`A line of atoms needs a colon, as in ${head}: a=1 b=2`);
      continue;
    }

    if (COMMANDS.includes(head)) {
      if (holder) problems.push({ line: number, message: `${head} cannot sit inside ${holder.kind}. Write it at the left edge of the state. The line reads: ${line.slice(0, 120)}` });
      const c = command(head, toks.slice(1), number, fail, state);
      if (c) state.commands.push(c);
      continue;
    }

    if (LEAVES.includes(head) || kits.has(head)) {
      const item = leaf(head, toks.slice(1), number, fail, kits.has(head) && !LEAVES.includes(head), () => ++auto);
      if (item) add(item, head === "code");
      continue;
    }

    fail(`Unknown line.${suggest(head, [...WORDS, ...kits])}`);
  }

  if (!doc.states.length) problems.push({ line: 1, message: `There are no states. A scene needs at least one line such as @0, with its contents below it.` });
  return { doc, problems };
}

function leaf(head: string, toks: string[], line: number, fail: Fail, isKit: boolean, next: () => number): Item | undefined {
  const colon = toks.findIndex((t) => t === ":" || t.endsWith(":"));
  if (head === "graph") {
    if (colon < 0) {
      fail(`A graph lists its parts after a colon, as in graph g: A-B:4 A-C B-C:1`);
      return;
    }
    const before = toks.slice(0, colon + 1).map((t, i) => (i === colon ? t.slice(0, -1) : t)).filter(Boolean);
    const { plain, attrs } = split(before, ATTRS.graph!, "graph", fail);
    if (!plain[0]) {
      fail(`A graph needs an id, as in graph g: A-B:4 A-C`);
      return;
    }
    checkId(plain[0], fail);
    const item: Item = { kind: "graph", id: plain[0], line, attrs, children: [] };
    parseGraph(item, toks.slice(colon + 1), fail);
    return item;
  }
  if (head === "run") {
    const { plain, attrs } = split(toks, null, "run", fail);
    if (plain.length < 2) {
      fail(`run needs a program name and an id, as in run spiral s1 n=40`);
      return;
    }
    checkId(plain[1]!, fail);
    return { kind: "run", id: plain[1]!, program: plain[0]!, line, attrs, children: [] };
  }
  const kind = SHAPES.includes(head) ? "shape" : head;
  const { plain, attrs } = split(toks, isKit ? null : ATTRS[kind] ?? null, head, fail);
  if (head === "space") return { kind: "space", id: `space${next()}`, line, attrs, children: [] };
  const quoted = plain.filter(isQuoted);
  const named = plain.filter((p) => !isQuoted(p));
  const id = named[0];
  if (!id) {
    fail(`${head} needs an id, as in ${head} a1 "words"`);
    return;
  }
  checkId(id, fail);
  if (named.length > 1) fail(`${head} takes one id, then quoted words, then settings. "${named[1]}" is not one of those. Words need quotes.`);
  if (quoted.length > 1) fail(`${head} takes one quoted text, but this has ${quoted.length}.`);
  const text = quoted[0] === undefined ? undefined : unquote(quoted[0]);
  if (head === "text" && text === undefined) fail(`text needs quoted words, as in text a1 "some words"`);
  const item: Item = { kind: SHAPES.includes(head) ? head : head, id, line, attrs, children: [], ...(text === undefined ? {} : { text }) };
  if (head === "code") item.lines = [];
  return item;
}

function targetList(toks: string[], fail: Fail): string[] {
  const out = toks.flatMap((t) => t.split(",")).filter(Boolean);
  for (const t of out) checkId(t, fail);
  return out;
}

function command(head: string, toks: string[], line: number, fail: Fail, state: State): Command | undefined {
  if (head === "arrow" || head === "link") {
    const { plain, attrs } = split(toks, ATTRS.arrow!, head, fail);
    const sign = head === "arrow" ? "->" : "--";
    const words = plain.filter((p) => !isQuoted(p));
    if (words.length !== 3 || words[1] !== sign) {
      fail(`${head} is written as ${head} a ${sign} b, with spaces around ${sign}, then an optional "label".`);
      return;
    }
    checkId(words[0]!, fail);
    checkId(words[2]!, fail);
    const label = plain.find(isQuoted);
    return { do: "arrow", line, from: words[0]!, to: words[2]!, head: head === "arrow", attrs, ...(label ? { text: unquote(label) } : {}) };
  }
  if (head === "mark") {
    const { plain, attrs } = split(toks, ATTRS.mark!, "mark", fail);
    const words = plain.filter((p) => !isQuoted(p));
    const shape = words[0];
    if (!shape || !MARKS.includes(shape)) {
      fail(`mark needs a shape first: ${MARKS.join(", ")}.${shape ? suggest(shape, MARKS) : ""}`);
      return;
    }
    const targets = targetList(words.slice(1), fail);
    if (!targets.length) fail(`mark ${shape} needs something to mark, as in mark ${shape} a1`);
    const label = plain.find(isQuoted);
    return { do: "mark", line, shape, targets, attrs, ...(label ? { text: unquote(label) } : {}) };
  }
  if (head === "tag") {
    const { plain, attrs } = split(toks, ATTRS.tag!, "tag", fail);
    const target = plain.find((p) => !isQuoted(p));
    const label = plain.find(isQuoted);
    if (!target || !label) {
      fail(`tag is written as tag a1 "words".`);
      return;
    }
    checkId(target, fail);
    return { do: "tag", line, target, text: unquote(label), attrs };
  }
  if (head === "light" || head === "dim" || head === "focus" || head === "drop") {
    const { plain, attrs } = split(toks, ATTRS[head] ?? [], head, fail);
    const targets = targetList(plain, fail);
    if (!targets.length) fail(`${head} needs at least one id.`);
    if (head === "drop" && !state.keep) fail(`drop only works in a keep state. In a plain state, anything you do not list leaves by itself.`);
    return { do: head, line, targets, attrs };
  }
  if (head === "set") {
    const { plain, attrs } = split(toks, null, "set", fail);
    const targets = targetList(plain, fail);
    if (!targets.length || !Object.keys(attrs).length) fail(`set is written as set a1 prop=value, as in set a1 opacity=0.4`);
    return { do: "set", line, targets, attrs };
  }
  if (head === "do") {
    const { plain, attrs } = split(toks, null, "do", fail);
    if (plain.length < 2) {
      fail(`do is written as do BEHAVIOR target, as in do pulse a1`);
      return;
    }
    return { do: "play", line, behavior: plain[0]!, targets: targetList(plain.slice(1), fail), attrs };
  }
  const { plain, attrs } = split(toks, null, "emit", fail);
  if (!plain[0]) {
    fail(`emit needs an event name, as in emit click`);
    return;
  }
  return { do: "emit", line, name: plain[0], attrs };
}
