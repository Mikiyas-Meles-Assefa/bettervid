// Turns scene language into a scene document, then a scene. Each state is laid out in full, and the difference from the
// state before becomes the steps: new things enter, things with a known id travel, things no longer listed leave.
import { BEHAVIORS } from "../core/behaviors.ts";
import { compile, when } from "../core/compile.ts";
import type { CompileContext, Ease, Kit, NodeSpec, Props, Scene, SceneDoc, Step, Track, Value } from "../core/types.ts";
import { EASES } from "../core/ease.ts";
import { evaluate, sample } from "../core/evaluate.ts";
import { graphKit } from "../kits/graph.ts";
import { truthSteps } from "../kits/steps.ts";
import { estimate, graphPositions, layout, MIN_CONTRAST, readableOn, roundedBox, safeArea, type Box, type Env, type Laid, type Measure, type Part } from "./layout.ts";
import { bestOn, colorOf, isRole, readability, roleLook, styleHas } from "../core/roles.ts";
import { contrast } from "../style/color.ts";
import type { LibraryEntry } from "./library.ts";
import { checkOutput } from "./program.ts";
import { runProgram, type RunResult } from "./sandbox.ts";
import { READ_DEFAULT } from "../style/format.ts";
import { ENTERS, parse, parseTime, suggest, type Attrs, type Command, type Item, type Problem, type State } from "./syntax.ts";

export type BuildOptions = {
  ctx: CompileContext;
  words?: string[]; // the spoken words, for programs that follow the voice
  assets?: Record<string, string>; // image names the scene may use; nothing else can become an image
  library?: LibraryEntry[];
  seed?: number;
  measure?: Measure;
};
// `truth`: each thing a truth kit computed, with its numbered steps, so a writer can bind steps to the words that speak them.
export type BuildResult = { problems: Problem[]; doc?: SceneDoc; scene?: Scene; truth?: { id: string; kind: string; steps: string[] }[]; stats: { states: number; parts: number; programs: number; programMs: number } };
type Live = { kind: string; parent?: string; props: Props; alive: boolean; line: number };

const STATE_ENTERS = ["fade", "draw", "pop", "none"];
// The name an attached thing goes by. A mark at a place inside something is one of many there, so its line tells it apart.
export const attachedId = (c: Command): string =>
  c.do === "arrow" ? c.attrs.id ?? `arrow.${c.from}.${c.to}` : c.do === "mark" ? c.attrs.id ?? `mark.${c.shape}.${c.targets[0]}${c.attrs.at !== undefined ? `.l${c.line}` : ""}` : c.do === "tag" ? c.attrs.id ?? `tag.${c.target}${c.attrs.at !== undefined ? `.l${c.line}` : ""}` : "";
// A list of numbers such as 0.2,0.3,0.6,0.5, or null.
const numbers = (v: string | undefined) => {
  if (v === undefined) return null;
  const list = v.split(",").map(Number);
  return list.length && list.every(Number.isFinite) ? list : null;
};
const COLOR_PROP = new Set(["fill", "stroke", "color", "pulseColor"]);
const GROUP_PROP = new Set(["x", "y", "rotate", "opacity", "scaleX", "scaleY", "skew"]);
const SHAPE_PROP = new Set(["fill", "stroke", "strokeWidth", "drawn", "closed", "smooth"]);
const REFUSED_SET = new Set(["src", "href", "font", "points", "constructor", "prototype"]);
const RESERVED_RUN = new Set(["w", "h", "until", "on", "seed", "at", "into", "before", "after"]);
const MARK_PAD = 14;
// What a property goes back to when nothing sets it any more. Others keep their last value.
const AT_REST: Record<string, number> = { opacity: 1, scaleX: 1, scaleY: 1, rotate: 0, skew: 0, z: 0, layer: 0, glow: 0, blur: 0, brightness: 1, saturation: 1, contrast: 1, hue: 0, tintAmount: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, shadowOpacity: 0 };
// Words made only of emoji and symbols, with no letters or digits: a picture in the system's emoji font, not words.
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{So}\u2190-\u21FF\u2B00-\u2BFF\uFE0F\u200D\s]+$/u;
// A box on screen that the camera and the collision checks care about.
type Seen = { id: string; box: Box; line: number; what: string; text?: string; item?: string; laid: boolean; slot?: string; back?: string; holder?: string; chip?: boolean };
const same = (a: Value | undefined, b: Value | undefined) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.05 : JSON.stringify(a) === JSON.stringify(b));
const number = (s: string) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
const round = (v: number) => Math.round(v * 10) / 10;
const circleAt = (r: number) => Array.from({ length: 25 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2) * r, Math.sin((i / 24) * Math.PI * 2) * r]).flat().map(round);

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
      const w = estimate(String(n.props?.text ?? ""), size, n.props?.font && /mono|courier|menlo/i.test(String(n.props.font)) ? "mono" : undefined);
      // Text grows from where its anchor says: from its x to the right, to the left of it, or around it.
      const from = n.props?.anchor === "start" ? x : n.props?.anchor === "end" ? x - w : x - w / 2;
      xs.push(from, from + w);
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

  const behaviors = new Set([...Object.keys(BEHAVIORS), ...allKits.flatMap((k) => Object.keys(k.behaviors ?? {}))]);
  let quiet = false; // while sizes are worked out ahead, problems wait for the real pass
  const report = (line: number, message: string) => !quiet && problems.length < 40 && problems.push({ line, message });
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

  // Readability: the style says how small text may get and how far dimming may go; a scene may say otherwise for itself.
  const readStyle = { ...READ_DEFAULT, ...ctx.theme.style?.read };
  const readText = number(doc.read?.text ?? "") ?? readStyle.text;
  const readDim = number(doc.read?.dim ?? "") ?? readStyle.dim;
  const minText = readText * Math.min(ctx.width, ctx.height);
  const dimTo = (amount: string | undefined) => Math.min(1, Math.max(readDim, number(amount ?? "") ?? readDim));
  // Text a kit or program makes is drawn at the scale of its slot. None of it may come out smaller than the minimum.
  const readable = (p: Part, k: number): Part => (p.kind === "text" && typeof p.props.size === "number" && p.props.size * k < minText ? { ...p, props: { ...p.props, size: round(minText / k) } } : p);

  const safe = safeArea(ctx.width, ctx.height);
  const expansions = new Map<string, { nodes: NodeSpec[]; box: ReturnType<typeof bounds>; errors: { line: number; message: string }[] }>();

  const expandKit = (item: Item) => {
    const known = expansions.get(item.id);
    if (known) {
      for (const e of known.errors) report(e.line, e.message);
      return known;
    }
    const errors: { line: number; message: string }[] = [];
    const fail = (line: number, message: string) => {
      errors.push({ line, message });
      report(line, message);
    };
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
          fail(item.line, `The setting ${k} of ${item.id} is not valid JSON.`);
        }
      }
      spec = { id: item.id, kind: item.kind, data };
    }
    const expand = (n: NodeSpec): NodeSpec[] => (["group", "path", "text", "image"].includes(n.kind) ? [n] : (kinds[n.kind]?.(n, ctx) ?? []).flatMap(expand));
    let nodes: NodeSpec[] = [];
    try {
      nodes = expand(spec);
    } catch (e) {
      fail(item.line, `${item.kind} ${item.id} failed: ${(e as Error).message}`);
    }
    if (!nodes.some((n) => n.id === item.id)) nodes = [{ id: item.id, kind: "group" }, ...nodes.map((n) => ({ ...n, parent: n.parent ?? item.id }))];
    nodes.sort((a, b) => Number(b.id === item.id) - Number(a.id === item.id));
    const made = { nodes, box: bounds(nodes), errors };
    expansions.set(item.id, made);
    return made;
  };

  const env: Env = {
    W: ctx.width,
    H: ctx.height,
    safe,
    theme: ctx.theme,
    measure: opts.measure ?? estimate,
    minText,
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
  const motion = new Map<string, Track["keys"]>(); // program motion by target and property, for finding moving parts
  const steps: Step[] = [];
  // The camera: where it lands after each change. At rest it shows the frame as laid out.
  type View = { panX: number; panY: number; zoom: number };
  const REST: View = { panX: ctx.width / 2, panY: ctx.height / 2, zoom: 1 };
  let view: View = REST;
  const shots: { at: number; frames: number; ease: Ease; view: View; drift: number; line: number }[] = [];
  // What a view shows, in the scene's own coordinates: the whole frame, and the part of it words may use (inside the
  // edges and above the captions).
  const EDGE = 4;
  const frameIn = (v: View): Box => ({ x: v.panX, y: v.panY, w: ctx.width / v.zoom, h: ctx.height / v.zoom });
  const allowedIn = (v: View): Box => {
    const [l, r, t, d] = [EDGE, ctx.width - EDGE, EDGE, safe.y + safe.h / 2];
    const at = (sx: number, sy: number) => ({ x: v.panX + (sx - ctx.width / 2) / v.zoom, y: v.panY + (sy - ctx.height / 2) / v.zoom });
    const [a, b] = [at(l, t), at(r, d)];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: b.x - a.x, h: b.y - a.y };
  };
  // Things partly in the frame, or in it but under the captions: they would be seen cut.
  const cutBy = (v: View, list: Seen[]) => {
    const f = frameIn(v);
    const a = allowedIn(v);
    return list.filter((w) => {
      const [l, r, t, d] = [w.box.x - w.box.w / 2, w.box.x + w.box.w / 2, w.box.y - w.box.h / 2, w.box.y + w.box.h / 2];
      const seen = r > f.x - f.w / 2 + 1 && l < f.x + f.w / 2 - 1 && d > f.y - f.h / 2 + 1 && t < f.y + f.h / 2 - 1;
      const whole = l >= a.x - a.w / 2 - 1 && r <= a.x + a.w / 2 + 1 && t >= a.y - a.h / 2 - 1 && d <= a.y + a.h / 2 + 1;
      return seen && !whole;
    });
  };

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
          attached = attached.filter((a) => !(((a.do === "arrow" && [attachedId(a), a.from, a.to].includes(id)) || (a.do === "mark" && (attachedId(a) === id || a.targets.includes(id))) || (a.do === "tag" && [attachedId(a), a.target].includes(id)))));
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
      attached = attached.filter((a) => attachedId(a) !== attachedId(c));
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
    for (const t of checked.tracks) motion.set(`${t.target}\u0000${t.prop}`, t.keys);
    for (const e of checked.events) steps.push({ at: e.at, emit: [{ name: e.name, ...(e.data ? { data: e.data } : {}) }] });
    if (checked.tracks.length) laterPlay.push({ behavior: `program.${slotItem.id}`, target: slotItem.id });
  };
  // A program that failed has already been reported. Its parts being missing is not a second problem.
  const failed = new Set<string>();
  const fromFailed = (id: string) => [...failed].some((m) => id === m || id.startsWith(`${m}.`));
  const kitsMade: Kit = { name: "programs", behaviors: {} };
  let laterPlay: NonNullable<Step["play"]> = []; // program motion, played once its parts exist

  // Steady sizes: a plain state and the keep states after it are one stretch, laid out at one scale, the one that fits
  // the fullest of them. Adding a row or an answer then never shrinks what is already there; only the camera zooms.
  quiet = true;
  const fits = doc.states.map((st) => {
    applyState(st);
    return layout(board, env).scale;
  });
  board = [];
  attached = [];
  quiet = false;
  const stretchScale: number[] = [];
  for (let i = 0; i < doc.states.length; ) {
    let j = i + 1;
    while (j < doc.states.length && doc.states[j]!.keep) j++;
    const least = Math.min(...fits.slice(i, j));
    for (let k = i; k < j; k++) stretchScale[k] = least;
    i = j;
  }
  // What was on screen in the state before, for leaving things that would cross entering ones, and the words and marks
  // of every state, for the camera's drift.
  let before = new Map<string, Box>();
  const seenAt: { at: number; list: Seen[] }[] = [];

  for (let index = 0; index < doc.states.length; index++) {
    const s = doc.states[index]!;
    const already = problems.length;
    const at = momentOf(s.at, s.line);
    if (s.attrs.enter && !STATE_ENTERS.includes(s.attrs.enter)) report(s.line, `A state's enter must be one of ${STATE_ENTERS.join(", ")}. Give one thing its own enter= for ${ENTERS.filter((e) => !STATE_ENTERS.includes(e)).join(", ")}.`);
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
      for (const k of ["color", "fill", "stroke", "back"]) colorOk(i.attrs[k], i.line);
      if (i.attrs.enter && !ENTERS.includes(i.attrs.enter)) report(i.line, `enter must be one of ${ENTERS.join(", ")}.${suggest(i.attrs.enter, ENTERS)}`);
      if (i.kind === "image" && !opts.assets?.[i.attrs.asset ?? ""]) report(i.line, `The image ${i.id} needs asset=NAME with a name from the assets list.${opts.assets ? ` Available: ${Object.keys(opts.assets).join(", ") || "none"}.` : " This scene has no assets."}`);
    });

    const laid = layout(board, env, stretchScale[index]);
    problems.push(...laid.problems.slice(0, 6).map((p) => ({ ...p, line: p.line || s.line })));

    // Parts for this state: laid-out parts, then kits and programs in their slots, then everything attached to them.
    const parts = new Map<string, Part>(laid.parts.map((p) => [p.id, p.kind === "image" ? { ...p, props: { ...p.props, src: opts.assets?.[String(p.props.src)] ?? "" } } : p]));
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
        for (const p of m.parts) parts.set(p.id, readable(p, k));
        continue;
      }
      const { nodes, box: b } = expandKit(item);
      const k = Math.min(box.w / b.w, box.h / b.h);
      for (const n of nodes) {
        const root = n.id === item.id;
        parts.set(n.id, readable({ ...n, props: root ? { ...n.props, x: round(box.x - b.x * k), y: round(box.y - b.y * k), scaleX: k, scaleY: k } : { ...(n.props ?? {}) }, line: item.line }, root ? 1 : k));
      }
    }

    const boxOf = (id: string): Box | undefined => laid.boxes.get(id) ?? (() => {
      const m = laid.members.get(id);
      const list = m?.map((x) => laid.boxes.get(x)).filter((b): b is Box => !!b);
      return list?.length ? union(list) : undefined;
    })() ?? slotPartBox(id);
    // A part of a kit or program: where it really is at this moment, following its parents and any program motion.
    const valueAt = (id: string, prop: string) => {
      const keys = motion.get(`${id}\u0000${prop}`);
      return Number(keys ? sample(keys, at) : (parts.get(id)?.props[prop] ?? 0));
    };
    const slotPartBox = (id: string): Box | undefined => {
      const p = parts.get(id);
      if (!p) return undefined;
      if (p.kind === "group") {
        const inner = [...parts.values()].filter((q) => q.parent === id).map((q) => slotPartBox(q.id)).filter((b): b is Box => !!b);
        return inner.length ? union(inner) : undefined;
      }
      let [x, y, k] = [valueAt(id, "x"), valueAt(id, "y"), 1];
      for (let up = p.parent ? parts.get(p.parent) : undefined; up; up = up.parent ? parts.get(up.parent) : undefined) {
        const scale = Number(up.props.scaleX ?? 1);
        [x, y, k] = [valueAt(up.id, "x") + x * scale, valueAt(up.id, "y") + y * scale, k * scale];
      }
      const moving = motion.get(`${id}\u0000points`);
      const pts = moving ? sample(moving, at) : p.props.points;
      if (Array.isArray(pts)) {
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        const [l, r, t, d] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        return { x: x + ((l + r) / 2) * k, y: y + ((t + d) / 2) * k, w: Math.max(4, (r - l) * k), h: Math.max(4, (d - t) * k) };
      }
      const size = Number(p.props.size ?? 60) * k;
      // Text grows from its anchor: to the right of x, to the left of it, or around it.
      const w = env.measure(String(p.props.text ?? ""), size, typeof p.props.font === "string" && /mono|menlo|courier/i.test(p.props.font) ? "mono" : undefined);
      return { x: p.props.anchor === "start" ? x + w / 2 : p.props.anchor === "end" ? x - w / 2 : x, y, w, h: size * 1.2 };
    };
    const needBox = (id: string, line: number): Box | undefined => {
      const b = boxOf(id);
      if (!b && !fromFailed(id)) report(line, `"${id}" is not on the board at this state.${suggest(id, [...parts.keys(), ...laid.boxes.keys()])}`);
      return b;
    };
    // A share of a thing's box, from its top left (0,0) to its bottom right (1,1): x,y pairs in its own coordinates.
    const pointsIn = (b: Box, list: number[]) => list.map((v, i) => (i % 2 ? b.y - b.h / 2 + v * b.h : b.x - b.w / 2 + v * b.w));
    const spanOf = (pts: number[]): Box => {
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const [l, r, t, d] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      return { x: (l + r) / 2, y: (t + d) / 2, w: r - l, h: d - t };
    };
    const atList = (raw: string | undefined, line: number, need?: number): number[] | null | undefined => {
      if (raw === undefined) return undefined;
      const list = numbers(raw);
      if (!list || list.length < 2 || list.length % 2 || (need && list.length !== need) || list.some((v) => v < -0.5 || v > 1.5)) {
        report(line, `at= is ${need === 4 ? "two corners" : "a list of x,y points"} inside the thing, each a share of it from its top left (0,0) to its bottom right (1,1), as in at=0.2,0.3,0.6,0.5. It reads ${raw}.`);
        return null;
      }
      return list;
    };
    const images = [...parts.values()].filter((p) => p.kind === "image").map((p) => laid.boxes.get(p.id)).filter((b): b is Box => !!b);
    const fillers: Box[] = [];
    walkAll(board, (i) => {
      const b = i.kind === "image" && i.attrs.frame === "fill" ? laid.boxes.get(i.id) : undefined;
      if (b) fillers.push(b);
    });

    // The camera. It frames a thing, or a place inside it, in the part of the frame clear of captions. It never shows past
    // the edges of a picture that fills the frame. A plain state starts from rest unless it moves the camera itself.
    const cameraAt = s.cut ? at - 1 : at;
    const cams = s.commands.filter((c) => c.do === "camera");
    if (cams.length > 1) report(cams[1]!.line, `A state can move the camera once. Use another state for the next move.`);
    const cam = cams[0];
    let next: View | undefined;
    let region: Box | undefined; // what the camera frames this state
    const clampView = (v: View): View => {
      let { panX, panY, zoom } = v;
      const b = fillers.at(-1);
      if (b) {
        zoom = Math.max(zoom, ctx.width / b.w, ctx.height / b.h);
        const [hw, hh] = [ctx.width / (2 * zoom), ctx.height / (2 * zoom)];
        panX = Math.min(Math.max(panX, b.x - b.w / 2 + hw), b.x + b.w / 2 - hw);
        panY = Math.min(Math.max(panY, b.y - b.h / 2 + hh), b.y + b.h / 2 - hh);
      }
      return { panX: round(panX), panY: round(panY), zoom: Math.round(zoom * 10000) / 10000 };
    };
    if (cam) {
      const zoomBy = cam.attrs.zoom === undefined ? 1 : number(cam.attrs.zoom);
      if (zoomBy === null || zoomBy <= 0 || zoomBy > 20) report(cam.line, `camera zoom is how much closer than the framing, such as 1.2, not ${cam.attrs.zoom}.`);
      if (cam.attrs.ease && !(cam.attrs.ease in EASES)) report(cam.line, `ease must be one of ${Object.keys(EASES).join(", ")}.`);
      if (cam.attrs.frames !== undefined && !(Number(cam.attrs.frames) > 0)) report(cam.line, `camera frames is how many frames the move takes.`);
      if (cam.attrs.drift !== undefined && number(cam.attrs.drift) === null) report(cam.line, `camera drift is how much closer it keeps pushing each second after it lands, such as 0.02.`);
      if (!cam.target) next = clampView({ ...REST, zoom: zoomBy ?? 1 });
      else {
        const b = needBox(cam.target, cam.line);
        const corners = atList(cam.attrs.at, cam.line, 4);
        if (b && corners !== null) {
          const r = corners ? spanOf(pointsIn(b, corners)) : b;
          region = r;
          const fit = Math.min(safe.w / Math.max(1, r.w), safe.h / Math.max(1, r.h));
          const z = Math.max(fit, ...fillers.slice(-1).map((f) => Math.max(ctx.width / f.w, ctx.height / f.h))) * (zoomBy ?? 1);
          next = clampView({ panX: r.x, panY: r.y - (safe.y - ctx.height / 2) / z, zoom: z });
        }
      }
    } else if (!s.keep && view !== REST) next = REST;
    if (next) {
      const frames = s.cut ? 1 : number(cam?.attrs.frames ?? "") ?? number(s.attrs.move ?? "") ?? Math.max(ctx.theme.moveFrames, Math.round(ctx.fps * 0.8));
      shots.push({ at: cameraAt, frames, ease: (cam?.attrs.ease as Ease) ?? "smooth", view: next, drift: number(cam?.attrs.drift ?? "") ?? 0, line: cam?.line ?? s.line });
      view = next;
    }
    // Words and marks are sized for the screen, so a closer camera does not blow them up.
    const z = view.zoom;
    const labelSize = Math.max(minText * 1.25, 42 * Math.max(0.8, Math.min(1.2, laid.scale))) / z;

    const drawn: Part[] = [];
    const popped = new Map<string, string>(); // things that pop on, by group: the dots of one mark pop one after another
    const placedLabels: { box: Box; line: number; id: string }[] = [];
    const drawnWords: Seen[] = []; // attached words as they land, in the frame's coordinates
    // Words that kits and programs drew, where they really are now.
    const slotWords: Seen[] = [...parts.values()].filter((p) => p.kind === "text" && laid.slots.some((x) => p.id.startsWith(`${x.item.id}.`))).flatMap((p) => {
      const b = slotPartBox(p.id);
      const slot = laid.slots.find((x) => p.id.startsWith(`${x.item.id}.`))!.item.id;
      return b ? [{ id: p.id, box: b, line: p.line, what: "text", text: String(p.props.text ?? ""), laid: false, slot }] : [];
    });
    const laidWords: Seen[] = laid.texts.map((t) => ({ id: t.id, box: t.box, line: t.line, what: "text", text: t.text, item: t.item, laid: true, ...(t.back ? { back: t.back } : {}) }));
    // Everything a label must keep clear of: all text and every solid shape, including the parts of kits and programs.
    // What sits behind everything (a picture or color filling the frame, a panel) is not in the way.
    const obstacles: Box[] = [...parts.values()].filter((p) => (p.kind === "text" || p.props.closed) && !(Number(p.props.z) < 0) && !(p.parent && Number(parts.get(p.parent)?.props.z) < 0)).flatMap((p) => {
      const inSlot = laid.slots.some((x) => p.id.startsWith(`${x.item.id}.`));
      const b = inSlot ? slotPartBox(p.id) : laid.boxes.get(p.id) ?? (p.parent ? laid.boxes.get(p.parent) : undefined);
      return b ? [b] : [];
    });
    // Words over a picture sit on a small card, so they read on any photo. `back=` picks its color, `back=none` drops it.
    const onPicture = (b: Box) => images.some((i) => hits(b, i) > 0.2 * b.w * b.h);
    // An attached thing's role, if it names one; marks and arrows take the style's pointer look when it has one.
    const roleOf = (attrs: Attrs, pointer = false) => (isRole(attrs.role) ? roleLook(ctx.theme, attrs.role) : pointer && styleHas(ctx.theme, "pointer") ? roleLook(ctx.theme, "pointer") : undefined);
    const captionBack = roleLook(ctx.theme, "caption").back ?? "paper";
    const chipOf = (b: Box, attrs: Attrs) => (attrs.back === "none" ? undefined : attrs.back ?? roleOf(attrs)?.back ?? (onPicture(b) ? captionBack : undefined));
    const words = (id: string, line: number, text: string, at: { x: number; y: number }, size: number, attrs: Attrs, chip: string | undefined, parent?: string) => {
      // A pointer is drawn, not typed: an emoji comes out small, in the system's emoji font, and off the style.
      if (EMOJI_ONLY.test(text)) report(line, `"${text}" is only emoji or symbols. To point at something use mark pointer ID side=top (or an arrow); attached words are for words. If a picture of an emoji is really wanted, give it its own line of text at size big or larger.`);
      const look = roleOf(attrs);
      const w = env.measure(text, size);
      if (chip) {
        const [pw, ph] = [w + size * 0.9, size * 1.55];
        drawn.push({ id: `${id}.back`, kind: "path", line, ...(parent ? { parent } : {}), props: { x: round(at.x), y: round(at.y), points: roundedBox(pw, ph, ph * 0.18).map(round), closed: 1, fill: chip, stroke: "none", rotate: -1.5, shadowY: round(size * 0.08), shadowBlur: round(size * 0.25), shadowOpacity: 0.35, shadowColor: "#000000" } });
      }
      const own = look?.color && (!chip || readability(ctx.theme, look.color, chip) >= MIN_CONTRAST) ? look.color : undefined;
      const color = attrs.color ?? own ?? (chip ? readableOn(chip, ctx.theme) : "ink");
      const font: Props = look?.font === "title" ? { font: ctx.theme.fonts.title } : look?.font === "mono" ? { font: ctx.theme.fonts.mono ?? "Menlo, monospace" } : {};
      const shown = look?.case === "upper" ? text.toUpperCase() : text;
      drawn.push({ id, kind: "text", line, ...(parent ? { parent } : {}), props: { x: round(at.x), y: round(at.y), text: shown, size: round(size), color, weight: look?.weight ?? 700, ...font, ...(chip ? { rotate: -1.5 } : {}) } });
      const holder = parent ? boxOf(parent) : undefined;
      const abs = holder ? { x: holder.x + at.x, y: holder.y + at.y } : at;
      drawnWords.push({ id, box: { x: abs.x, y: abs.y, w, h: size * 1.15 }, line, what: "text", text, laid: false, ...(chip ? { back: chip, chip: true } : {}), ...(parent ? { holder: parent } : {}) });
    };
    const label = (id: string, line: number, text: string, want: { x: number; y: number }[], attrs: Attrs, size = labelSize) => {
      const w = env.measure(text, size);
      const h = size * 1.2;
      // Attached words stay in the safe area, clear of the captions, however far out their target is.
      const box = (p: { x: number; y: number }) => ({ x: Math.max(w / 2 + 10, Math.min(ctx.width - w / 2 - 10, p.x)), y: Math.max(safe.y - safe.h / 2 + h / 2, Math.min(safe.y + safe.h / 2 - h / 2, p.y)), w, h });
      const inWords = (b: Box) => [...laidWords, ...slotWords].reduce((sum, o) => sum + hits(b, o.box), 0);
      // Covering words costs most, since then neither can be read; covering a shape costs less, as words can sit on a card.
      const cost = (b: Box) => [...obstacles, ...placedLabels.map((l) => l.box)].reduce((sum, o) => sum + hits(b, o), 0) + inWords(b) * 2;
      // A spot pushed back onto the canvas is no longer beside its target, so it counts against that spot.
      const ranked = want.map((p) => ({ b: box(p), p })).map(({ b, p }, i) => ({ b, over: cost(b), c: cost(b) + (Math.abs(b.x - p.x) > 2 || Math.abs(b.y - p.y) > 2 ? w * h * 0.25 : 0), i })).sort((a, b) => a.c - b.c || a.i - b.i);
      const best = ranked[0]!;
      // With no free place, the words sit on a card over what they cover, so they still read. Words on top of other
      // words are a problem, because then neither can be read.
      const onLabels = placedLabels.reduce((sum, l) => sum + hits(best.b, l.box), 0);
      if (onLabels > 0.3 * w * h) report(line, `"${text}" would sit on top of other attached words, because everything around what it points to is full. Shorten it, drop an earlier tag or mark label, or give that thing room with space, a row or a stack.`);
      else if (inWords(best.b) > 0.15 * w * h) {
        const under = [...laidWords, ...slotWords].find((o) => hits(best.b, o.box) > 0.05 * w * h);
        report(line, `"${text}" would sit on top of the words "${under?.text ?? ""}", because everything around what it points to is full. Shorten it, attach it to the other side with side=, drop something, or give that thing room with space, a row or a stack.`);
      }
      const crowded = best.over > 0.3 * w * h && attrs.back !== "none";
      words(id, line, text, best.b, size, attrs, chipOf(best.b, attrs) ?? (crowded ? captionBack : undefined));
      placedLabels.push({ box: best.b, line, id });
    };
    const addLink = (id: string, a: Box, b: Box, line: number, head: boolean, attrs: Attrs, text?: string) => {
      if (a === b || (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1)) {
        // From a thing to itself: a turn around it, as for something spinning or returning to where it began.
        const [rx, ry] = [a.w / 2 + MARK_PAD * 2.5, a.h / 2 + MARK_PAD * 2.5];
        const pts = Array.from({ length: 31 }, (_, i) => {
          const t = ((200 + (i / 30) * 280) * Math.PI) / 180;
          return [round(a.x + Math.cos(t) * rx), round(a.y + Math.sin(t) * ry)];
        }).flat();
        const color = attrs.color ?? roleOf(attrs, true)?.color ?? "ink";
        const width = (number(attrs.strokeWidth ?? "") ?? 6) * (roleOf(attrs, true)?.stroke ?? 1);
        drawn.push({ id, kind: "path", line, props: { points: pts, stroke: color, strokeWidth: width, smooth: 1 } });
        if (head) {
          const [px, py, qx, qy] = pts.slice(-4) as [number, number, number, number];
          drawn.push({ id: `${id}.head`, kind: "path", line, props: { x: qx, y: qy, rotate: round((Math.atan2(qy - py, qx - px) * 180) / Math.PI), points: [-26, -16, 0, 0, -26, 16], stroke: color, strokeWidth: width } });
        }
        if (text) label(`${id}.label`, line, text, [{ x: a.x, y: a.y - ry - 40 }, { x: a.x + rx + 120, y: a.y }, { x: a.x, y: a.y + ry + 40 }, { x: a.x - rx - 120, y: a.y }], attrs);
        return;
      }
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
      const color = attrs.color ?? roleOf(attrs, true)?.color ?? "ink";
      const width = (number(attrs.strokeWidth ?? "") ?? 6) * (roleOf(attrs, true)?.stroke ?? 1);
      drawn.push({ id, kind: "path", line, props: { points, stroke: color, strokeWidth: width } });
      const tip = (px: number, py: number, qx: number, qy: number, name: string) => {
        const a2 = (Math.atan2(qy - py, qx - px) * 180) / Math.PI;
        drawn.push({ id: name, kind: "path", line, props: { x: round(qx), y: round(qy), rotate: round(a2), points: [-26, -16, 0, 0, -26, 16], stroke: color, strokeWidth: width } });
      };
      if (head) tip(points.at(-4)!, points.at(-3)!, points.at(-2)!, points.at(-1)!, `${id}.head`);
      if (head && attrs.both) tip(points[2]!, points[3]!, points[0]!, points[1]!, `${id}.tail`);
      if (text) {
        const w = env.measure(text, labelSize);
        const spots = [8, 6, 10, 4, 12].flatMap((i) => [1, -1].flatMap((side) => [34, 70].map((off) => ({ x: points[i * 2]! + side * (-uy * (off + Math.abs(uy) * w * 0.5)), y: points[i * 2 + 1]! + side * ux * off }))));
        const both = union([a, b]);
        const around = [{ x: both.x, y: both.y - both.h / 2 - 30 }, { x: both.x, y: both.y + both.h / 2 + 30 }, { x: both.x + both.w / 2 + w / 2 + 20, y: both.y }, { x: both.x - both.w / 2 - w / 2 - 20, y: both.y }];
        label(`${id}.label`, line, text, [...spots, ...around], attrs);
      }
    };
    // Something attached in an earlier state leaves with the thing it touches.
    const inherited = (c: Command) => c.line < s.line;
    attached = attached.filter((c) => {
      if (!inherited(c)) return true;
      const ends = c.do === "arrow" ? [c.from, c.to] : c.do === "mark" ? c.targets : c.do === "tag" ? [c.target] : [];
      return ends.every((id) => boxOf(id));
    });
    laid.links.forEach((l) => {
      const [a, b] = [needBox(l.from, l.line), needBox(l.to, l.line)];
      if (a && b) addLink(`link.${l.from}.${l.to}`, a, b, l.line, true, {});
    });
    for (const c of attached) {
      if (c.do === "arrow") {
        const [a, b] = [needBox(c.from, c.line), needBox(c.to, c.line)];
        colorOk(c.attrs.color, c.line);
        if (a && b) addLink(attachedId(c), a, b, c.line, c.head, c.attrs, c.text);
      }
      if (c.do === "mark") {
        colorOk(c.attrs.color, c.line);
        const at = atList(c.attrs.at, c.line);
        if (at === null) continue;
        const list = c.targets.map((t) => needBox(t, c.line)).filter((b): b is Box => !!b);
        if (!list.length) continue;
        const whole = union(list);
        const id = attachedId(c);
        // A mark at a place inside a picture is drawn into the picture: it moves, scales and leaves with it, and it keeps
        // its size on screen and a soft shadow, so it reads on any photo however close the camera is.
        const holder = at && parts.get(c.targets[0]!)?.kind === "image" ? c.targets[0]! : undefined;
        const pts = at ? pointsIn(whole, at) : undefined;
        const b = pts ? (pts.length >= 4 ? spanOf(pts) : { x: pts[0]!, y: pts[1]!, w: 0, h: 0 }) : whole;
        const pad = at ? (holder ? 22 / z : 18) : MARK_PAD;
        const [l, r, t, d] = [b.x - b.w / 2 - pad, b.x + b.w / 2 + pad, b.y - b.h / 2 - pad, b.y + b.h / 2 + pad];
        const role = roleOf(c.attrs, c.shape !== "highlight");
        const color = c.attrs.color ?? role?.color ?? (c.shape === "highlight" ? "highlight" : "accent");
        const width = ((number(c.attrs.strokeWidth ?? "") ?? (holder ? 9 : 7)) * (role?.stroke ?? 1)) / (holder ? z : 1);
        const shade: Props = holder ? { shadowY: round(2 / z), shadowBlur: round(5 / z), shadowOpacity: 0.45, shadowColor: "#000000" } : {};
        const [ox, oy] = holder ? [whole.x, whole.y] : [0, 0];
        const local = (list: number[]) => list.map((v, i) => round(v - (i % 2 ? oy : ox)));
        const add = (pid: string, props: Props) => drawn.push({ id: pid, kind: "path", line: c.line, ...(holder ? { parent: holder } : {}), props: { stroke: color, strokeWidth: width, ...shade, ...props, ...(props.x !== undefined ? { x: round(Number(props.x) - ox), y: round(Number(props.y) - oy) } : {}), ...(props.points && props.x === undefined ? { points: local(props.points as number[]) } : {}) } });
        const rw = at ? (r - l) / 2 : (r - l) * 0.62;
        const rh = at ? (d - t) / 2 : (d - t) * 0.72;
        // A ring runs a little past a full turn, the way a hand closes a circle.
        if (c.shape === "ring") add(id, { x: b.x, y: b.y, points: Array.from({ length: 53 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2 - 2) * rw * (1 + i * 0.0008), Math.sin((i / 48) * Math.PI * 2 - 2) * rh]).flat().map(round) });
        if (c.shape === "box") add(id, { points: [l, t, r, t, r, d, l, d, l, t].map(round) });
        if (c.shape === "underline") add(id, { points: (pts && pts.length >= 4 ? pts : [l, d, r, d]).map(round) });
        if (c.shape === "line" || c.shape === "path") add(id, { points: pts!.map(round), ...(c.shape === "path" ? { smooth: 1 } : {}) });
        if (c.shape === "arrow" && pts!.length >= 4) {
          add(id, { points: pts!.map(round) });
          const [px, py, qx, qy] = pts!.slice(-4) as [number, number, number, number];
          const k = 1 / (holder ? z : 1);
          add(`${id}.head`, { x: qx, y: qy, rotate: round((Math.atan2(qy - py, qx - px) * 180) / Math.PI), points: [-34 * k, -22 * k, 0, 0, -34 * k, 22 * k].map(round) });
        }
        if (c.shape === "dots") {
          const rad = 14 / (holder ? z : 1);
          for (let i = 0; i + 1 < pts!.length; i += 2) {
            const did = i ? `${id}.${i / 2 + 1}` : id;
            add(did, { x: pts![i]!, y: pts![i + 1]!, points: circleAt(rad), closed: 1, fill: color, stroke: "paper", strokeWidth: round(3 / (holder ? z : 1)) });
            popped.set(did, id);
          }
        }
        if (c.shape === "highlight") {
          // On words, a band of color is swept under each line; elsewhere it lies across the place, see-through.
          const lines = !at ? [...parts.values()].filter((p) => p.kind === "text" && p.parent === c.targets[0] && c.targets.length === 1) : [];
          if (lines.length) {
            lines.forEach((p, i) => {
              const size = Number(p.props.size ?? 60);
              const w = env.measure(String(p.props.text ?? ""), size);
              const x0 = Number(p.props.x ?? 0) - (p.props.anchor === "start" ? 0 : p.props.anchor === "end" ? w : w / 2);
              drawn.push({ id: i ? `${id}.${i + 1}` : id, kind: "path", line: c.line, parent: c.targets[0]!, props: { points: [x0 - size * 0.15, Number(p.props.y ?? 0), x0 + w + size * 0.15, Number(p.props.y ?? 0)].map(round), stroke: color, strokeWidth: round(size * 0.82), lineCap: "butt", strokeOpacity: 0.85, z: -1 } });
            });
          } else add(id, { points: [l, b.y, r, b.y].map(round), strokeWidth: round(Math.max(b.h + pad, 12)), lineCap: "butt", strokeOpacity: 0.45 });
        }
        if (c.shape === "pointer") {
          // A short arrow from one side, pointing at the thing: on the side asked for, else the side with the most room.
          const len = Math.max(minText * 2.4, 110) / z;
          const gap = 16 / z;
          const tipOf = (side: string): [number, number] => (side === "top" ? [b.x, t - gap] : side === "bottom" ? [b.x, d + gap] : side === "left" ? [l - gap, b.y] : [r + gap, b.y]);
          const tailOf = (side: string, [x, y]: [number, number]): [number, number] => (side === "top" ? [x, y - len] : side === "bottom" ? [x, y + len] : side === "left" ? [x - len, y] : [x + len, y]);
          const sides = c.attrs.side ? [c.attrs.side] : ["top", "bottom", "left", "right"];
          const ranked = sides.map((side, i) => {
            const tip = tipOf(side);
            const tail = tailOf(side, tip);
            const span = spanOf([...tip, ...tail]);
            const lane = { ...span, w: Math.max(span.w, 30 / z), h: Math.max(span.h, 30 / z) };
            const off = tail[0] < 10 || tail[0] > ctx.width - 10 || tail[1] < safe.y - safe.h / 2 || tail[1] > safe.y + safe.h / 2;
            return { side, tip, tail, i, c: [...obstacles, ...placedLabels.map((p) => p.box)].reduce((sum, o) => sum + hits(lane, o), 0) + (off ? 1e9 : 0) };
          }).sort((x, y) => x.c - y.c || x.i - y.i);
          const { side, tip, tail } = ranked[0]!;
          const k = 1 / z;
          add(id, { points: [...tail, ...tip].map(round), strokeWidth: Math.max(width, 8 / z) });
          add(`${id}.head`, { x: tip[0], y: tip[1], rotate: round((Math.atan2(tip[1] - tail[1], tip[0] - tail[0]) * 180) / Math.PI), points: [-32 * k, -22 * k, 0, 0, -32 * k, 22 * k].map(round), strokeWidth: Math.max(width, 8 / z) });
          placedLabels.push({ box: { ...spanOf([...tip, ...tail]), w: Math.max(30 / z, Math.abs(tip[0] - tail[0])), h: Math.max(30 / z, Math.abs(tip[1] - tail[1])) }, line: c.line, id });
          if (c.text) {
            const away = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side as "top"]!;
            const w = env.measure(c.text, labelSize);
            label(`${id}.label`, c.line, c.text, [{ x: tail[0] + away[0]! * (w / 2 + 12), y: tail[1] + away[1]! * labelSize * 0.8 }], { color });
          }
          continue;
        }
        if (c.shape === "cross") {
          add(id, { points: [l, t, r, d].map(round) });
          add(`${id}.2`, { points: [l, d, r, t].map(round) });
        }
        if (c.shape === "brace") {
          const y = d + 8;
          const peak = 22;
          add(id, { points: [l, y, l + 14, y + peak * 0.6, b.x - 14, y + peak * 0.6, b.x, y + peak, b.x + 14, y + peak * 0.6, r - 14, y + peak * 0.6, r, y].map(round) });
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
        if (c.attrs.back && c.attrs.back !== "none") colorOk(c.attrs.back, c.line);
        const own = roleOf(c.attrs)?.size;
        const size = Math.max(minText / z, number(c.attrs.size ?? "") ?? (own ? (own * Math.min(ctx.width, ctx.height)) / z : labelSize));
        const id = attachedId(c);
        const at = atList(c.attrs.at, c.line, 2);
        if (at === null) continue;
        if (at) {
          // At a point inside the thing. Inside a picture it belongs to the picture, and sits on a card unless told not to.
          const [x, y] = pointsIn(b, at) as [number, number];
          const holder = parts.get(c.target)?.kind === "image" ? c.target : undefined;
          const chip = c.attrs.back === "none" ? undefined : c.attrs.back ?? (holder || onPicture({ x, y, w: 1, h: 1 }) ? "paper" : undefined);
          words(id, c.line, c.text, holder ? { x: x - b.x, y: y - b.y } : { x, y }, size, c.attrs, chip, holder);
          if (holder) popped.set(id, "").set(`${id}.back`, "");
          continue;
        }
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
        const further = [70, 120].flatMap((d) => (["right", "left", "top", "bottom"] as const).map((k) => beside(d)[k]!));
        label(id, c.line, c.text, [...(c.attrs.side ? [options[c.attrs.side]!] : []), ...order.map((k) => options[k]!), ...further], c.attrs, size);
      }
    }
    for (const p of drawn) parts.set(p.id, p);

    // What is behind words: their panel or shape, else a picture or a field of color under them, else the surface.
    const surface = doc.background ?? "paper";
    const behind = (w: Seen): string => {
      if (w.back) return w.back;
      const area = Math.max(1, w.box.w * w.box.h);
      const under = laid.fields.filter((f) => hits(w.box, f.box) > 0.3 * area);
      const f = under.filter((x) => x.picture && !x.frame).at(-1) ?? under.at(-1);
      return f?.picture ? `picture:${f.id}` : f?.fill ?? surface;
    };
    const wordsById = new Map([...laidWords, ...drawnWords].map((w) => [w.id, w]));

    // The camera keeps words whole: words partly in the frame, or under the captions, are cut. A camera that moves in
    // this state shifts as little as it must so each cut thing is wholly in or wholly out, keeping what it frames.
    const keyWords = [...laidWords, ...slotWords, ...drawnWords].filter((w) => Number(parts.get(w.id)?.props.opacity ?? 1) > 0.05);
    let cut = cutBy(view, keyWords);
    // Words tagged at a point slide along, as far as the point stays under them, to sit whole inside the view.
    for (const w of cut) {
      if (w.laid || w.slot || placedLabels.some((l) => l.id === w.id)) continue;
      const a = allowedIn(view);
      const dx = Math.min(Math.max(0, a.x - a.w / 2 - (w.box.x - w.box.w / 2)), w.box.w * 0.45) || -Math.min(Math.max(0, w.box.x + w.box.w / 2 - (a.x + a.w / 2)), w.box.w * 0.45);
      const dy = Math.min(Math.max(0, a.y - a.h / 2 - (w.box.y - w.box.h / 2)), w.box.h * 0.45) || -Math.min(Math.max(0, w.box.y + w.box.h / 2 - (a.y + a.h / 2)), w.box.h * 0.45);
      const moved = { ...w.box, x: w.box.x + dx, y: w.box.y + dy };
      if (cutBy(view, [{ ...w, box: moved }]).length) continue;
      for (const id of [w.id, `${w.id}.back`]) {
        const p = parts.get(id);
        if (p) parts.set(id, { ...p, props: { ...p.props, x: round(Number(p.props.x ?? 0) + dx), y: round(Number(p.props.y ?? 0) + dy) } });
      }
      w.box = moved;
    }
    cut = cutBy(view, keyWords);
    if (cut.length && cam && next && region) {
      let v = view;
      const cover = (x: View) => hits(region, allowedIn(x)) / Math.max(1, region.w * region.h);
      const want = cover(v);
      for (let round = 0; round < 8 && cut.length; round++) {
        const f = frameIn(v);
        const a = allowedIn(v);
        const options: [number, number][] = [];
        for (const w of cut) {
          const [l, r, t, d] = [w.box.x - w.box.w / 2, w.box.x + w.box.w / 2, w.box.y - w.box.h / 2, w.box.y + w.box.h / 2];
          if (r - l <= a.w && d - t <= a.h) options.push([l < a.x - a.w / 2 ? l - (a.x - a.w / 2) : r > a.x + a.w / 2 ? r - (a.x + a.w / 2) : 0, t < a.y - a.h / 2 ? t - (a.y - a.h / 2) : d > a.y + a.h / 2 ? d - (a.y + a.h / 2) : 0]);
          options.push([r - (f.x - f.w / 2) + 1, 0], [l - (f.x + f.w / 2) - 1, 0], [0, d - (f.y - f.h / 2) + 1], [0, t - (f.y + f.h / 2) - 1]);
        }
        const tried = options.map(([dx, dy]) => clampView({ ...v, panX: v.panX + dx, panY: v.panY + dy })).filter((x) => cover(x) >= want * 0.85).map((x) => ({ x, left: cutBy(x, keyWords).length, move: Math.hypot(x.panX - v.panX, x.panY - v.panY) })).filter((o) => o.left < cut.length).sort((p, q) => p.left - q.left || p.move - q.move);
        if (!tried.length) break;
        v = tried[0]!.x;
        cut = cutBy(v, keyWords);
      }
      if (v !== view) {
        view = v;
        shots.at(-1)!.view = v;
      }
    }
    for (const w of cut) report(w.line, `With the camera where it is at this state, "${w.text}" is cut off at the edge of the frame or sits under the captions. Frame a place that holds it whole or leaves it out, or move or drop it.`);
    seenAt.push({ at, list: keyWords });

    // Anything addressed by id: a part, a whole row or container, or everything under a prefix.
    const expandTarget = (id: string, line: number): string[] => {
      const hit = laid.members.get(id) ?? [];
      const under = [...parts.keys()].filter((k) => k === id || k.startsWith(`${id}.`));
      for (const k of [...under]) for (const q of parts.values()) if (q.parent === k && !under.includes(q.id)) under.push(q.id); // a group a program made
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
    // Light with no color takes the style's key color, or whichever strong color reads on what is behind the words.
    const key = roleLook(ctx.theme, "key").color ?? "accent";
    const lightOn = (id: string): string => {
      const w = wordsById.get(id);
      const back = w ? behind(w) : surface;
      if (back.startsWith("picture:")) return key;
      return [key, "accent", "highlight"].find((x) => ctx.theme.colors[x] && readability(ctx.theme, x, back) >= MIN_CONTRAST) ?? bestOn(ctx.theme, back, ["accent", "highlight", "ink", "paper"]);
    };
    // Lighting a whole thing colors its lines; words inside it that the color would not read on keep their color and
    // only grow bold. Words lit by their own id take the color as asked, and build checks it.
    const lightUp = (id: string, asked: string | undefined, target = id) => {
      const p = parts.get(id);
      const color = asked ?? (p?.kind === "text" ? lightOn(id) : key);
      const back = wordsById.get(id)?.back;
      if (p?.kind === "text" && asked && target !== id && back && readability(ctx.theme, asked, back) < MIN_CONTRAST) effect(id, { weight: 700 });
      else if (p?.kind === "text") effect(id, { color, weight: 700 });
      if (p?.kind === "path") effect(id, p.props.stroke && p.props.stroke !== "none" ? { stroke: color, strokeWidth: Number(p.props.strokeWidth ?? 6) * 1.5 } : { fill: color });
    };
    // Stepping back: the style's muted look where it has one (its color and how far it fades), else a plain fade.
    const muted = styleHas(ctx.theme, "muted") ? roleLook(ctx.theme, "muted") : undefined;
    const stepped = new Set<string>();
    const inside = (id: string): string[] => [...parts.values()].filter((q) => q.parent === id).flatMap((q) => [q.id, ...inside(q.id)]);
    const stepBack = (id: string, amount: string | undefined) => {
      const fade = muted?.opacity !== undefined && amount === undefined ? Math.min(1, Math.max(readDim, muted.opacity)) : muted?.color && amount === undefined ? undefined : dimTo(amount);
      if (fade !== undefined) effect(id, { opacity: fade });
      if (!muted?.color) return;
      for (const q of [id, ...inside(id)]) {
        const p = parts.get(q);
        if (p?.kind === "text") effect(q, { color: muted.color });
        else if (p?.kind === "path" && p.props.stroke && p.props.stroke !== "none") effect(q, { stroke: muted.color });
        stepped.add(q);
      }
    };
    const play: NonNullable<Step["play"]> = [];
    const emit: NonNullable<Step["emit"]> = [];
    for (const c of s.commands) {
      if (c.do === "light") {
        colorOk(c.attrs.color, c.line);
        for (const t of c.targets) for (const id of expandTarget(t, c.line)) lightUp(id, c.attrs.color, t);
      }
      if (c.do === "dim") for (const t of c.targets) for (const id of expandTarget(t, c.line)) if (!parts.get(id)?.parent) stepBack(id, c.attrs.amount);
      if (c.do === "focus") {
        colorOk(c.attrs.color, c.line);
        const lit = new Set(c.targets.flatMap((t) => expandTarget(t, c.line)));
        const touches = (a: Command) => (a.do === "arrow" ? [a.from, a.to] : a.do === "mark" ? a.targets : a.do === "tag" ? [a.target] : []);
        const stays = (id: string) => lit.has(id) || [...lit].some((x) => x.startsWith(`${id}.`) || id.startsWith(`${x}.`));
        // Marks, tags and arrows on a focused thing are part of it.
        for (const a of attached) {
          if (!touches(a).some((t) => [...lit].some((x) => x === t || x.startsWith(`${t}.`)))) continue;
          const name = attachedId(a);
          for (const id of parts.keys()) if (id === name || id.startsWith(`${name}.`)) kept.add(id);
        }
        for (const [id, p] of parts) {
          if (lit.has(id)) lightUp(id, c.attrs.color, c.targets.includes(id) ? id : "");
          else if (!stays(id) && !kept.has(id) && !(p.parent && !stays(p.parent))) stepBack(id, c.attrs.amount);
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

    // Readable: every word against what is really behind it, in the color it has now (a style's muted look aside).
    const opacityOf = (id: string): number => {
      const p = parts.get(id);
      if (!p) return 1;
      return Number(overrides.get(id)?.opacity ?? p.props.opacity ?? 1) * (p.parent ? opacityOf(p.parent) : 1);
    };
    // A label fades together with the shape it sits on, so only its own fade counts.
    const ownFade = (id: string) => {
      const p = parts.get(id);
      return p?.parent && parts.has(`${p.parent}.shape`) ? Number(overrides.get(id)?.opacity ?? p.props.opacity ?? 1) * (parts.get(p.parent)?.parent ? opacityOf(parts.get(p.parent)!.parent!) : 1) : opacityOf(id);
    };
    // One report for each thing, not one for each of its lines.
    const told = new Set<string>();
    const once = (w: Seen) => {
      const key = w.item ?? w.id;
      if (told.has(key)) return false;
      told.add(key);
      return true;
    };
    for (const w of [...laidWords, ...drawnWords]) {
      const part = parts.get(w.id);
      const opacity = opacityOf(w.id);
      if (!part || opacity <= 0.05 || told.has(w.item ?? w.id)) continue;
      const back = behind(w);
      if (back.startsWith("picture:")) {
        if (once(w)) report(w.line, `"${w.text}" sits straight on the picture ${back.slice(8)} with nothing behind it, so it cannot read on every part of a photo. Put it on a panel (a stack with role=panel or back=COLOR), give it role=caption, or move it off the picture.`);
        continue;
      }
      const color = String((stepped.has(w.id) ? undefined : effects.get(w.id)?.color) ?? overrides.get(w.id)?.color ?? part.props.color ?? "ink");
      const [fg, bg] = [colorOf(ctx.theme, color)!, colorOf(ctx.theme, back)!];
      if (!/^#[0-9a-f]{3,6}$/i.test(fg) || !/^#[0-9a-f]{3,6}$/i.test(bg)) continue; // a gradient: not judged here
      // A fade the scene asks for is judged against the style's floor, like dim; the color itself must read.
      const fade = ownFade(w.id);
      if (fade < readDim - 0.01 && once(w)) report(w.line, `"${w.text}" is faded to ${Math.round(fade * 100)}%, below ${Math.round(readDim * 100)}%, where words stop reading. Fade it less (dim and focus already stop at the right level), or drop it.`);
      const ratio = contrast(fg, bg);
      if (ratio < MIN_CONTRAST && once(w)) report(w.line, `"${w.text}" is ${color} on ${back}, a contrast of only ${ratio.toFixed(1)} to 1; words need ${MIN_CONTRAST} to 1. Leave the color out and give it a role, which picks a color that reads there, or choose another color or back.`);
    }
    // Nothing covers words, and words and pictures each have their own room.
    const shownWords = [...laidWords, ...slotWords, ...drawnWords.filter((w) => !placedLabels.some((l) => l.id === w.id))].filter((w) => opacityOf(w.id) > 0.05);
    for (let i = 0; i < shownWords.length; i++) {
      for (let j = i + 1; j < shownWords.length; j++) {
        const [a, b] = [shownWords[i]!, shownWords[j]!];
        if ((!a.laid && !b.laid && (!a.slot || a.slot === b.slot)) || (a.item && a.item === b.item)) continue;
        const least = Math.min(a.box.w * a.box.h, b.box.w * b.box.h);
        if (hits(a.box, b.box) > 0.2 * least) report(Math.max(a.line, b.line), `"${a.text}" and "${b.text}" overlap on screen, so neither reads. Give each its own room: put them in one stack or row, move one, or drop one.`);
      }
    }
    for (const w of laidWords) {
      for (const f of laid.fields) {
        if (f.picture && !f.frame && hits(w.box, f.box) > 0.2 * w.box.w * w.box.h && once(w)) report(w.line, `"${w.text}" lies over the picture ${f.id}. Words and pictures each need their own room: put them side by side or one above the other, or attach the words to the picture with tag ${f.id} "words" at=X,Y.`);
      }
    }
    for (const [item, members] of laid.members) {
      const panel = parts.get(`${item}.back`);
      const box = laid.boxes.get(item);
      if (!panel || !box) continue;
      for (const f of laid.fields) if (f.picture && !f.frame && !members.includes(f.id) && hits(box, f.box) > 0.1 * f.box.w * f.box.h) report(panel.line, `The panel ${item} covers part of the picture ${f.id}. Give the picture its own room, or put it inside the panel.`);
    }

    if (problems.length > already) {
      // Keep going to find more problems in later states, but this state cannot become steps.
      for (const [id, p] of parts) if (!live.has(id)) live.set(id, { kind: p.kind, parent: p.parent, props: p.props, alive: true, line: p.line });
      continue;
    }

    // The difference from the last state becomes this state's steps.
    const boardColor = new Set<string>();
    const enterOf = new Map<string, string>(); // a thing's own entrance, which wins over the state's
    walkAll(board, (i) => {
      if (i.attrs.color) boardColor.add(i.id);
      // An arrangement's entrance is each thing's inside it, unless that thing has its own, so the whole arrives as one.
      if (i.attrs.enter) for (const id of i.kind === "atoms" ? atomIds(i) : i.children.length ? [...leafIds(i), `${i.id}.back`] : [i.id]) enterOf.set(id, i.attrs.enter);
    });
    const move = { ...(s.attrs.move ? { frames: Number(s.attrs.move) } : {}), ...(s.attrs.ease ? { ease: s.attrs.ease as Ease } : {}) };
    // Lines and marks draw on at a pace a viewer can follow, even in a cut.
    const drawMove = { frames: s.attrs.move ? Number(s.attrs.move) : Math.max(ctx.theme.moveFrames, Math.round(ctx.fps * 0.45)), ...(s.attrs.ease ? { ease: s.attrs.ease as Ease } : {}) };
    const ownMove = s.attrs.move ? { move } : {};
    const addMain: NodeSpec[] = [];
    const addDraw: NodeSpec[] = [];
    const addQuiet: NodeSpec[] = [];
    const addScaled: NodeSpec[] = [];
    const addOwn = new Map<string, NodeSpec[]>(); // things with an entrance of their own, by entrance
    const arrive: NodeSpec[] = []; // things that travel in from off the frame, or slam down
    const pops = new Map<string, NodeSpec[]>();
    const arrivals: NonNullable<Step["play"]> = [];
    const set: NonNullable<Step["set"]> = {};
    const preset: NonNullable<Step["set"]> = {};
    const remove: string[] = [];
    const drawnIds = new Set(drawn.map((p) => p.id));
    const fresh = new Set([...parts.keys()].filter((id) => !live.has(id)));
    const comeBack: NonNullable<Step["set"]> = {};
    const returning = new Set<string>();
    const MOVING = ["slide", "slide-left", "rise", "slam"];
    for (const [id, part] of parts) {
      const props: Props = { ...part.props, ...overrides.get(id), ...effects.get(id) };
      // A label on a recolored shape stays readable unless it was given a color of its own.
      const own = part.parent ? parts.get(`${part.parent}.shape`) : undefined;
      if (own && part.kind === "text" && effects.get(id)?.color === undefined && overrides.get(id)?.color === undefined && !boardColor.has(part.parent!)) {
        const fill = overrides.get(own.id)?.fill ?? effects.get(own.id)?.fill ?? own.props.fill;
        if (typeof fill === "string" && readability(ctx.theme, String(props.color ?? "ink"), fill) < MIN_CONTRAST) props.color = readableOn(fill, ctx.theme);
      }
      const was = live.get(id);
      if (was?.alive) {
        for (const [k, v] of Object.entries(props)) {
          if (!same(was.props[k], v)) (set[id] ??= {})[k] = v;
        }
        // A light, dim or look that ended: go back to rest (a picture once behind everything comes forward again).
        for (const [k, v] of Object.entries(was.props)) {
          if (props[k] === undefined && typeof v === "number" && k !== "drawn") (set[id] ??= {})[k] = AT_REST[k] ?? v;
        }
        was.props = props;
        continue;
      }
      if (was) {
        // Back on the board: it moves while unseen, then appears.
        for (const [k, v] of Object.entries(props)) if (!same(was.props[k], v) && k !== "opacity") (preset[id] ??= {})[k] = v;
        for (const [k, v] of Object.entries(was.props)) if (props[k] === undefined && typeof v === "number" && k !== "opacity" && k !== "drawn" && AT_REST[k] !== undefined && v !== AT_REST[k]) (preset[id] ??= {})[k] = AT_REST[k]!;
        if (!part.parent) (comeBack[id] ??= {}).opacity = typeof props.opacity === "number" ? props.opacity : 1;
        returning.add(id);
        was.props = props;
        was.alive = true;
        continue;
      }
      const spec: NodeSpec = { id, kind: part.kind, props, ...(part.parent ? { parent: part.parent } : {}) };
      live.set(id, { kind: part.kind, parent: part.parent, props, alive: true, line: part.line });
      const entrance = enterOf.get(id) ?? (part.parent ? enterOf.get(part.parent) : undefined);
      const withParent = !!part.parent && fresh.has(part.parent) && !enterOf.has(id);
      if (popped.has(id)) {
        const k = popped.get(id)!;
        (pops.get(k) ?? pops.set(k, []).get(k)!).push(spec);
      } else if (entrance && MOVING.includes(entrance)) {
        if (withParent) addQuiet.push(spec);
        else {
          // It starts off the frame (or large, for a slam) and springs into place.
          const [x, y, sx, sy] = [Number(props.x ?? 0), Number(props.y ?? 0), Number(props.scaleX ?? 1), Number(props.scaleY ?? 1)];
          const from: Props = entrance === "slide" ? { x: x + ctx.width } : entrance === "slide-left" ? { x: x - ctx.width } : entrance === "rise" ? { y: y + ctx.height * 0.7 } : { scaleX: sx * 2.2, scaleY: sy * 2.2 };
          arrive.push({ ...spec, props: { ...props, ...from } });
          const to: Record<string, Value> = entrance === "slam" ? { scaleX: sx, scaleY: sy, stiffness: 220, damping: 12 } : entrance === "rise" ? { y, stiffness: 120, damping: 15 } : { x, stiffness: 120, damping: 14 };
          arrivals.push({ behavior: "spring", target: id, args: to });
          if (entrance === "slam") arrivals.push({ behavior: "shake", target: id, args: { size: 10 } });
        }
      } else if (entrance && !withParent) (addOwn.get(entrance) ?? addOwn.set(entrance, []).get(entrance)!).push(spec);
      else if (id.includes(".") && mounted.has(id.split(".")[0]!) && part.parent) addQuiet.push(spec);
      else if (mounted.has(id)) addScaled.push(spec);
      else if (Number(props.scaleX ?? 1) !== 1) addScaled.push(spec);
      else if (drawnIds.has(id)) addDraw.push(spec);
      else if (withParent && enterOf.has(part.parent!)) (addOwn.get(enterOf.get(part.parent!)!) ?? addOwn.set(enterOf.get(part.parent!)!, []).get(enterOf.get(part.parent!)!)!).push(spec);
      else addMain.push(spec);
    }
    for (const [id, l] of live) {
      if (!l.alive || parts.has(id)) continue;
      l.alive = false;
      if (!(l.parent && !parts.has(l.parent))) remove.push(id);
      overrides.delete(id);
    }
    // Leaving things that sit where entering things arrive go first, quickly, so old words never fade out under new ones.
    const now = new Map<string, Box>();
    for (const w of [...laidWords, ...drawnWords]) now.set(w.id, w.box);
    for (const f of laid.fields) if (!f.frame) now.set(f.id, f.box);
    const goneBoxes = [...before].filter(([id]) => !parts.has(id)).map(([, b]) => b);
    const comingBoxes = [...now].filter(([id]) => fresh.has(id) || returning.has(id)).map(([, b]) => b);
    const crossing = !s.cut && goneBoxes.some((g) => comingBoxes.some((c) => hits(g, c) > 0.1 * Math.min(g.w * g.h, c.w * c.h)));
    const delay = crossing ? Math.max(4, Math.round(ctx.fps * 0.25)) : 0;
    const enterAt = at + delay;
    before = now;

    // Everything arrives first, so anything in this state can act on anything new in it. A cut changes everything at
    // once: what leaves is gone and what moves is in place on the frame the cut lands.
    if (Object.keys(preset).length) steps.push({ at: Math.max(0, at - 1), move: { frames: 1 }, set: preset });
    const moved = s.cut ? { move: { frames: 1 } } : Object.keys(move).length ? { move } : {};
    // Something that simply appears is still hidden until its moment: it fades in over the single frame before it.
    const appear = (add: NodeSpec[]) => steps.push({ at: enterAt - 1, move: { frames: 1 }, enter: "fade", add });
    const mainEnter = s.attrs.enter ?? (s.cut ? "none" : undefined);
    if (addScaled.length) {
      if (s.attrs.enter === "none" || s.cut) appear(addScaled);
      else steps.push({ at: enterAt, enter: "fade", add: addScaled });
    }
    if (addMain.length) {
      if (mainEnter === "none") appear(addMain);
      else steps.push({ at: enterAt, ...moved, ...(mainEnter ? { enter: mainEnter as Step["enter"] } : {}), add: addMain });
    }
    for (const [enter, list] of addOwn) {
      if (enter === "none") appear(list);
      else steps.push({ at: enterAt, ...ownMove, enter: enter as Step["enter"], add: list });
    }
    if (arrive.length) appear(arrive);
    if (addDraw.length) steps.push({ at: enterAt, move: drawMove, enter: "draw", add: addDraw });
    for (const [k, list] of pops) steps.push({ at: enterAt, move: { frames: Math.max(ctx.theme.moveFrames, 10), ease: "spring", ...(k ? { stagger: Math.round(ctx.fps * 0.09) } : {}) }, enter: "pop", add: list });
    if (addQuiet.length) steps.push({ at: enterAt, enter: "none", add: addQuiet });
    const change: Step = { at: s.cut ? at - 1 : at, ...moved };
    if (Object.keys(set).length) change.set = set;
    if (remove.length && !delay) change.remove = remove;
    if (change.set || change.remove) steps.push(change);
    if (remove.length && delay) steps.push({ at, move: { frames: delay }, remove });
    if (Object.keys(comeBack).length) steps.push({ at: s.cut ? at - 1 : enterAt, ...moved, set: comeBack });
    const acts: Step = { at: enterAt, ...moved };
    if (play.length || arrivals.length) acts.play = [...arrivals, ...play];
    if (emit.length) acts.emit = emit;
    if (acts.play || acts.emit) steps.push(acts);
    if (laterPlay.length) steps.push({ at: enterAt, play: laterPlay });
    laterPlay = [];
  }

  if (problems.length) return { problems: dedupe(problems), stats };

  // The camera's moves. After it lands it may keep drifting closer until its next move, as a slow push-in.
  shots.forEach((c, i) => {
    steps.push({ at: c.at, move: { frames: c.frames, ease: c.ease }, set: { camera: { ...c.view } } });
    const land = c.at + c.frames;
    const end = shots[i + 1]?.at ?? ctx.frames - 1;
    if (!c.drift || end <= land + 1) return;
    // The drift pushes in only as far as it can without cutting words that were whole when it landed.
    const lists = seenAt.filter((x) => x.at >= c.at && x.at < end).map((x) => x.list);
    const worse = (zoom: number) => lists.some((list) => cutBy({ ...c.view, zoom }, list).length > cutBy(c.view, list).length);
    let zoom = c.view.zoom * Math.max(0.1, 1 + (c.drift * (end - land)) / ctx.fps);
    if (c.drift > 0 && worse(zoom)) {
      let [lo, hi] = [c.view.zoom, zoom];
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (worse(mid)) hi = mid;
        else lo = mid;
      }
      zoom = lo;
    }
    if (Math.abs(zoom - c.view.zoom) > 1e-4) steps.push({ at: land, move: { frames: end - land, ease: "linear" }, set: { camera: { zoom: Math.round(zoom * 10000) / 10000 } } });
  });
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
    const truth = [...expansions.entries()].flatMap(([id, e]) => {
      const root = e.nodes.find((n) => n.id === id);
      const kind = root?.props?.truth;
      if (typeof kind !== "string" || typeof root?.props?.spec !== "string") return [];
      try {
        return [{ id, kind, steps: truthSteps(kind, id, JSON.parse(root.props.spec), ctx) }];
      } catch {
        return [];
      }
    });
    return { problems: [], doc: sceneDoc, scene, ...(truth.length ? { truth } : {}), stats };
  } catch (e) {
    return { problems: [{ line: 0, message: `The scene could not be built: ${(e as Error).message}` }], stats };
  }
}

// Behaviors and state changes can both touch a property, and either may run past the other. Put keys in time order, and
// where two land on one frame, the later write wins.
function settle(scene: Scene): Scene {
  // A line waiting to be drawn has a length of zero, and a round cap would still show that as a dot. Keep it hidden.
  for (const t of [...scene.tracks]) {
    if (t.prop !== "drawn" || t.keys[0]?.value !== 0) continue;
    const start = t.keys.filter((k) => k.value === 0).at(-1)!.at;
    const shown = Number(scene.nodes.find((n) => n.id === t.target)?.props.opacity ?? 1);
    const opacity = scene.tracks.find((x) => x.target === t.target && x.prop === "opacity");
    const held = [{ at: 0, value: 0 }, { at: start, value: 0 }, { at: start + 1, value: shown, ease: "step" as const }];
    if (opacity) opacity.keys = [...held, ...opacity.keys.filter((k) => k.at > start + 1)];
    else scene.tracks.push({ target: t.target, prop: "opacity", keys: held });
  }
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
