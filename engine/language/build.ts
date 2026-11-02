// Turns scene language into a scene document, then a scene. Each state is laid out in full, and the difference from the
// state before becomes the steps: new things enter, things with a known id travel, things no longer listed leave.
import { compile, when } from "../core/compile.ts";
import type { CompileContext, Ease, Kit, NodeSpec, Props, Scene, SceneDoc, Step, Track, Value } from "../core/types.ts";
import { EASES } from "../core/ease.ts";
import { evaluate } from "../core/evaluate.ts";
import { graphKit } from "../kits/graph.ts";
import { estimate, graphPositions, layout, readableOn, type Box, type Env, type Laid, type Measure, type Part } from "./layout.ts";
import type { LibraryEntry } from "./library.ts";
import { checkOutput } from "./program.ts";
import { runProgram, type RunResult } from "./sandbox.ts";
import { parse, parseTime, suggest, type Attrs, type Command, type Item, type Problem, type State } from "./syntax.ts";

export type BuildOptions = {
  ctx: CompileContext;
  words?: string[]; // the spoken words, for programs that follow the voice
  assets?: Record<string, string>; // image names the scene may use; nothing else can become an image
  library?: LibraryEntry[];
  seed?: number;
  measure?: Measure;
};
export type BuildResult = { problems: Problem[]; doc?: SceneDoc; scene?: Scene; stats: { states: number; parts: number; programs: number; programMs: number } };
type Live = { kind: string; parent?: string; props: Props; alive: boolean; line: number };

const ENTERS = ["fade", "draw", "pop", "none"];
const COLOR_PROP = new Set(["fill", "stroke", "color", "pulseColor"]);
const GROUP_PROP = new Set(["x", "y", "rotate", "opacity", "scaleX", "scaleY", "skew"]);
const SHAPE_PROP = new Set(["fill", "stroke", "strokeWidth", "drawn", "closed", "smooth"]);
const REFUSED_SET = new Set(["src", "href", "font", "points", "constructor", "prototype"]);
const RESERVED_RUN = new Set(["w", "h", "until", "on", "seed", "at", "into", "before", "after"]);
const MARK_PAD = 14;
const same = (a: Value | undefined, b: Value | undefined) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.05 : JSON.stringify(a) === JSON.stringify(b));
const number = (s: string) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
const round = (v: number) => Math.round(v * 10) / 10;

// A setting's value as a program or behavior wants it: numbers, spoken moments as frames, comma lists as arrays.
function argValue(v: string, frameOf: (t: { word: number; offset: number }) => number): Value {
  const t = parseTime(v);
  if (t) return frameOf(t);
  if (v.includes(",")) {
    const list = v.split(",");
    return list.every((x) => number(x) !== null) ? list.map(Number) : v;
  }
  return number(v) ?? v;
}

// Where a line drawn between two boxes meets the edge of each.
function edgePoint(from: Box, to: { x: number; y: number }, pad: number) {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const t = 1 / Math.max(Math.abs(dx) / (from.w / 2 + pad || 1), Math.abs(dy) / (from.h / 2 + pad || 1), 1e-6);
  return { x: from.x + dx * Math.min(1, t), y: from.y + dy * Math.min(1, t) };
}
const union = (list: Box[]): Box => {
  const [l, r] = [Math.min(...list.map((b) => b.x - b.w / 2)), Math.max(...list.map((b) => b.x + b.w / 2))];
  const [t, d] = [Math.min(...list.map((b) => b.y - b.h / 2)), Math.max(...list.map((b) => b.y + b.h / 2))];
  return { x: (l + r) / 2, y: (t + d) / 2, w: r - l, h: d - t };
};
const hits = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) * Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));

// Bounding box of what a kit made, so any kit can be fitted into a slot without knowing its size in advance.
function bounds(nodes: NodeSpec[]): { x: number; y: number; w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  const parents = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    let [ox, oy] = [0, 0];
    for (let up = n.parent ? parents.get(n.parent) : undefined; up; up = up.parent ? parents.get(up.parent) : undefined) {
      if (up === nodes[0]) break;
      ox += Number(up.props?.x ?? 0);
      oy += Number(up.props?.y ?? 0);
    }
    const [x, y] = [ox + Number(n.props?.x ?? 0), oy + Number(n.props?.y ?? 0)];
    const p = n.props?.points;
    if (Array.isArray(p)) p.forEach((v, i) => (i % 2 ? ys : xs).push(v + (i % 2 ? y : x)));
    else if (n.kind === "text") {
      const size = Number(n.props?.size ?? 60);
      const w = estimate(String(n.props?.text ?? ""), size);
      xs.push(x - w / 2, x + w / 2);
      ys.push(y - size / 2, y + size / 2);
    }
  }
  if (!xs.length) return { x: 0, y: 0, w: 1, h: 1 };
  const [l, r, t, d] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (l + r) / 2, y: (t + d) / 2, w: Math.max(1, r - l), h: Math.max(1, d - t) };
}

export async function build(source: string, opts: BuildOptions): Promise<BuildResult> {
  const { ctx } = opts;
  const allKits = [graphKit, ...(ctx.kits ?? []).filter((k) => k !== graphKit)];
  const kinds: NonNullable<Kit["kinds"]> = Object.assign({}, ...allKits.map((k) => k.kinds));
  const kitNames = Object.keys(kinds).filter((k) => k !== "graph");
  const { doc, problems } = parse(source, kitNames);
  const stats = { states: doc.states.length, parts: 0, programs: 0, programMs: 0 };
  if (problems.length) return { problems, stats };

  const behaviors = new Set(["flow", "pulse", "shake", ...allKits.flatMap((k) => Object.keys(k.behaviors ?? {}))]);
  const report = (line: number, message: string) => problems.length < 40 && problems.push({ line, message });
  const colors = new Set(Object.keys(ctx.theme.colors));
  const colorOk = (v: string | undefined, line: number) => {
    if (v !== undefined && v !== "none" && !colors.has(v)) report(line, `"${v}" is not a color here. Use one of: ${[...colors].join(", ")}.${suggest(v, colors)}`);
  };
  colorOk(doc.background, 1);
  const words = ctx.words ?? [];
  const momentOf = (t: { word: number; offset: number }, line: number) => {
    if (t.word >= words.length) {
      report(line, `There is no spoken word ${t.word}; the last word is ${words.length - 1}.`);
      return 0;
    }
    return Math.max(0, when({ word: t.word, offset: t.offset }, ctx));
  };

  const programs = new Map<string, { params: Attrs; source: string; line: number }>();
  for (const e of opts.library ?? []) programs.set(e.name, { params: e.params, source: e.source, line: 0 });
  for (const p of doc.programs) programs.set(p.name, { params: p.params, source: p.source, line: p.line });

  const margin = ctx.width * 0.065;
  const top = ctx.height * 0.047;
  const usable = ctx.height * 0.765; // the bottom is left clear for captions
  const safe: Box = { x: ctx.width / 2, y: top + usable / 2, w: ctx.width - margin * 2, h: usable };
  const expansions = new Map<string, { nodes: NodeSpec[]; box: ReturnType<typeof bounds> }>();

  const expandKit = (item: Item) => {
    const known = expansions.get(item.id);
    if (known) return known;
    let spec: NodeSpec;
    if (item.kind === "graph") {
      const ids = [...new Set([...item.edges!.flatMap((e) => [e.from, e.to]), ...item.loose!])];
      const radius = number(item.attrs.radius ?? "") ?? 62;
      const at = graphPositions(ids, item.edges!, 1000, radius);
      spec = { id: item.id, kind: "graph", data: { radius, nodes: ids.map((id) => ({ id, ...at.get(id)! })), edges: item.edges!.map((e) => ({ id: `${e.from}${e.to}`, ...e })) } };
    } else {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item.attrs)) {
        if (["at", "into", "before", "after"].includes(k)) continue;
        try {
          data[k] = /^[{[]/.test(v) ? JSON.parse(v) : (number(v) ?? v);
        } catch {
          report(item.line, `The setting ${k} of ${item.id} is not valid JSON.`);
        }
      }
      spec = { id: item.id, kind: item.kind, data };
    }
    const expand = (n: NodeSpec): NodeSpec[] => (["group", "path", "text", "image"].includes(n.kind) ? [n] : (kinds[n.kind]?.(n, ctx) ?? []).flatMap(expand));
    let nodes: NodeSpec[] = [];
    try {
      nodes = expand(spec);
    } catch (e) {
      report(item.line, `${item.kind} ${item.id} failed: ${(e as Error).message}`);
    }
    if (!nodes.some((n) => n.id === item.id)) nodes = [{ id: item.id, kind: "group" }, ...nodes.map((n) => ({ ...n, parent: n.parent ?? item.id }))];
    nodes.sort((a, b) => Number(b.id === item.id) - Number(a.id === item.id));
    const made = { nodes, box: bounds(nodes) };
    expansions.set(item.id, made);
    return made;
  };

  const env: Env = {
    W: ctx.width,
    H: ctx.height,
    safe,
    theme: ctx.theme,
    measure: opts.measure ?? estimate,
    natural: (item) => {
      if (item.kind === "run") return { w: number(item.attrs.w ?? "") ?? safe.w, h: number(item.attrs.h ?? "") ?? safe.w };
      const b = expandKit(item).box;
      const fit = Math.min((number(item.attrs.w ?? "") ?? safe.w) / b.w, (number(item.attrs.h ?? "") ?? safe.w) / b.h);
      return { w: b.w * fit, h: b.h * fit };
    },
  };

  // What is on the board now.
  let board: Item[] = [];
  let attached: Command[] = [];
  const live = new Map<string, Live>();
  const overrides = new Map<string, Props>();
  const mounted = new Map<string, { parts: Part[]; first: Box; scale: number; ends: Map<string, number> }>();
  const programTracks: Track[] = [];
  const steps: Step[] = [];
  let lastScale = Infinity;

  const walkAll = (list: Item[], fn: (i: Item, siblings: Item[]) => void) => {
    for (const i of [...list]) {
      fn(i, list);
      walkAll(i.children, fn);
    }
  };
  const atomIds = (i: Item) => i.parts?.flatMap((p) => (p.type === "text" ? [p.atom] : p.type === "frac" ? [...p.num, ...p.den] : p.rows.flat()).map((a) => a.id)) ?? [];
  const removeAtom = (list: Item[], id: string) => {
    walkAll(list, (i) => {
      if (i.kind !== "atoms") return;
      i.parts = i.parts!.filter((p) => {
        if (p.type === "text") return p.atom.id !== id;
        const all = p.type === "frac" ? [...p.num, ...p.den] : p.rows.flat();
        return !all.some((a) => a.id === id);
      });
    });
  };
  const pruneEmpty = (list: Item[]): Item[] =>
    list.filter((i) => {
      i.children = pruneEmpty(i.children);
      return !(i.kind === "atoms" && !i.parts!.length) && !(["row", "stack", "grid", "ring", "chain", "free"].includes(i.kind) && !i.children.length);
    });
  const removeItem = (list: Item[], id: string): boolean => {
    const at = list.findIndex((i) => i.id === id);
    if (at >= 0) {
      list.splice(at, 1);
      return true;
    }
    return list.some((i) => removeItem(i.children, id));
  };
  const findItem = (list: Item[], id: string): { item: Item; siblings: Item[] } | undefined => {
    for (const i of list) {
      if (i.id === id) return { item: i, siblings: list };
      const deep = findItem(i.children, id);
      if (deep) return deep;
    }
  };
  const leafIds = (i: Item): string[] => [...(i.kind === "atoms" ? atomIds(i) : [i.id]), ...i.children.flatMap(leafIds)];
  const clone = (x: Item[]): Item[] => JSON.parse(JSON.stringify(x));

  // Applies a state's contents to the board, so a keep state only says what changes.
  const applyState = (s: State) => {
    if (!s.keep) {
      board = clone(s.items);
      attached = [];
    } else {
      for (const c of s.commands) {
        if (c.do !== "drop") continue;
        for (const id of c.targets) {
          removeAtom(board, id);
          removeItem(board, id);
          attached = attached.filter((a) => !(((a.do === "arrow" && [a.attrs.id, `arrow.${a.from}.${a.to}`, a.from, a.to].includes(id)) || (a.do === "mark" && ([a.attrs.id, `mark.${a.shape}.${a.targets[0]}`].includes(id) || a.targets.includes(id))) || (a.do === "tag" && [a.attrs.id, `tag.${a.target}`, a.target].includes(id)))));
        }
      }
      for (const raw of clone(s.items)) {
        const hasId = !/^(row|stack|grid|ring|chain|free|line|space|k\d+-line)\d*$/.test(raw.id);
        const same = hasId ? findItem(board, raw.id) : undefined;
        for (const id of raw.children.length || raw.kind === "atoms" ? leafIds(raw).filter((x) => x !== raw.id) : []) {
          removeAtom(board, id);
          removeItem(board, id);
        }
        if (same) {
          same.siblings[same.siblings.indexOf(same.item)] = raw;
          continue;
        }
        const into = raw.attrs.into ? findItem(board, raw.attrs.into) : undefined;
        const anchor = raw.attrs.before ?? raw.attrs.after;
        const near = anchor ? findItem(board, anchor) : undefined;
        if (raw.attrs.into && !into) report(raw.line, `into=${raw.attrs.into} names nothing on the board.`);
        if (anchor && !near) report(raw.line, `${raw.attrs.before ? "before" : "after"}=${anchor} names nothing on the board.`);
        if (into?.item.kind === "atoms" && raw.kind === "atoms") into.item.parts!.push(...raw.parts!);
        else if (into) into.item.children.push(raw);
        else if (near) near.siblings.splice(near.siblings.indexOf(near.item) + (raw.attrs.after ? 1 : 0), 0, raw);
        else board.push(raw);
      }
      board = pruneEmpty(board);
    }
    for (const c of s.commands) {
      if (c.do !== "arrow" && c.do !== "mark" && c.do !== "tag") continue;
      const key = (x: Command) => (x.do === "arrow" ? x.attrs.id ?? `arrow.${x.from}.${x.to}` : x.do === "mark" ? x.attrs.id ?? `mark.${x.shape}.${x.targets[0]}` : x.do === "tag" ? x.attrs.id ?? `tag.${x.target}` : "");
      attached = attached.filter((a) => key(a) !== key(c));
      attached.push(c);
    }
  };

  // Runs a program the first time it appears. Its parts then stay addressable, and it is never run again.
  const mount = async (slotItem: Item, box: Box, s: number, at: number, laid: Laid) => {
    const def = programs.get(slotItem.program!);
    if (!def) {
      failed.add(slotItem.id);
      report(slotItem.line, `There is no program called ${slotItem.program}.${suggest(slotItem.program!, programs.keys())} Define it with a program block or use one from the library.`);
      return;
    }
    const args: Record<string, unknown> = {};
    const toArg = (v: string) => argValue(v, (t) => momentOf(t, slotItem.line));
    for (const [k, v] of Object.entries(def.params)) args[k] = toArg(v);
    for (const [k, v] of Object.entries(slotItem.attrs)) {
      if (RESERVED_RUN.has(k)) continue;
      if (!(k in def.params)) report(slotItem.line, `The program ${slotItem.program} has no setting "${k}". It takes: ${Object.keys(def.params).join(", ") || "nothing"}, plus w, h, until, on, seed.`);
      args[k] = toArg(v);
    }
    const until = slotItem.attrs.until ? parseTime(slotItem.attrs.until) : null;
    if (slotItem.attrs.until && !until) report(slotItem.line, `until must be a moment such as @40, not ${slotItem.attrs.until}.`);
    const T1 = until ? momentOf(until, slotItem.line) : ctx.frames - 1;
    if (T1 < at) report(slotItem.line, `This program ends at frame ${T1}, before it starts at frame ${at}.`);
    const overlay = box.w === 0;
    const area: Box = overlay ? { x: ctx.width / 2, y: ctx.height / 2, w: ctx.width, h: ctx.height } : box;
    const left = area.x - area.w / 2;
    const up = area.y - area.h / 2;
    const onIds = (slotItem.attrs.on ?? "").split(",").filter(Boolean);
    const on: Record<string, Box> = {};
    for (const id of onIds) {
      const b = laid.boxes.get(id);
      if (!b) report(slotItem.line, `on names ${id}, which is not on the board yet.${suggest(id, laid.boxes.keys())}`);
      else on[id] = { ...b, x: b.x - left, y: b.y - up };
    }
    const result: RunResult = await runProgram(def.source, {
      W: round(area.w), H: round(area.h), T0: at, T1, fps: ctx.fps, frames: ctx.frames,
      seed: number(slotItem.attrs.seed ?? "") ?? opts.seed ?? 1,
      args, on, colors: [...colors],
      words: (opts.words ?? []).map((text, i) => ({ text, frame: when({ word: i }, ctx) })).filter((w) => w.frame >= at && w.frame <= T1),
    });
    stats.programs++;
    stats.programMs += result.ms;
    if (!result.ok) {
      failed.add(slotItem.id);
      report(def.line && result.line ? def.line + result.line : slotItem.line, `The program ${slotItem.program} failed${result.line && !def.line ? ` at its line ${result.line}` : ""}: ${result.error}`);
      return;
    }
    const { errors, checked } = checkOutput(result.output, { mount: slotItem.id, on: onIds, offset: { x: left, y: up }, frames: ctx.frames, colors });
    for (const e of errors) report(def.line || slotItem.line, `The program ${slotItem.program}: ${e}.`);
    if (!checked) {
      failed.add(slotItem.id);
      return;
    }
    const parts: Part[] = checked.parts.map((p) => ({ ...p, line: slotItem.line }));
    mounted.set(slotItem.id, { parts, first: area, scale: s, ends: new Map(checked.tracks.map((t) => [`${t.target}\u0000${t.prop}`, t.keys.at(-1)!.at])) });
    programTracks.push(...checked.tracks);
    for (const e of checked.events) steps.push({ at: e.at, emit: [{ name: e.name, ...(e.data ? { data: e.data } : {}) }] });
    if (checked.tracks.length) laterPlay.push({ behavior: `program.${slotItem.id}`, target: slotItem.id });
  };
  // A program that failed has already been reported. Its parts being missing is not a second problem.
  const failed = new Set<string>();
  const fromFailed = (id: string) => [...failed].some((m) => id === m || id.startsWith(`${m}.`));
  const kitsMade: Kit = { name: "programs", behaviors: {} };
  let laterPlay: NonNullable<Step["play"]> = []; // program motion, played once its parts exist

  for (let index = 0; index < doc.states.length; index++) {
    const s = doc.states[index]!;
    const before = problems.length;
    const at = momentOf(s.at, s.line);
    if (s.attrs.enter && !ENTERS.includes(s.attrs.enter)) report(s.line, `enter must be one of ${ENTERS.join(", ")}.`);
    if (s.attrs.ease && !(s.attrs.ease in EASES)) report(s.line, `ease must be one of ${Object.keys(EASES).join(", ")}.`);
    if (s.attrs.move && !(Number(s.attrs.move) > 0)) report(s.line, `move is a number of frames.`);

    applyState(s);
    // Ids in one state must be unique, or one thing would need to be in two places.
    const ids = new Map<string, number>();
    walkAll(board, (i) => {
      for (const id of i.kind === "atoms" ? atomIds(i) : [i.id]) {
        if (ids.has(id)) report(i.line, `The id ${id} is on the board twice in this state (also line ${ids.get(id)}). A thing can only be in one place. Use a new id for a copy.`);
        ids.set(id, i.line);
      }
    });
    walkAll(board, (i) => {
      for (const k of ["color", "fill", "stroke"]) colorOk(i.attrs[k], i.line);
      if (i.kind === "image" && !opts.assets?.[i.attrs.asset ?? ""]) report(i.line, `The image ${i.id} needs asset=NAME with a name from the assets list.${opts.assets ? ` Available: ${Object.keys(opts.assets).join(", ") || "none"}.` : " This scene has no assets."}`);
    });

    const laid = layout(board, env, s.keep && Number.isFinite(lastScale) ? lastScale : undefined);
    lastScale = laid.scale;
    problems.push(...laid.problems.slice(0, 6).map((p) => ({ ...p, line: p.line || s.line })));

    // Parts for this state: laid-out parts, then kits and programs in their slots, then everything attached to them.
    const parts = new Map<string, Part>(laid.parts.map((p) => [p.id, p]));
    const newPrograms: string[] = [];
    for (const slot of laid.slots) {
      const { item, box, scale } = slot;
      if (item.kind === "run") {
        if (!mounted.has(item.id)) {
          await mount(item, box, scale, at, laid);
          newPrograms.push(item.id);
        }
        const m = mounted.get(item.id);
        if (!m) continue;
        const k = scale / m.scale;
        const area = box.w === 0 ? m.first : box;
        parts.set(item.id, { id: item.id, kind: "group", line: item.line, props: { x: round(area.x - area.w / 2), y: round(area.y - area.h / 2), scaleX: k, scaleY: k } });
        for (const p of m.parts) parts.set(p.id, p);
        continue;
      }
      const { nodes, box: b } = expandKit(item);
      const k = Math.min(box.w / b.w, box.h / b.h);
      for (const n of nodes) {
        const root = n.id === item.id;
        parts.set(n.id, { ...n, props: root ? { ...n.props, x: round(box.x - b.x * k), y: round(box.y - b.y * k), scaleX: k, scaleY: k } : { ...(n.props ?? {}) }, line: item.line });
      }
    }

    const boxOf = (id: string): Box | undefined => laid.boxes.get(id) ?? (() => {
      const m = laid.members.get(id);
      const list = m?.map((x) => laid.boxes.get(x)).filter((b): b is Box => !!b);
      return list?.length ? union(list) : undefined;
    })() ?? slotPartBox(id);
    // A part of a kit or program: find it through its parent slot.
    const slotPartBox = (id: string): Box | undefined => {
      const p = parts.get(id);
      if (!p) return undefined;
      const parent = p.parent ? parts.get(p.parent) : undefined;
      const k = Number(parent?.props.scaleX ?? 1);
      const [ox, oy] = [Number(parent?.props.x ?? 0), Number(parent?.props.y ?? 0)];
      const [x, y] = [ox + Number(p.props.x ?? 0) * k, oy + Number(p.props.y ?? 0) * k];
      const pts = p.props.points;
      if (Array.isArray(pts)) {
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        const [l, r, t, d] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        return { x: x + ((l + r) / 2) * k, y: y + ((t + d) / 2) * k, w: Math.max(4, (r - l) * k), h: Math.max(4, (d - t) * k) };
      }
      const size = Number(p.props.size ?? 60) * k;
      return { x, y, w: env.measure(String(p.props.text ?? ""), size), h: size * 1.2 };
    };
    const needBox = (id: string, line: number): Box | undefined => {
      const b = boxOf(id);
      if (!b && !fromFailed(id)) report(line, `"${id}" is not on the board at this state.${suggest(id, [...parts.keys(), ...laid.boxes.keys()])}`);
      return b;
    };

    const drawn: Part[] = [];
    const placedLabels: { box: Box; line: number; id: string }[] = [];
    // Everything a label must keep clear of: all text and every solid shape, including the parts of kits and programs.
    const obstacles: Box[] = [...parts.values()].filter((p) => p.kind === "text" || p.props.closed).flatMap((p) => {
      const inSlot = laid.slots.some((x) => p.id.startsWith(`${x.item.id}.`));
      const b = inSlot ? slotPartBox(p.id) : laid.boxes.get(p.id) ?? (p.parent ? laid.boxes.get(p.parent) : undefined);
      return b ? [b] : [];
    });
    const label = (id: string, line: number, text: string, want: { x: number; y: number }[], attrs: Attrs, size = 42 * Math.max(0.8, Math.min(1.2, laid.scale))) => {
      const w = env.measure(text, size);
      const h = size * 1.2;
      const box = (p: { x: number; y: number }) => ({ x: Math.max(w / 2 + 10, Math.min(ctx.width - w / 2 - 10, p.x)), y: Math.max(h, Math.min(ctx.height - h, p.y)), w, h });
      const cost = (b: Box) => [...obstacles, ...placedLabels.map((l) => l.box)].reduce((sum, o) => sum + hits(b, o), 0);
      // A spot pushed back onto the canvas is no longer beside its target, so it counts against that spot.
      const ranked = want.map((p) => ({ b: box(p), p })).map(({ b, p }, i) => ({ b, over: cost(b), c: cost(b) + (Math.abs(b.x - p.x) > 2 ? w * h * 0.25 : 0), i })).sort((a, b) => a.c - b.c || a.i - b.i);
      const best = ranked[0]!;
      if (best.over > 0.3 * w * h) report(line, `There is no free place for "${text}": everything around what it points to is full. Shorten it, or give that thing room with space, a row or a stack.`);
      drawn.push({ id, kind: "text", line, props: { x: round(best.b.x), y: round(best.b.y), text, size: round(size), color: attrs.color ?? "ink", weight: 700 } });
      placedLabels.push({ box: best.b, line, id });
    };
    const addLink = (id: string, a: Box, b: Box, line: number, head: boolean, attrs: Attrs, text?: string) => {
      const len = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
      const curve = (amount: number) => {
        const ctrl = { x: (a.x + b.x) / 2 - uy * amount * len, y: (a.y + b.y) / 2 + ux * amount * len };
        const p0 = edgePoint(a, ctrl, MARK_PAD);
        const p1 = edgePoint(b, ctrl, MARK_PAD);
        const out: number[] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          out.push(round((1 - t) ** 2 * p0.x + 2 * (1 - t) * t * ctrl.x + t * t * p1.x), round((1 - t) ** 2 * p0.y + 2 * (1 - t) * t * ctrl.y + t * t * p1.y));
        }
        return out;
      };
      // Unless told how to curve, a line bends around what lies between its two ends.
      const crossings = (pts: number[]) => {
        let count = 0;
        for (const o of obstacles) {
          if (hits(o, a) > 0.5 * o.w * o.h || hits(o, b) > 0.5 * o.w * o.h) continue;
          for (let i = 2; i + 3 < pts.length; i += 2) {
            if (Math.abs(pts[i]! - o.x) < o.w / 2 + 4 && Math.abs(pts[i + 1]! - o.y) < o.h / 2 + 4) {
              count++;
              break;
            }
          }
        }
        return count;
      };
      const bends = attrs.bend !== undefined ? [number(attrs.bend) ?? 0] : [0, 0.2, -0.2, 0.4, -0.4, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6];
      const offCanvas = (pts: number[]) => pts.some((v, i) => (i % 2 ? false : v < 20 || v > ctx.width - 20));
      const points = bends.map((x) => curve(x)).map((pts, i) => ({ pts, i, c: crossings(pts) + (offCanvas(pts) ? 0.5 : 0) })).sort((x, y) => x.c - y.c || x.i - y.i)[0]!.pts;
      const color = attrs.color ?? "ink";
      const width = number(attrs.strokeWidth ?? "") ?? 6;
      drawn.push({ id, kind: "path", line, props: { points, stroke: color, strokeWidth: width } });
      const tip = (px: number, py: number, qx: number, qy: number, name: string) => {
        const a2 = (Math.atan2(qy - py, qx - px) * 180) / Math.PI;
        drawn.push({ id: name, kind: "path", line, props: { x: round(qx), y: round(qy), rotate: round(a2), points: [-26, -16, 0, 0, -26, 16], stroke: color, strokeWidth: width } });
      };
      if (head) tip(points.at(-4)!, points.at(-3)!, points.at(-2)!, points.at(-1)!, `${id}.head`);
      if (head && attrs.both) tip(points[2]!, points[3]!, points[0]!, points[1]!, `${id}.tail`);
      if (text) {
        const w = env.measure(text, 42);
        const spots = [8, 6, 10, 4, 12].flatMap((i) => [1, -1].flatMap((side) => [34, 70].map((off) => ({ x: points[i * 2]! + side * (-uy * (off + Math.abs(uy) * w * 0.5)), y: points[i * 2 + 1]! + side * ux * off }))));
        const both = union([a, b]);
        const around = [{ x: both.x, y: both.y - both.h / 2 - 30 }, { x: both.x, y: both.y + both.h / 2 + 30 }, { x: both.x + both.w / 2 + w / 2 + 20, y: both.y }, { x: both.x - both.w / 2 - w / 2 - 20, y: both.y }];
        label(`${id}.label`, line, text, [...spots, ...around], attrs);
      }
    };
    laid.links.forEach((l) => {
      const [a, b] = [needBox(l.from, l.line), needBox(l.to, l.line)];
      if (a && b) addLink(`link.${l.from}.${l.to}`, a, b, l.line, true, {});
    });
    for (const c of attached) {
      if (c.do === "arrow") {
        const [a, b] = [needBox(c.from, c.line), needBox(c.to, c.line)];
        colorOk(c.attrs.color, c.line);
        if (a && b) addLink(c.attrs.id ?? `arrow.${c.from}.${c.to}`, a, b, c.line, c.head, c.attrs, c.text);
      }
      if (c.do === "mark") {
        const list = c.targets.map((t) => needBox(t, c.line)).filter((b): b is Box => !!b);
        colorOk(c.attrs.color, c.line);
        if (!list.length) continue;
        const b = union(list);
        const id = c.attrs.id ?? `mark.${c.shape}.${c.targets[0]}`;
        const [l, r, t, d] = [b.x - b.w / 2 - MARK_PAD, b.x + b.w / 2 + MARK_PAD, b.y - b.h / 2 - MARK_PAD, b.y + b.h / 2 + MARK_PAD];
        const color = c.attrs.color ?? "accent";
        const width = number(c.attrs.strokeWidth ?? "") ?? 7;
        const base = { stroke: color, strokeWidth: width };
        const rw = (r - l) * 0.62;
        const rh = (d - t) * 0.72;
        if (c.shape === "ring") drawn.push({ id, kind: "path", line: c.line, props: { ...base, x: round(b.x), y: round(b.y), points: Array.from({ length: 49 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2 - 2) * rw, Math.sin((i / 48) * Math.PI * 2 - 2) * rh]).flat().map(round) } });
        if (c.shape === "box") drawn.push({ id, kind: "path", line: c.line, props: { ...base, points: [l, t, r, t, r, d, l, d, l, t].map(round) } });
        if (c.shape === "underline") drawn.push({ id, kind: "path", line: c.line, props: { ...base, points: [l, d, r, d].map(round) } });
        if (c.shape === "cross") {
          drawn.push({ id, kind: "path", line: c.line, props: { ...base, points: [l, t, r, d].map(round) } });
          drawn.push({ id: `${id}.2`, kind: "path", line: c.line, props: { ...base, points: [l, d, r, t].map(round) } });
        }
        if (c.shape === "brace") {
          const y = d + 8;
          const peak = 22;
          drawn.push({ id, kind: "path", line: c.line, props: { ...base, points: [l, y, l + 14, y + peak * 0.6, b.x - 14, y + peak * 0.6, b.x, y + peak, b.x + 14, y + peak * 0.6, r - 14, y + peak * 0.6, r, y].map(round) } });
        }
        if (c.text) {
          const below = c.shape === "brace" ? d + 70 : c.shape === "ring" ? b.y + rh + 34 : d + 36;
          const above = c.shape === "ring" ? b.y - rh - 34 : t - 36;
          label(`${id}.label`, c.line, c.text, [{ x: b.x, y: below }, { x: b.x, y: above }, { x: b.x + b.w / 2 + 160, y: b.y }, { x: b.x - b.w / 2 - 160, y: b.y }], { color });
        }
      }
      if (c.do === "tag") {
        const b = needBox(c.target, c.line);
        if (!b) continue;
        colorOk(c.attrs.color, c.line);
        const size = number(c.attrs.size ?? "") ?? 42 * Math.max(0.8, Math.min(1.2, laid.scale));
        const w = env.measure(c.text, size);
        const beside = (dist: number): Record<string, Box> => ({
          right: { x: b.x + b.w / 2 + dist + w / 2, y: b.y, w, h: size * 1.2 },
          left: { x: b.x - b.w / 2 - dist - w / 2, y: b.y, w, h: size * 1.2 },
          top: { x: b.x, y: b.y - b.h / 2 - dist - size * 0.6, w, h: size * 1.2 },
          bottom: { x: b.x, y: b.y + b.h / 2 + dist + size * 0.6, w, h: size * 1.2 },
        });
        const options = beside(24);
        const order = (["right", "left", "top", "bottom"] as const).filter((k) => k !== c.attrs.side);
        if (c.attrs.side && !options[c.attrs.side]) {
          report(c.line, `side must be right, left, top or bottom.`);
          continue;
        }
        const id = c.attrs.id ?? `tag.${c.target}`;
        const further = [70, 120].flatMap((d) => (["right", "left", "top", "bottom"] as const).map((k) => beside(d)[k]!));
        label(id, c.line, c.text, [...(c.attrs.side ? [options[c.attrs.side]!] : []), ...order.map((k) => options[k]!), ...further], { color: c.attrs.color ?? "ink" }, size);
      }
    }
    for (const p of drawn) parts.set(p.id, p);

    // Anything addressed by id: a part, a whole row or container, or everything under a prefix.
    const expandTarget = (id: string, line: number): string[] => {
      const hit = laid.members.get(id) ?? [];
      const under = [...parts.keys()].filter((k) => k === id || k.startsWith(`${id}.`));
      const out = [...new Set([...hit.flatMap((m) => [...parts.keys()].filter((k) => k === m || k.startsWith(`${m}.`))), ...under])];
      if (!out.length && !fromFailed(id)) report(line, `"${id}" is not on the board at this state.${suggest(id, [...parts.keys(), ...laid.members.keys()])}`);
      return out;
    };
    // Sends a property to the part that really holds it, so `set a fill=accent` works on a shape with a label.
    const route = (id: string, prop: string): string[] => {
      if (GROUP_PROP.has(prop)) return [id];
      const self = parts.get(id);
      if (self?.kind !== "group") return [id];
      const inner = [...parts.keys()].filter((k) => k.startsWith(`${id}.`));
      if (SHAPE_PROP.has(prop)) return inner.filter((k) => parts.get(k)?.kind === "path");
      return inner.filter((k) => parts.get(k)?.kind === "text");
    };

    const effects = new Map<string, Props>();
    const effect = (id: string, props: Props) => effects.set(id, { ...effects.get(id), ...props });
    const kept = new Set<string>();
    const lightUp = (id: string, color: string) => {
      const p = parts.get(id);
      if (p?.kind === "text") effect(id, { color, weight: 700 });
      if (p?.kind === "path") effect(id, p.props.stroke && p.props.stroke !== "none" ? { stroke: color, strokeWidth: Number(p.props.strokeWidth ?? 6) * 1.5 } : { fill: color });
    };
    const play: NonNullable<Step["play"]> = [];
    const emit: NonNullable<Step["emit"]> = [];
    for (const c of s.commands) {
      if (c.do === "light") {
        colorOk(c.attrs.color, c.line);
        for (const t of c.targets) for (const id of expandTarget(t, c.line)) lightUp(id, c.attrs.color ?? "accent");
      }
      if (c.do === "dim") for (const t of c.targets) for (const id of expandTarget(t, c.line)) if (!parts.get(id)?.parent) effect(id, { opacity: number(c.attrs.amount ?? "") ?? 0.25 });
      if (c.do === "focus") {
        colorOk(c.attrs.color, c.line);
        const lit = new Set(c.targets.flatMap((t) => expandTarget(t, c.line)));
        const touches = (a: Command) => (a.do === "arrow" ? [a.from, a.to] : a.do === "mark" ? a.targets : a.do === "tag" ? [a.target] : []);
        const stays = (id: string) => lit.has(id) || [...lit].some((x) => x.startsWith(`${id}.`) || id.startsWith(`${x}.`));
        // Marks, tags and arrows on a focused thing are part of it.
        for (const a of attached) {
          if (!touches(a).some((t) => [...lit].some((x) => x === t || x.startsWith(`${t}.`)))) continue;
          const name = a.do === "arrow" ? a.attrs.id ?? `arrow.${a.from}.${a.to}` : a.do === "mark" ? a.attrs.id ?? `mark.${a.shape}.${a.targets[0]}` : a.do === "tag" ? a.attrs.id ?? `tag.${a.target}` : "";
          for (const id of parts.keys()) if (id === name || id.startsWith(`${name}.`)) kept.add(id);
        }
        for (const [id, p] of parts) {
          if (lit.has(id)) lightUp(id, c.attrs.color ?? "accent");
          else if (!stays(id) && !kept.has(id) && !(p.parent && !stays(p.parent))) effect(id, { opacity: number(c.attrs.amount ?? "") ?? 0.25 });
        }
      }
      if (c.do === "set") {
        for (const t of c.targets) {
          for (const [prop, raw] of Object.entries(c.attrs)) {
            if (REFUSED_SET.has(prop) || !/^[a-z][A-Za-z0-9]*$/.test(prop)) {
              report(c.line, `set cannot change "${prop}".`);
              continue;
            }
            if (COLOR_PROP.has(prop)) colorOk(raw, c.line);
            const value = number(raw) ?? raw;
            const list = (parts.has(t) ? [t] : expandTarget(t, c.line)).flatMap((id) => route(id, prop));
            for (const id of list) {
              const end = [...mounted.values()].map((m) => m.ends.get(`${id}\u0000${prop}`)).find((x) => x !== undefined);
              if (end !== undefined && at <= end) report(c.line, `${id}.${prop} is being animated by a program until frame ${end}, so set cannot change it at frame ${at}.`);
              overrides.set(id, { ...overrides.get(id), [prop]: value });
            }
          }
        }
      }
      if (c.do === "play") {
        if (!behaviors.has(c.behavior)) {
          report(c.line, `There is no behavior called ${c.behavior}.${suggest(c.behavior, behaviors)} Available: ${[...behaviors].join(", ")}. A program can do anything else.`);
          continue;
        }
        const args = Object.fromEntries(Object.entries(c.attrs).map(([k, v]) => [k, argValue(v, (t) => momentOf(t, c.line))]));
        if (typeof args.color === "string") colorOk(args.color, c.line);
        for (const t of c.targets) {
          const list = parts.has(t) ? [t] : expandTarget(t, c.line).filter((id) => !parts.get(id)?.parent);
          for (const id of list) play.push({ behavior: c.behavior, target: id, args });
        }
      }
      if (c.do === "emit") emit.push({ name: c.name, data: { ...c.attrs } });
    }

    if (problems.length > before) {
      // Keep going to find more problems in later states, but this state cannot become steps.
      for (const [id, p] of parts) if (!live.has(id)) live.set(id, { kind: p.kind, parent: p.parent, props: p.props, alive: true, line: p.line });
      continue;
    }

    // The difference from the last state becomes this state's steps.
    const boardColor = new Set<string>();
    walkAll(board, (i) => {
      if (i.attrs.color) boardColor.add(i.id);
    });
    const move = { ...(s.attrs.move ? { frames: Number(s.attrs.move) } : {}), ...(s.attrs.ease ? { ease: s.attrs.ease as Ease } : {}) };
    const addMain: NodeSpec[] = [];
    const addDraw: NodeSpec[] = [];
    const addQuiet: NodeSpec[] = [];
    const addScaled: NodeSpec[] = [];
    const set: NonNullable<Step["set"]> = {};
    const preset: NonNullable<Step["set"]> = {};
    const remove: string[] = [];
    const drawnIds = new Set(drawn.map((p) => p.id));
    for (const [id, part] of parts) {
      const props: Props = { ...part.props, ...overrides.get(id), ...effects.get(id) };
      // A label on a recolored shape stays readable unless it was given a color of its own.
      const own = part.parent ? parts.get(`${part.parent}.shape`) : undefined;
      if (own && part.kind === "text" && effects.get(id)?.color === undefined && overrides.get(id)?.color === undefined && !boardColor.has(part.parent!)) {
        const fill = overrides.get(own.id)?.fill ?? effects.get(own.id)?.fill ?? own.props.fill;
        if (typeof fill === "string") props.color = readableOn(fill, ctx.theme);
      }
      const was = live.get(id);
      if (was?.alive) {
        for (const [k, v] of Object.entries(props)) {
          if (!same(was.props[k], v)) (set[id] ??= {})[k] = v;
        }
        // A light or dim that ended: go back to the part's own value.
        for (const [k, v] of Object.entries(was.props)) {
          if (props[k] === undefined && typeof v === "number" && k !== "drawn") (set[id] ??= {})[k] = k === "opacity" ? 1 : v;
        }
        was.props = props;
        continue;
      }
      if (was) {
        // Back on the board: it moves while unseen, then appears.
        for (const [k, v] of Object.entries(props)) if (!same(was.props[k], v) && k !== "opacity") (preset[id] ??= {})[k] = v;
        if (!part.parent) (set[id] ??= {}).opacity = typeof props.opacity === "number" ? props.opacity : 1;
        was.props = props;
        was.alive = true;
        continue;
      }
      const spec: NodeSpec = { id, kind: part.kind, props, ...(part.parent ? { parent: part.parent } : {}) };
      live.set(id, { kind: part.kind, parent: part.parent, props, alive: true, line: part.line });
      if (id.includes(".") && mounted.has(id.split(".")[0]!) && part.parent) addQuiet.push(spec);
      else if (mounted.has(id)) addScaled.push(spec);
      else if (Number(props.scaleX ?? 1) !== 1) addScaled.push(spec);
      else if (drawnIds.has(id)) addDraw.push(spec);
      else addMain.push(spec);
    }
    for (const [id, l] of live) {
      if (!l.alive || parts.has(id)) continue;
      l.alive = false;
      if (!(l.parent && !parts.has(l.parent))) remove.push(id);
      overrides.delete(id);
    }
    // Everything arrives first, so anything in this state can act on anything new in it.
    if (Object.keys(preset).length) steps.push({ at: Math.max(0, at - 1), move: { frames: 1 }, set: preset });
    const moved = Object.keys(move).length ? { move } : {};
    if (addScaled.length) steps.push({ at, enter: s.attrs.enter === "none" ? "none" : "fade", add: addScaled });
    if (addMain.length) steps.push({ at, ...moved, ...(s.attrs.enter ? { enter: s.attrs.enter as Step["enter"] } : {}), add: addMain });
    if (addDraw.length) steps.push({ at, ...moved, enter: "draw", add: addDraw });
    if (addQuiet.length) steps.push({ at, enter: "none", add: addQuiet });
    const change: Step = { at, ...moved };
    if (Object.keys(set).length) change.set = set;
    if (remove.length) change.remove = remove;
    if (play.length) change.play = play;
    if (emit.length) change.emit = emit;
    if (Object.keys(change).length > 2 || (!moved.move && Object.keys(change).length > 1)) steps.push(change);
    if (laterPlay.length) steps.push({ at, play: laterPlay });
    laterPlay = [];
  }

  if (problems.length) return { problems: dedupe(problems), stats };

  // Program motion joins through the normal way behaviors do, so the core stays the only thing that writes a scene.
  const byMount = new Map<string, Track[]>();
  for (const t of programTracks) {
    const owner = [...mounted.keys()].find((m) => t.target.startsWith(`${m}.`)) ?? [...mounted.keys()][0]!;
    (byMount.get(owner) ?? byMount.set(owner, []).get(owner)!).push(t);
  }
  for (const [m, tracks] of byMount) kitsMade.behaviors![`program.${m}`] = () => tracks;

  const sceneDoc: SceneDoc = { background: doc.background ?? "paper", steps };
  try {
    const scene = settle(compile(sceneDoc, { ...ctx, kits: [...allKits, kitsMade] }));
    for (const f of [0, Math.floor(ctx.frames / 2), ctx.frames - 1]) evaluate(scene, f);
    stats.parts = scene.nodes.length;
    return { problems: [], doc: sceneDoc, scene, stats };
  } catch (e) {
    return { problems: [{ line: 0, message: `The scene could not be built: ${(e as Error).message}` }], stats };
  }
}

// Behaviors and state changes can both touch a property, and either may run past the other. Put keys in time order, and
// where two land on one frame, the later write wins.
function settle(scene: Scene): Scene {
  for (const t of scene.tracks) {
    const keys = t.keys.map((k, i) => ({ k, i })).sort((a, b) => a.k.at - b.k.at || a.i - b.i).map((x) => x.k);
    t.keys = keys.filter((k, i) => k.at !== keys[i + 1]?.at);
    // A pulse does not exist until it starts, and must not sit at the start of its line until then.
    if (t.prop === "pulse") {
      const start = t.keys.find((k) => k.at > 0 && k.value === 0)?.at;
      if (start !== undefined && t.keys[0]!.value === 0) {
        t.keys[0]!.value = -1;
        if (start > 1) t.keys.splice(1, 0, { at: start - 1, value: -1 });
      }
    }
  }
  return scene;
}

function dedupe(list: Problem[]): Problem[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const key = `${p.line}|${p.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const formatProblems = (list: Problem[]) => list.map((p) => (p.line ? `line ${p.line}: ${p.message}` : p.message)).join("\n");
