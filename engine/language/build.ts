// Turns scene language into a scene document, then a scene. Each state is laid out in full, and the difference from the
// state before becomes the steps: new things enter, things with a known id travel, things no longer listed leave.
import { BEHAVIORS } from "../core/behaviors.ts";
import { compile, when } from "../core/compile.ts";
import type { CompileContext, Ease, Kit, NodeSpec, Props, Scene, SceneDoc, Step, Track, Value } from "../core/types.ts";
import { EASES } from "../core/ease.ts";
import { evaluate, sample } from "../core/evaluate.ts";
import type { Resolved } from "../core/types.ts";
import { graphKit } from "../kits/graph.ts";
import { stepSchedule, storyOf, truthSteps } from "../kits/steps.ts";
import { partAt, stepAreas, textSize, wordsAfter, type Area } from "./follow.ts";
import { estimate, graphPositions, layout, TEXT_SIZE, MIN_CONTRAST, readableOn, rect, roundedBox, safeArea, type Box, type Env, type Laid, type Measure, type Part } from "./layout.ts";
import { bestOn, colorOf, isRole, readability, roleLook, styleHas } from "../core/roles.ts";
import { contrast } from "../style/color.ts";
import { dimColor } from "../style/design.ts";
import { expandHolds, holdMoments, type HoldTime } from "./holds.ts";
import type { LibraryEntry } from "./library.ts";
import { checkOutput } from "./program.ts";
import { runProgram, type RunResult } from "./sandbox.ts";
import { READ_DEFAULT } from "../style/format.ts";
import { ENTERS, parse, parseTime, suggest, type Attrs, type Command, type Document as Doc, type Item, type Problem, type State, type Time } from "./syntax.ts";

export type BuildOptions = {
  ctx: CompileContext;
  words?: string[]; // the spoken words, for programs that follow the voice
  assets?: Record<string, string>; // image names the scene may use; nothing else can become an image
  library?: LibraryEntry[];
  seed?: number;
  measure?: Measure;
  holds?: HoldTime[]; // silences on the narration clock, so `@h2` and `@h2.end` name their start and end
};
// `truth`: each thing a truth kit computed, with its numbered steps, so a writer can bind steps to the words that speak them.
// `notes`: how states read, which is not an error but a writer may act on: a frame crowded with sentences, or one that
// leaves most of the frame empty for a while.
export type BuildResult = { problems: Problem[]; doc?: SceneDoc; scene?: Scene; truth?: { id: string; kind: string; steps: string[] }[]; notes?: string[]; stats: { states: number; parts: number; programs: number; programMs: number } };
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
const AT_REST: Record<string, number> = { glowLevel: 1, strokeWidth: 6, opacity: 1, scaleX: 1, scaleY: 1, rotate: 0, skew: 0, z: 0, layer: 0, glow: 0, blur: 0, brightness: 1, saturation: 1, contrast: 1, hue: 0, tintAmount: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, shadowOpacity: 0 };
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

export async function build(written: string, opts: BuildOptions): Promise<BuildResult> {
  const { ctx } = opts;
  const allKits = [graphKit, ...(ctx.kits ?? []).filter((k) => k !== graphKit)];
  const kinds: NonNullable<Kit["kinds"]> = Object.assign({}, ...allKits.map((k) => k.kinds));
  const kitNames = Object.keys(kinds).filter((k) => k !== "graph");
  // Hold moments become word moments first, so everything below reads plain `@N+frames`.
  const held = expandHolds(written, holdMoments(opts.holds, ctx));
  const source = held.source;
  const { doc, problems } = parse(source, kitNames);
  problems.unshift(...held.problems);
  const stats = { states: doc.states.length, parts: 0, programs: 0, programMs: 0 };
  const notes: string[] = [];
  if (problems.length) return { problems, stats };

  const behaviors = new Set([...Object.keys(BEHAVIORS), ...allKits.flatMap((k) => Object.keys(k.behaviors ?? {}))]);
  let quiet = false; // while sizes are worked out ahead, problems wait for the real pass
  const report = (line: number, message: string) => !quiet && problems.length < 40 && problems.push({ line, message });
  const colors = new Set(Object.keys(ctx.theme.colors));
  const colorOk = (v: string | undefined, line: number) => {
    if (v !== undefined && v !== "none" && !colors.has(v)) report(line, `"${v}" is not a color here. Use one of: ${[...colors].join(", ")}.${suggest(v, colors)}`);
  };
  colorOk(doc.background, 1);
  // With a design layer, words may only sit on the surfaces the style lists, so a card of another color is refused
  // with what to use instead. back=paper is the style's panel.
  const design = ctx.theme.design;
  const backOk = (v: string | undefined, line: number) => {
    if (!design || v === undefined || v === "none" || v === "paper" || !colors.has(v) || design.surfaces[v]) return;
    report(line, `back=${v} is not a surface words sit on in this style. Use role=panel for a card (or role=caption for words over a picture), and the style draws it; or back= one of: ${Object.keys(design.surfaces).join(", ")}.`);
  };
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
  // One context for expanding kits and for compiling, so a kit that registers its parts while it expands (for become,
  // each and swell) is found again by its behaviors.
  const kitsMade: Kit = { name: "programs", behaviors: {} };
  const kitCtx: CompileContext = { ...ctx, kits: [...allKits, kitsMade] };
  const expansions = new Map<string, { nodes: NodeSpec[]; box: ReturnType<typeof bounds>; rest: ReturnType<typeof bounds>; errors: { line: number; message: string }[] }>();

  // Kit things by id, so a replay can take the very settings of the thing it repeats.
  const kitItems = new Map<string, Item>();
  // A kit thing is made once, from its first line; a later line with the same id and a different input would silently
  // show the first input, so it is refused. Place, size, role and `done` may differ.
  const OWN = new Set(["at", "into", "before", "after", "done", "w", "h", "role", "follow", "enter"]);
  const inputOf = (i: Item) => JSON.stringify(Object.entries(i.attrs).filter(([k]) => !OWN.has(k)).sort(([a], [b]) => a.localeCompare(b)));
  const findKits = (list: Item[]) => list.forEach((i) => {
    if (kinds[i.kind] && i.kind !== "graph") {
      const first = kitItems.get(i.id);
      if (!first) kitItems.set(i.id, i);
      else if (first.kind !== i.kind || inputOf(first) !== inputOf(i)) report(i.line, `${i.id} is made at line ${first.line} with ${first.kind} ${inputOf(first)}, and this line makes it again with ${i.kind} ${inputOf(i)}. One id is one thing with one input: write the very same settings (only its place, size, role and done= may change), or give a different thing a new id.`);
    }
    findKits(i.children);
  });
  doc.states.forEach((s) => findKits(s.items));

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
      // `replay=ID`: a second instance of a kit thing with the same input, to play its steps again beside or after it.
      let attrs = item.attrs;
      if (attrs.replay !== undefined) {
        const first = kitItems.get(attrs.replay);
        if (!first || first.kind !== item.kind || first.id === item.id) fail(item.line, `replay=${attrs.replay} must name another ${item.kind} in this scene, whose input ${item.id} repeats.${first && first.kind !== item.kind ? ` ${attrs.replay} is a ${first.kind}.` : ""}`);
        const { replay: _r, ...own } = attrs;
        const { at: _a, into: _i, before: _b, after: _f, w: _w, h: _h, ...input } = first && first.kind === item.kind ? first.attrs : {};
        attrs = { ...input, ...own };
      }
      for (const [k, v] of Object.entries(attrs)) {
        if (["at", "into", "before", "after", "follow"].includes(k)) continue;
        try {
          // A lone backslash is kept as written, so math such as \frac needs no doubling; a doubled one still works.
          // Kits take the same size words as text, so `size=small` means what it means everywhere else.
          data[k] = k === "size" && TEXT_SIZE[v] !== undefined ? TEXT_SIZE[v] : /^[{[]/.test(v) ? JSON.parse(v.replace(/\\\\|\\(?!["/])/g, (m) => (m.length === 2 ? m : "\\\\"))) : (number(v) ?? v);
        } catch {
          fail(item.line, `The setting ${k} of ${item.id} is not valid JSON.`);
        }
      }
      // A kit's drawing takes its role's color, as words do, unless the scene names a color: a formula that is the
      // answer is drawn in the answer's color, not left in plain ink beside it.
      if (data.color === undefined && isRole(item.attrs.role)) {
        const color = roleLook(ctx.theme, item.attrs.role).color;
        if (color) data.color = color;
      }
      spec = { id: item.id, kind: item.kind, data };
    }
    const expand = (n: NodeSpec): NodeSpec[] => (["group", "path", "text", "image"].includes(n.kind) ? [n] : (kinds[n.kind]?.(n, kitCtx) ?? []).flatMap(expand));
    let nodes: NodeSpec[] = [];
    try {
      nodes = expand(spec);
    } catch (e) {
      fail(item.line, `${item.kind} ${item.id} failed: ${(e as Error).message}`);
    }
    if (!nodes.some((n) => n.id === item.id)) nodes = [{ id: item.id, kind: "group" }, ...nodes.map((n) => ({ ...n, parent: n.parent ?? item.id }))];
    nodes.sort((a, b) => Number(b.id === item.id) - Number(a.id === item.id));
    // Where what it shows sits: before any step plays, and for a truth thing after each step of its story too, so a
    // kit that keeps room for later steps is placed by where its parts mostly are while it plays. Not its invisible
    // frame, nor parts hidden at that moment.
    const seenBox = (list: NodeSpec[]) => {
      const byId = new Map(list.map((x) => [x.id, x]));
      const hidden = (x: NodeSpec | undefined): boolean => !!x && (x.props?.opacity === 0 || hidden(x.parent ? byId.get(x.parent) : undefined));
      const shown = list.filter((x, i) => i === 0 || (!hidden(x) && !(x.kind === "path" && (x.props?.stroke ?? "none") === "none" && (x.props?.fill ?? "none") === "none")));
      return shown.length > 1 ? bounds(shown) : bounds(list);
    };
    const root = nodes[0];
    const moments = [seenBox(nodes)];
    if (root && typeof root.props?.truth === "string" && typeof root.props.spec === "string") {
      try {
        for (const step of storyOf(root.props.truth, root.id, root.props.spec, kitCtx).steps) {
          const now = new Map<string, Props>();
          for (const [key, value] of step.after) {
            const [id, prop] = key.split("\u0000") as [string, string];
            if (["x", "y", "opacity"].includes(prop)) now.set(id, { ...now.get(id), [prop]: value });
          }
          moments.push(seenBox(nodes.map((x) => (now.has(x.id) ? { ...x, props: { ...x.props, ...now.get(x.id) } } : x))));
        }
      } catch {
        // The kind has already said what is wrong with its input.
      }
    }
    const rest = { ...moments[0]!, y: moments.reduce((sum, m) => sum + m.y, 0) / moments.length };
    const made = { nodes, box: bounds(nodes), rest, errors };
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
      const seen = expandKit(item).rest;
      return { w: b.w * fit, h: b.h * fit, rest: (seen.y - b.y) / b.h };
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
  const shots: { at: number; frames: number; ease: Ease; view: View; drift: number; line: number; zoomBy: number }[] = [];
  let framed: Box | undefined; // what the camera last framed, for following it in later states
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
  // Things partly in the frame, or in it but under the captions: they would be seen cut. Those in `must` count as cut
  // wherever they are not wholly in view, even out of it: words a state lays out as it arrives are there to be read.
  const cutFrom = (v: View, list: Seen[], must?: Set<string>) => {
    const f = frameIn(v);
    const a = allowedIn(v);
    return list.filter((w) => {
      const [l, r, t, d] = [w.box.x - w.box.w / 2, w.box.x + w.box.w / 2, w.box.y - w.box.h / 2, w.box.y + w.box.h / 2];
      const seen = r > f.x - f.w / 2 + 1 && l < f.x + f.w / 2 - 1 && d > f.y - f.h / 2 + 1 && t < f.y + f.h / 2 - 1;
      const whole = l >= a.x - a.w / 2 - 1 && r <= a.x + a.w / 2 + 1 && t >= a.y - a.h / 2 - 1 && d <= a.y + a.h / 2 + 1;
      return (seen || !!must?.has(w.id)) && !whole;
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
  let laterPlay: NonNullable<Step["play"]> = []; // program motion, played once its parts exist

  // Steady places: a plain state and the keep states after it are one stretch. Each state of it is laid out over the
  // boards of all of them (layout's `stretch`), so everything the stretch will show has its room from the start: adding
  // a row, an answer or a question never shrinks or shoves what is already there, and what stays keeps its box.
  quiet = true;
  // Words attached in each state (tags, and labels on marks and arrows), for the room the layout leaves them.
  const attachedWords: number[] = [];
  const boards = doc.states.map((st) => {
    applyState(st);
    attachedWords.push(attached.filter((a) => a.do === "tag" || ((a.do === "mark" || a.do === "arrow") && !!a.text)).length);
    return clone(board);
  });
  board = [];
  attached = [];
  quiet = false;
  const stretchOf: Item[][][] = [];
  for (let i = 0; i < doc.states.length; ) {
    let j = i + 1;
    while (j < doc.states.length && doc.states[j]!.keep) j++;
    const one = boards.slice(i, j); // one list for the stretch, so its states can be told apart from others by it
    for (let k = i; k < j; k++) stretchOf[k] = one;
    i = j;
  }
  // One scale for the stretch, the one that fits the fullest of its states; the united layout already makes them one.
  // About a line and a half of room for each attached line of words, the most any state of the stretch has.
  const spareOf = (i: number) => Math.min(safe.h * 0.25, Math.max(...boards.map((_, k) => (stretchOf[k] === stretchOf[i] ? attachedWords[k]! : 0))) * minText * 1.25 * 1.6);
  const fits = boards.map((b, i) => layout(clone(b), env, undefined, stretchOf[i], spareOf(i)).scale);
  const stretchScale = fits.map((_, i) => Math.min(...fits.filter((__, k) => stretchOf[k] === stretchOf[i])));
  // What was on screen in the state before, for leaving things that would cross entering ones, and the words and marks
  // of every state, for the camera's drift.
  let before = new Map<string, Box>();
  const saidBefore = new Map<string, string>(); // what each line of words said in the state before
  // Where each tag and mark label sat in the state before, and whether it was a callout, so it can stay there.
  const labelsBefore = new Map<string, { box: Box; away: boolean; near?: Box }>();
  const seenAt: { at: number; list: Seen[] }[] = [];
  const heldAt: NonNullable<Scene["held"]> = [];
  // For the camera that follows computed work: every `do steps` play, and the words and tags on screen in each state.
  const follows: { at: number; target: string; args: Record<string, Value>; still: boolean; root: Props; line: number; tags: { c: Command; box?: Box }[] }[] = [];
  const stateWords: { at: number; words: Seen[]; tags: Set<string> }[] = [];

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
      backOk(i.attrs.back, i.line);
      if (i.attrs.enter && !ENTERS.includes(i.attrs.enter)) report(i.line, `enter must be one of ${ENTERS.join(", ")}.${suggest(i.attrs.enter, ENTERS)}`);
      if (i.kind === "image" && !opts.assets?.[i.attrs.asset ?? ""]) report(i.line, `The image ${i.id} needs asset=NAME with a name from the assets list.${opts.assets ? ` Available: ${Object.keys(opts.assets).join(", ") || "none"}.` : " This scene has no assets."}`);
    });

    const laid = layout(board, env, stretchScale[index], stretchOf[index], spareOf(index));
    problems.push(...laid.problems.slice(0, 6).map((p) => ({ ...p, line: p.line || s.line })));
    // How the state reads once it settles: sentences crowding one frame, or a frame left mostly empty.
    const lasts = (index + 1 < doc.states.length ? when(doc.states[index + 1]!.at, ctx) : ctx.frames) - momentOf(s.at, s.line);
    if (lasts >= ctx.fps * 1.5) {
      const sentences = laid.texts.filter((t) => t.text.trim().split(/\s+/).length >= 3);
      if (sentences.length >= 6) notes.push(`The state at line ${s.line} shows ${sentences.length} lines of sentences at once, which a viewer cannot read while listening. Keep about three short lines beside the main thing: split the rest over states as the words reach them, or drop what the words have moved past.`);
      const tops = board.filter((i) => i.attrs.frame === undefined).map((i) => laid.boxes.get(i.id)).filter((b): b is Box => !!b);
      if (tops.length) {
        const all = union(tops);
        const share = (Math.min(all.h, safe.h) * Math.min(all.w, safe.w)) / (safe.w * safe.h);
        if (share < 0.3 && all.h < safe.h * 0.55 && !laid.fields.some((f) => f.frame)) notes.push(`The state at line ${s.line} fills only ${Math.round(share * 100)}% of the frame${index + 1 < doc.states.length ? ` for ${(lasts / ctx.fps).toFixed(1)} s` : ""}, so it looks empty. Make the main thing bigger (a larger size, or w= and h= on shapes and pictures), or show what the words describe beside it.`);
      }
    }

    // Parts for this state: laid-out parts, then kits and programs in their slots, then everything attached to them.
    // A picture that may be see-through (a PNG, such as a cut-out) gets no mat: a border would fill in around its shape.
    const seeThrough = (src: string) => /\.png($|\?)|^data:image\/png/i.test(src);
    const parts = new Map<string, Part>(laid.parts.map((p) => {
      if (p.kind !== "image") return [p.id, p];
      const src = opts.assets?.[String(p.props.src)] ?? "";
      const { border: _, borderWidth: __, ...rest } = p.props;
      return [p.id, { ...p, props: { ...(seeThrough(src) ? rest : p.props), src } }];
    }));
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
      const w = env.measure(String(p.props.text ?? ""), size, typeof p.props.font === "string" && /mono|menlo|courier/i.test(p.props.font) ? "mono" : p.props.font === ctx.theme.fonts.title ? "title" : undefined);
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
      shots.push({ at: cameraAt, frames, ease: (cam?.attrs.ease as Ease) ?? "smooth", view: next, drift: number(cam?.attrs.drift ?? "") ?? 0, line: cam?.line ?? s.line, zoomBy: number(cam?.attrs.zoom ?? "") ?? 1 });
      view = next;
      framed = region;
    }
    // Words and marks are sized for the screen, so a closer camera does not blow them up.
    const z = view.zoom;
    const labelSize = Math.max(minText * 1.25, 42 * Math.max(0.8, Math.min(1.2, laid.scale))) / z;

    const drawn: Part[] = [];
    const popped = new Map<string, string>(); // things that pop on, by group: the dots of one mark pop one after another
    const placedLabels: { box: Box; line: number; id: string }[] = [];
    const drawnWords: Seen[] = []; // attached words as they land, in the frame's coordinates
    const labelsNow = new Map<string, { box: Box; away: boolean; near?: Box }>();
    if (!s.keep) labelsBefore.clear();
    // Words that kits and programs drew, where they really are now.
    const slotWords: Seen[] = [...parts.values()].filter((p) => p.kind === "text" && laid.slots.some((x) => p.id.startsWith(`${x.item.id}.`))).flatMap((p) => {
      const b = slotPartBox(p.id);
      const slot = laid.slots.find((x) => p.id.startsWith(`${x.item.id}.`))!.item.id;
      return b ? [{ id: p.id, box: b, line: p.line, what: "text", text: String(p.props.text ?? ""), laid: false, slot }] : [];
    });
    // Math is drawn as glyph outlines, not text: for anything placed beside it, each glyph counts as writing, so a tag
    // never sits on a formula's symbols or its fraction bars.
    const glyphWords: Seen[] = [...parts.values()].filter((p) => p.props.glyph && laid.slots.some((x) => p.id.startsWith(`${x.item.id}.`))).flatMap((p) => {
      const b = slotPartBox(p.id);
      const slot = laid.slots.find((x) => p.id.startsWith(`${x.item.id}.`))!.item.id;
      return b ? [{ id: p.id, box: b, line: p.line, what: "math", text: slot, laid: false, slot }] : [];
    });
    const laidWords: Seen[] = laid.texts.map((t) => ({ id: t.id, box: t.box, line: t.line, what: "text", text: t.text, item: t.item, laid: true, ...(t.back ? { back: t.back } : {}) }));
    // Everything a label must keep clear of: all text and every solid shape, including the parts of kits and programs.
    // What sits behind everything (a picture or color filling the frame, a panel) is not in the way.
    const obstacles: Box[] = [...parts.values()].filter((p) => (p.kind === "text" || p.props.closed) && !(Number(p.props.z) < 0) && !(p.parent && Number(parts.get(p.parent)?.props.z) < 0)).flatMap((p) => {
      const inSlot = laid.slots.some((x) => p.id.startsWith(`${x.item.id}.`));
      const b = inSlot ? slotPartBox(p.id) : laid.boxes.get(p.id) ?? (p.parent ? laid.boxes.get(p.parent) : undefined);
      return b ? [b] : [];
    });
    // Room the layout keeps for what comes later in the stretch: a tag placed there now would have to move then.
    obstacles.push(...laid.held);
    // Words over a picture sit on a small card, so they read on any photo. `back=` picks its color, `back=none` drops it.
    const onPicture = (b: Box) => images.some((i) => hits(b, i) > 0.2 * b.w * b.h);
    // An attached thing's role, if it names one; marks and arrows take the style's pointer look when it has one.
    const roleOf = (attrs: Attrs, pointer = false) => (isRole(attrs.role) ? roleLook(ctx.theme, attrs.role) : pointer && styleHas(ctx.theme, "pointer") ? roleLook(ctx.theme, "pointer") : undefined);
    // The card under words that need one: the style's label card (design.elements.label.back), else the caption back.
    const captionBack = design ? design.elements.label.back : roleLook(ctx.theme, "caption").back ?? "paper";
    const chipOf = (b: Box, attrs: Attrs) => (attrs.back === "none" ? undefined : attrs.back ?? roleOf(attrs)?.back ?? (onPicture(b) ? captionBack : undefined));
    // Words as they are drawn: a role that writes in capitals changes them, and so their width; its font does too.
    const wordLook = (attrs: Attrs) => (design ? roleLook(ctx.theme, isRole(attrs.role) && attrs.role !== "panel" && attrs.role !== "pointer" ? attrs.role : "label") : roleOf(attrs));
    const shownText = (text: string, attrs: Attrs) => (wordLook(attrs)?.case === "upper" ? text.toUpperCase() : text);
    const wordFont = (attrs: Attrs) => (wordLook(attrs)?.font === "title" ? "title" : wordLook(attrs)?.font === "mono" ? "mono" : undefined);
    // `rows`: the words broken over lines, when one line would not fit across the view.
    const words = (id: string, line: number, text: string, at: { x: number; y: number }, size: number, attrs: Attrs, chip: string | undefined, parent?: string, rows: string[] = [text]) => {
      // A pointer is drawn, not typed: an emoji comes out small, in the system's emoji font, and off the style.
      if (EMOJI_ONLY.test(text)) report(line, `"${text}" is only emoji or symbols. To point at something use mark pointer ID side=top (or an arrow); attached words are for words. If a picture of an emoji is really wanted, give it its own line of text at size big or larger.`);
      // Attached words are labels unless they name a role; with a design layer they take the role's look on the card.
      const role = isRole(attrs.role) && attrs.role !== "panel" && attrs.role !== "pointer" ? attrs.role : "label";
      const look = design ? roleLook(ctx.theme, role, chip) : roleOf(attrs);
      const lines = rows.map((r) => (look?.case === "upper" ? r.toUpperCase() : r));
      const w = Math.max(...lines.map((l) => env.measure(l, size, wordFont(attrs))));
      const more = (lines.length - 1) * size * 1.2; // the extra height of lines after the first
      const where = { x: round(at.x), y: round(at.y) };
      let lean = chip ? -1.5 : 0;
      let shift = 0;
      if (chip && design && role === "caption" && !attrs.back) {
        // A caption: the style's strip, with its rule, padding and lean.
        const e = design.elements.caption;
        const ruled = e.rule !== "none" && e.ruleWidth > 0;
        const [pw, ph] = [w + size * e.pad * 2 + (ruled ? e.ruleWidth : 0), size * (1 + e.pad * 2) + more];
        lean = e.rotate;
        drawn.push({ id: `${id}.back`, kind: "path", line, under: id, ...(parent ? { parent } : {}), props: { ...where, rotate: lean, points: rect(pw, ph), closed: 1, fill: chip, stroke: e.edge === "none" ? "none" : e.edge, strokeWidth: 3, glowLevel: 0 } });
        if (ruled) drawn.push({ id: `${id}.rule`, kind: "path", line, under: id, ...(parent ? { parent } : {}), props: { ...where, rotate: lean, points: rect(e.ruleWidth, ph, -pw / 2 + e.ruleWidth / 2), closed: 1, fill: e.rule, stroke: "none" } });
        shift = ruled ? e.ruleWidth / 2 : 0;
      } else if (chip && design) {
        // A label card: the style's label back, square and flat, as the style's specimen draws it.
        drawn.push({ id: `${id}.back`, kind: "path", line, under: id, ...(parent ? { parent } : {}), props: { ...where, points: rect(w + size, size * 1.6 + more), closed: 1, fill: chip, stroke: "none", glowLevel: 0 } });
        lean = 0;
      } else if (chip) {
        const [pw, ph] = [w + size * 0.9, size * 1.55 + more];
        drawn.push({ id: `${id}.back`, kind: "path", line, under: id, ...(parent ? { parent } : {}), props: { ...where, points: roundedBox(pw, ph, ph * 0.18).map(round), closed: 1, fill: chip, stroke: "none", rotate: -1.5, shadowY: round(size * 0.08), shadowBlur: round(size * 0.25), shadowOpacity: 0.35, shadowColor: "#000000" } });
      }
      const own = look?.color && (!chip || readability(ctx.theme, look.color, chip) >= MIN_CONTRAST) ? look.color : undefined;
      const color = attrs.color ?? own ?? (chip ? readableOn(chip, ctx.theme) : "ink");
      const font: Props = look?.font === "title" ? { font: ctx.theme.fonts.title } : look?.font === "mono" ? { font: ctx.theme.fonts.mono ?? "Menlo, monospace" } : {};
      const glow: Props = design ? { glowLevel: look?.glow ?? 0 } : {};
      // A turned card turns its words with it, about the card's middle.
      const [cos, sin] = [Math.cos((lean * Math.PI) / 180), Math.sin((lean * Math.PI) / 180)];
      lines.forEach((l, i) => {
        const dy = (i - (lines.length - 1) / 2) * size * 1.2;
        const [tx, ty] = [at.x + shift * cos - dy * sin, at.y + shift * sin + dy * cos];
        drawn.push({ id: i ? `${id}.l${i + 1}` : id, kind: "text", line, ...(parent ? { parent } : {}), props: { x: round(tx), y: round(ty), text: l, size: round(size), color, weight: look?.weight ?? 700, ...font, ...glow, ...(lean ? { rotate: lean } : {}) } });
      });
      const holder = parent ? boxOf(parent) : undefined;
      const abs = holder ? { x: holder.x + at.x, y: holder.y + at.y } : at;
      drawnWords.push({ id, box: { x: abs.x, y: abs.y, w, h: size * 1.15 + more }, line, what: "text", text, laid: false, ...(chip ? { back: chip, chip: true } : {}), ...(parent ? { holder: parent } : {}) });
    };
    // Where attached words may go now: inside the view the camera shows, clear of its edges and the captions.
    const roomNow = (): { l: number; r: number; t: number; d: number } => {
      const a = allowedIn(view);
      // The style's side margins hold on screen however close the camera is, so words never run to the frame's edge.
      const margin = ((ctx.width - safe.w) / 2) * 0.8;
      return { l: Math.max(a.x - a.w / 2, 0) + margin / view.zoom, r: Math.min(a.x + a.w / 2, ctx.width) - margin / view.zoom, t: Math.max(a.y - a.h / 2, safe.y - safe.h / 2), d: Math.min(a.y + a.h / 2, safe.y + safe.h / 2) };
    };
    // Words that would not fit across the view at their size come down to fit it, never below the readable size. What
    // still does not fit is reported with how many characters do.
    const fitWords = (text: string, size: number, attrs: Attrs, line: number, pad = 1): { size: number; rows: string[] } => {
      const room = roomNow();
      const across = room.r - room.l;
      const font = wordFont(attrs);
      const shown = (t: string) => shownText(t, attrs);
      const need = (t: string, k: number) => env.measure(shown(t), k, font) + k * pad;
      if (need(text, size) <= across) return { size, rows: [text] };
      // Two lines, balanced, at the size asked for or as close to it as fits; then one line brought down to fit.
      const floor = minText / view.zoom;
      const halves = (k: number) => {
        const words = text.split(/\s+/).filter(Boolean);
        let best: string[] | undefined;
        for (let i = 1; i < words.length; i++) {
          const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
          const wide = Math.max(...pair.map((t) => need(t, k)));
          if (wide <= across && (!best || wide < Math.max(...best.map((t) => need(t, k))))) best = pair;
        }
        return best;
      };
      for (const k of [size, Math.max(floor, size * 0.85), floor]) {
        const pair = halves(k);
        if (pair) return { size: round(k), rows: pair };
      }
      const fit = Math.max(floor, (size * across) / need(text, size));
      if (need(text, fit) > across + 1) {
        const chars = Math.max(4, Math.floor(([...text].length * across * 2) / need(text, floor)) - 2);
        report(line, `"${text}" is too long to fit across the frame${view.zoom > 1.01 ? ` with the camera this close (zoom ${view.zoom.toFixed(2)})` : ""}, even on two lines at the smallest readable size. Shorten it to ${chars} characters or fewer, or split it into two tags on two places.`);
      }
      return { size: round(fit), rows: [text] };
    };
    // A short line from words placed away from their target back to it, the way a callout points.
    const leader = (id: string, line: number, from: Box, to: Box, attrs: Attrs) => {
      const a = edgePoint(from, to, 6);
      const b = edgePoint(to, from, MARK_PAD);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 24) return;
      const { color, glow } = pen(attrs);
      drawn.push({ id: `${id}.lead`, kind: "path", line, props: { points: [a.x, a.y, b.x, b.y].map(round), stroke: color, strokeWidth: round(Math.max(3, (design ? design.elements.pointer.width : 6) * 0.6) / view.zoom), ...glow } });
    };
    // Splits words into two balanced lines, for a place that is tall enough but not wide enough for one.
    const twoLines = (text: string, size: number, attrs: Attrs): string[] | undefined => {
      const list = text.split(/\s+/).filter(Boolean);
      let best: { pair: string[]; wide: number } | undefined;
      for (let i = 1; i < list.length; i++) {
        const pair = [list.slice(0, i).join(" "), list.slice(i).join(" ")];
        const wide = Math.max(...pair.map((t) => env.measure(shownText(t, attrs), size, wordFont(attrs))));
        if (!best || wide < best.wide) best = { pair, wide };
      }
      return best?.pair;
    };
    const label = (id: string, line: number, text: string, want: { x: number; y: number }[], attrs: Attrs, given = labelSize, near?: Box) => {
      const fitted = fitWords(text, given, attrs, line, 0.9);
      const size = fitted.size;
      let rows = fitted.rows;
      // Room for the card the words may sit on, so nothing near them is covered by it either.
      const dims = (r: string[]) => ({ w: Math.max(...r.map((t) => env.measure(shownText(t, attrs), size, wordFont(attrs)))) + size * 0.9, h: size * 1.55 + (r.length - 1) * size * 1.2 });
      let { w, h } = dims(rows);
      // Attached words stay in view, clear of the captions, however far out their target is.
      const room = roomNow();
      const box = (p: { x: number; y: number }) => ({ x: Math.max(room.l + w / 2, Math.min(room.r - w / 2, p.x)), y: Math.max(room.t + h / 2, Math.min(room.d - h / 2, p.y)), w, h });
      const inWords = (b: Box) => [...laidWords, ...slotWords, ...glyphWords].reduce((sum, o) => sum + hits(b, o.box), 0);
      // Any piece of writing a place would cover a fair part of, however small that piece is next to the words placed.
      const covers = (b: Box) => [...laidWords, ...slotWords, ...glyphWords].some((o) => hits(b, o.box) > 0.15 * o.box.w * o.box.h);
      const onLabels = (b: Box) => placedLabels.reduce((sum, l) => sum + hits(b, l.box), 0);
      // Covering words costs most, since then neither can be read; covering a shape costs less, as words can sit on a card.
      const cost = (b: Box) => [...obstacles, ...placedLabels.map((l) => l.box)].reduce((sum, o) => sum + hits(b, o), 0) + inWords(b) * 2;
      // A spot pushed back onto the canvas is no longer beside its target, so it counts against that spot.
      const ranked = want.map((p) => ({ b: box(p), p })).map(({ b, p }, i) => ({ b, over: cost(b), c: cost(b) + (Math.abs(b.x - p.x) > 2 || Math.abs(b.y - p.y) > 2 ? w * h * 0.25 : 0), i })).sort((a, b) => a.c - b.c || a.i - b.i);
      let best: { b: Box; over: number } = ranked[0]!;
      let away = false;
      let fits: number | undefined;
      // Words that were already on screen stay where they were while that place is still clear and still beside the
      // same target, so a tag does not wander as other things arrive. A callout moves back beside its target once it can.
      const was = labelsBefore.get(id);
      const kept = was && Math.abs(was.box.w - w) < 2 && Math.abs(was.box.h - h) < 2 && (!was.near || (near && Math.hypot(was.near.x - near.x, was.near.y - near.y) < 2)) ? box(was.box) : undefined;
      const stays = !!kept && Math.abs(kept.x - was!.box.x) < 2 && Math.abs(kept.y - was!.box.y) < 2 && onLabels(kept) === 0 && inWords(kept) === 0 && cost(kept) <= 0.05 * w * h && !(was!.away && ranked[0]!.c <= 0.05 * w * h);
      if (stays) {
        best = { b: kept!, over: cost(kept!) };
        away = was!.away;
      }
      // When everything around the target is full, the words go to the nearest free place in view, with a line back to
      // what they name, as a callout does; on two lines if that is what fits there.
      if (!stays && near && (onLabels(best.b) > 0.08 * w * h || inWords(best.b) > 0.08 * w * h || covers(best.b) || best.over > 0.3 * w * h)) {
        // How many words a line from a place back to the target would run through.
        // Counted by the thing crossed (a line of words, a formula), not by its letters.
        const through = (b: Box) => [...laidWords, ...slotWords, ...glyphWords].filter((o) => hits(o.box, near) < 0.5 * o.box.w * o.box.h && Array.from({ length: 11 }, (_, i) => i / 10).some((t) => Math.abs(b.x + (near.x - b.x) * t - o.box.x) < o.box.w / 2 && Math.abs(b.y + (near.y - b.y) * t - o.box.y) < o.box.h / 2)).reduce((set, o) => set.add(o.item ?? o.slot ?? o.id), new Set<string>()).size;
        const search = (bw: number, bh: number) => {
          const spots: { b: Box; over: number; far: number }[] = [];
          // A fine grid, so a gap only a little taller than the words between two formulas is found.
          const stepX = Math.max(16, bw / 8);
          const stepY = Math.max(8, bh * 0.15);
          for (let y = room.t + bh / 2; y <= room.d - bh / 2 + 1; y += stepY) {
            for (let x = room.l + bw / 2; x <= room.r - bw / 2 + 1; x += stepX) {
              const b = { x, y, w: bw, h: bh };
              if (hits(b, near) > 0 || onLabels(b) > 0 || inWords(b) > 0) continue;
              spots.push({ b, over: cost(b), far: Math.hypot(x - near.x, y - near.y) + through(b) * ctx.width });
            }
          }
          // A clear place nearest the target; else the place covering least, where the words sit on a card.
          return spots.filter((x) => x.over <= 0.05 * bw * bh).sort((a, b) => a.far - b.far)[0] ?? spots.sort((a, b) => a.over - b.over || a.far - b.far)[0];
        };
        let pick = search(w, h);
        const pair = rows.length === 1 ? twoLines(text, size, attrs) : undefined;
        if (pair && (!pick || pick.over > 0.05 * w * h)) {
          const d2 = dims(pair);
          const other = search(d2.w, d2.h);
          if (other && (!pick || other.over < pick.over)) {
            pick = other;
            rows = pair;
            ({ w, h } = d2);
          }
        }
        if (pick) {
          best = pick;
          away = true;
        } else if (given > (minText / z) * 1.05 && (covers(best.b) || inWords(best.b) > 0)) {
          // Nowhere at this size: the words try again at the smallest readable size before covering any writing.
          return label(id, line, text, want, attrs, minText / z, near);
        } else {
          // Nowhere at all: say how many characters the largest free place takes, so a shorter version fits.
          for (let k = 0.9; k >= 0.2; k -= 0.1) {
            if (!search(w * k, size * 1.55)) continue;
            fits = Math.max(3, Math.floor([...text].length * k) - 1);
            break;
          }
        }
      }
      // With no free place, the words sit on a card over what they cover, so they still read. Words on top of other
      // words are a problem, because then neither can be read.
      if (onLabels(best.b) > 0.3 * w * h) report(line, `"${text}" would sit on top of other attached words, and there is no free place left in view for it. ${fits ? `The largest free place left holds about ${fits} characters: shorten it to that,` : "Shorten it,"} drop an earlier tag or mark label, or give that thing room with space, a row or a stack.`);
      else if (inWords(best.b) > 0.08 * w * h) {
        const under = [...laidWords, ...slotWords, ...glyphWords].sort((a, b) => hits(best.b, b.box) - hits(best.b, a.box))[0];
        report(line, `"${text}" would sit on top of the words "${under?.text ?? ""}", and there is no free place left in view for it. ${fits ? `The largest free place left holds about ${fits} characters: shorten it to that` : "Shorten it to a word or two"}, drop something, or put less on screen in this state.`);
      }
      const crowded = (best.over > 0.3 * w * h || covers(best.b)) && attrs.back !== "none";
      words(id, line, text, best.b, size, attrs, chipOf(best.b, attrs) ?? (crowded ? captionBack : undefined), undefined, rows);
      if (away && near) leader(id, line, best.b, near, attrs);
      placedLabels.push({ box: best.b, line, id });
      labelsNow.set(id, { box: best.b, away, ...(near ? { near } : {}) });
    };
    // How arrows and marks are drawn: the pointer look (or the role named), at the style's pointer width, with its glow.
    const pen = (attrs: Attrs, base?: number) => {
      const look = roleOf(attrs, true);
      return { color: attrs.color ?? look?.color ?? "ink", width: round((number(attrs.strokeWidth ?? "") ?? base ?? (design ? design.elements.pointer.width : 6)) * (look?.stroke ?? 1)), glow: (design ? { glowLevel: look?.glow ?? 0 } : {}) as Props };
    };
    // An arrowhead the style's way: open, solid, or none. `k` scales it, `color` fills a solid one.
    const headOf = (color: string, k = 1): Props | undefined => {
      const kind = design?.elements.pointer.head ?? "open";
      if (kind === "none") return undefined;
      const pts = [-26 * k, -16 * k, 0, 0, -26 * k, 16 * k].map(round);
      return kind === "solid" ? { points: [...pts, pts[0]!, pts[1]!], closed: 1, fill: color } : { points: pts };
    };
    const addLink = (id: string, a: Box, b: Box, line: number, head: boolean, attrs: Attrs, text?: string) => {
      if (a === b || (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1)) {
        // From a thing to itself: a turn around it, as for something spinning or returning to where it began.
        const [rx, ry] = [a.w / 2 + MARK_PAD * 2.5, a.h / 2 + MARK_PAD * 2.5];
        const pts = Array.from({ length: 31 }, (_, i) => {
          const t = ((200 + (i / 30) * 280) * Math.PI) / 180;
          return [round(a.x + Math.cos(t) * rx), round(a.y + Math.sin(t) * ry)];
        }).flat();
        const { color, width, glow } = pen(attrs);
        drawn.push({ id, kind: "path", line, props: { points: pts, stroke: color, strokeWidth: width, smooth: 1, ...glow } });
        const shape = headOf(color);
        if (head && shape) {
          const [px, py, qx, qy] = pts.slice(-4) as [number, number, number, number];
          drawn.push({ id: `${id}.head`, kind: "path", line, props: { x: qx, y: qy, rotate: round((Math.atan2(qy - py, qx - px) * 180) / Math.PI), ...shape, stroke: color, strokeWidth: width, ...glow } });
        }
        if (text) label(`${id}.label`, line, text, [{ x: a.x, y: a.y - ry - 40 }, { x: a.x + rx + 120, y: a.y }, { x: a.x, y: a.y + ry + 40 }, { x: a.x - rx - 120, y: a.y }], attrs, labelSize, a);
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
      const { color, width, glow } = pen(attrs);
      drawn.push({ id, kind: "path", line, props: { points, stroke: color, strokeWidth: width, ...glow } });
      const tip = (px: number, py: number, qx: number, qy: number, name: string) => {
        const a2 = (Math.atan2(qy - py, qx - px) * 180) / Math.PI;
        const shape = headOf(color);
        if (shape) drawn.push({ id: name, kind: "path", line, props: { x: round(qx), y: round(qy), rotate: round(a2), ...shape, stroke: color, strokeWidth: width, ...glow } });
      };
      if (head) tip(points.at(-4)!, points.at(-3)!, points.at(-2)!, points.at(-1)!, `${id}.head`);
      if (head && attrs.both) tip(points[2]!, points[3]!, points[0]!, points[1]!, `${id}.tail`);
      if (text) {
        const w = env.measure(shownText(text, attrs), labelSize, wordFont(attrs));
        const spots = [8, 6, 10, 4, 12].flatMap((i) => [1, -1].flatMap((side) => [34, 70].map((off) => ({ x: points[i * 2]! + side * (-uy * (off + Math.abs(uy) * w * 0.5)), y: points[i * 2 + 1]! + side * ux * off }))));
        const both = union([a, b]);
        const around = [{ x: both.x, y: both.y - both.h / 2 - 30 }, { x: both.x, y: both.y + both.h / 2 + 30 }, { x: both.x + both.w / 2 + w / 2 + 20, y: both.y }, { x: both.x - both.w / 2 - w / 2 - 20, y: both.y }];
        label(`${id}.label`, line, text, [...spots, ...around], attrs, labelSize, { x: points[16]!, y: points[17]!, w: 8, h: 8 });
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
        // A highlight is the style's highlight, unless the scene names a color or a role for it.
        const hl = design && c.shape === "highlight" && !c.attrs.color && !role ? design.elements.highlight : undefined;
        const color = c.attrs.color ?? role?.color ?? hl?.color ?? (c.shape === "highlight" ? "highlight" : "accent");
        const base = design ? design.elements.pointer.width * (holder ? 1.3 : 1) : holder ? 9 : 7;
        const width = ((number(c.attrs.strokeWidth ?? "") ?? base) * (role?.stroke ?? 1)) / (holder ? z : 1);
        const shade: Props = holder ? { shadowY: round(2 / z), shadowBlur: round(5 / z), shadowOpacity: 0.45, shadowColor: "#000000" } : {};
        const glow: Props = design ? { glowLevel: role?.glow ?? (hl ? 1 : 0) } : {};
        const [ox, oy] = holder ? [whole.x, whole.y] : [0, 0];
        const local = (list: number[]) => list.map((v, i) => round(v - (i % 2 ? oy : ox)));
        const add = (pid: string, props: Props) => drawn.push({ id: pid, kind: "path", line: c.line, ...(holder ? { parent: holder } : {}), props: { stroke: color, strokeWidth: width, ...shade, ...glow, ...props, ...(props.x !== undefined ? { x: round(Number(props.x) - ox), y: round(Number(props.y) - oy) } : {}), ...(props.points && props.x === undefined ? { points: local(props.points as number[]) } : {}) } });
        const rw = at ? (r - l) / 2 : (r - l) * 0.62;
        const rh = at ? (d - t) / 2 : (d - t) * 0.72;
        // A ring runs a little past a full turn, the way a hand closes a circle; a clean ring closes exactly.
        const ringAt = (pid: string) =>
          design?.elements.pointer.ring === "clean"
            ? add(pid, { x: b.x, y: b.y, points: Array.from({ length: 49 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2) * rw, Math.sin((i / 48) * Math.PI * 2) * rh]).flat().map(round), closed: 1 })
            : add(pid, { x: b.x, y: b.y, points: Array.from({ length: 53 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2 - 2) * rw * (1 + i * 0.0008), Math.sin((i / 48) * Math.PI * 2 - 2) * rh]).flat().map(round) });
        // A ring in a tight place, where its oval would run through the words of something beside it, becomes a
        // rounded loop that hugs what it rings.
        const tight = !at && [...laidWords, ...slotWords, ...drawnWords].some((o) => {
          if (hits(o.box, whole) > 0.5 * o.box.w * o.box.h) return false; // its own words
          return hits(o.box, { x: b.x, y: b.y, w: rw * 2, h: rh * 2 }) > 0.04 * o.box.w * o.box.h;
        });
        if ((c.shape === "ring" || hl?.kind === "ring") && tight) add(id, { x: b.x, y: b.y, points: roundedBox(r - l, d - t, Math.min(r - l, d - t) * 0.32).map(round), closed: 1 });
        else if (c.shape === "ring" || hl?.kind === "ring") ringAt(id);
        if (c.shape === "box" || hl?.kind === "box") add(id, { points: [l, t, r, t, r, d, l, d, l, t].map(round) });
        if (c.shape === "underline" || hl?.kind === "underline") add(id, { points: (pts && pts.length >= 4 ? pts : [l, d, r, d]).map(round) });
        if (c.shape === "line" || c.shape === "path") add(id, { points: pts!.map(round), ...(c.shape === "path" ? { smooth: 1 } : {}) });
        if (c.shape === "arrow" && pts!.length >= 4) {
          add(id, { points: pts!.map(round) });
          const [px, py, qx, qy] = pts!.slice(-4) as [number, number, number, number];
          const shape = headOf(color, 1.3 / (holder ? z : 1));
          if (shape) add(`${id}.head`, { x: qx, y: qy, rotate: round((Math.atan2(qy - py, qx - px) * 180) / Math.PI), ...shape });
        }
        if (hl?.kind === "glow") {
          // A glow highlight lights the words themselves, in the highlight color at the style's full light.
          for (const p of [...parts.values()].filter((q) => q.kind === "text" && (q.id === c.targets[0] || q.parent === c.targets[0]))) parts.set(p.id, { ...p, props: { ...p.props, color, glowLevel: 1 } });
        }
        if (c.shape === "dots") {
          const rad = 14 / (holder ? z : 1);
          for (let i = 0; i + 1 < pts!.length; i += 2) {
            const did = i ? `${id}.${i / 2 + 1}` : id;
            add(did, { x: pts![i]!, y: pts![i + 1]!, points: circleAt(rad), closed: 1, fill: color, stroke: "paper", strokeWidth: round(3 / (holder ? z : 1)) });
            popped.set(did, id);
          }
        }
        if (c.shape === "highlight" && (!hl || hl.kind === "marker")) {
          // On words, a band of color is swept under each line; elsewhere it lies across the place, see-through. Words
          // on the band take the style's ink for it when their own color would not read there.
          const lines = !at ? [...parts.values()].filter((p) => p.kind === "text" && p.parent === c.targets[0] && c.targets.length === 1) : [];
          if (lines.length) {
            lines.forEach((p, i) => {
              const size = Number(p.props.size ?? 60);
              const w = env.measure(String(p.props.text ?? ""), size, p.props.font === ctx.theme.fonts.title ? "title" : undefined);
              const x0 = Number(p.props.x ?? 0) - (p.props.anchor === "start" ? 0 : p.props.anchor === "end" ? w : w / 2);
              drawn.push({ id: i ? `${id}.${i + 1}` : id, kind: "path", line: c.line, parent: c.targets[0]!, props: { points: [x0 - size * 0.15, Number(p.props.y ?? 0), x0 + w + size * 0.15, Number(p.props.y ?? 0)].map(round), stroke: color, strokeWidth: round(size * 0.82), lineCap: "butt", strokeOpacity: hl?.opacity ?? 0.85, z: -1, ...glow } });
              if (design && readability(ctx.theme, String(p.props.color ?? "ink"), color) < MIN_CONTRAST) parts.set(p.id, { ...p, props: { ...p.props, color: readableOn(color, ctx.theme), glowLevel: 0 } });
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
          add(id, { points: [...tail, ...tip].map(round), strokeWidth: Math.max(width, 8 / z) });
          const shape = headOf(color, 1.3 / z);
          if (shape) add(`${id}.head`, { x: tip[0], y: tip[1], rotate: round((Math.atan2(tip[1] - tail[1], tip[0] - tail[0]) * 180) / Math.PI), ...shape, strokeWidth: Math.max(width, 8 / z) });
          placedLabels.push({ box: { ...spanOf([...tip, ...tail]), w: Math.max(30 / z, Math.abs(tip[0] - tail[0])), h: Math.max(30 / z, Math.abs(tip[1] - tail[1])) }, line: c.line, id });
          if (c.text) {
            const away = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side as "top"]!;
            const w = env.measure(shownText(c.text, {}), labelSize);
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
          label(`${id}.label`, c.line, c.text, [{ x: b.x, y: below }, { x: b.x, y: above }, { x: b.x + b.w / 2 + 160, y: b.y }, { x: b.x - b.w / 2 - 160, y: b.y }], { color }, labelSize, b);
        }
      }
      if (c.do === "tag") {
        const b = needBox(c.target, c.line);
        if (!b) continue;
        colorOk(c.attrs.color, c.line);
        if (c.attrs.back && c.attrs.back !== "none") { colorOk(c.attrs.back, c.line); backOk(c.attrs.back, c.line); }
        const own = roleOf(c.attrs)?.size;
        const size = Math.max(minText / z, number(c.attrs.size ?? "") ?? (own ? (own * Math.min(ctx.width, ctx.height)) / z : labelSize));
        const id = attachedId(c);
        const at = atList(c.attrs.at, c.line, 2);
        if (at === null) continue;
        if (at) {
          // At a point inside the thing. Inside a picture it belongs to the picture, and sits on a card unless told not to.
          const [x0, y0] = pointsIn(b, at) as [number, number];
          const holder = parts.get(c.target)?.kind === "image" ? c.target : undefined;
          const chip = c.attrs.back === "none" ? undefined : c.attrs.back ?? (design ? roleOf(c.attrs)?.back : undefined) ?? (holder || onPicture({ x: x0, y: y0, w: 1, h: 1 }) ? (design ? captionBack : "paper") : undefined);
          const fitted = fitWords(c.text, size, c.attrs, c.line, chip ? 1.4 : 0.2);
          // Words at points that would land on words placed at points before them step down (or up) until clear, so
          // two captions on one picture never cover each other.
          const tall = fitted.size * (1.6 + (fitted.rows.length - 1) * 1.2);
          const wide = Math.max(...fitted.rows.map((r) => env.measure(shownText(r, c.attrs), fitted.size, wordFont(c.attrs)))) + fitted.size;
          // Words at a point near the edge slide in to keep the style's margins.
          const span = roomNow();
          const x = wide <= span.r - span.l ? Math.min(Math.max(x0, span.l + wide / 2), span.r - wide / 2) : x0;
          const cardOf = (o: Seen): Box => (o.chip ? { ...o.box, w: o.box.w + o.box.h * 0.8, h: o.box.h + (o.box.h / 1.15) * 0.5 } : o.box);
          const clear = (yy: number) => !drawnWords.some((o) => !placedLabels.some((l) => l.id === o.id) && hits({ x, y: yy, w: wide, h: tall }, cardOf(o)) > 0.01 * wide * tall);
          let y = y0;
          if (!clear(y)) {
            const room = roomNow();
            const step = tall * 0.25;
            const tries = Array.from({ length: 24 }, (_, i) => y0 + (i % 2 ? -1 : 1) * step * Math.ceil((i + 1) / 2)).filter((v) => v - tall / 2 >= room.t && v + tall / 2 <= room.d);
            y = tries.find(clear) ?? y0;
          }
          words(id, c.line, c.text, holder ? { x: x - b.x, y: y - b.y } : { x, y }, fitted.size, c.attrs, chip, holder, fitted.rows);
          if (holder) popped.set(id, "").set(`${id}.back`, "").set(`${id}.rule`, "").set(`${id}.l2`, "");
          // Words on a picture belong to it but are never covered by what lies beside it: a caption that runs past
          // the picture's edge stays over its neighbor, as a strip laid across two prints does.
          if (holder && design) for (const p of drawn) if (p.id === id || p.id === `${id}.back` || p.id === `${id}.rule` || p.id === `${id}.l2`) p.props.layer = 1;
          continue;
        }
        const w = env.measure(shownText(c.text, c.attrs), size, wordFont(c.attrs));
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
        label(id, c.line, c.text, [...(c.attrs.side ? [options[c.attrs.side]!] : []), ...order.map((k) => options[k]!), ...further], c.attrs, size, b);
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
    // Words of a thing that arrives in this state, none of which were on screen before.
    const stayed = new Set(laidWords.filter((w) => before.has(w.id)).map((w) => w.item));
    // Words that change what they say are new too: they are there to be read.
    const newWords = new Set([...laidWords.filter((w) => !stayed.has(w.item) || saidBefore.get(w.id) !== w.text), ...drawnWords.filter((w) => !saidBefore.has(w.id))].map((w) => w.id));
    const cutBy = (v: View, list: Seen[]) => cutFrom(v, list, newWords);
    let cut = cutBy(view, keyWords);
    // Words tagged at a point slide along, as far as they must, to sit whole inside the view.
    for (const w of cut) {
      if (w.laid || w.slot || placedLabels.some((l) => l.id === w.id)) continue;
      const a = allowedIn(view);
      const dx = Math.max(0, a.x - a.w / 2 - (w.box.x - w.box.w / 2)) || -Math.max(0, w.box.x + w.box.w / 2 - (a.x + a.w / 2));
      const dy = Math.max(0, a.y - a.h / 2 - (w.box.y - w.box.h / 2)) || -Math.max(0, w.box.y + w.box.h / 2 - (a.y + a.h / 2));
      const moved = { ...w.box, x: w.box.x + dx, y: w.box.y + dy };
      if (cutBy(view, [{ ...w, box: moved }]).length) continue;
      for (const id of [w.id, `${w.id}.back`, `${w.id}.rule`, `${w.id}.l2`]) {
        const p = parts.get(id);
        if (p) parts.set(id, { ...p, props: { ...p.props, x: round(Number(p.props.x ?? 0) + dx), y: round(Number(p.props.y ?? 0) + dy) } });
      }
      w.box = moved;
    }
    cut = cutBy(view, keyWords);
    // A camera that moves in this state shifts as little as it must; a camera set earlier follows, with a small move of
    // its own in this state, so words that arrive under it are held whole.
    const holding = cam && next && region ? region : !cam && framed && (view.zoom > 1.0001 || view.panX !== REST.panX || view.panY !== REST.panY) ? framed : undefined;
    if (cut.length && holding) {
      let v = view;
      const cover = (x: View) => hits(holding, allowedIn(x)) / Math.max(1, holding.w * holding.h);
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
      // Moving across is not enough: the camera pulls back, as little as it must, toward the middle of what is cut and
      // what it frames, until the words are whole.
      if (cut.length && v.zoom > 1.0001) {
        const both = union([holding, ...cut.map((w) => w.box)]);
        for (let k = 0.95; k >= 0.3; k -= 0.05) {
          const zoom = Math.max(1, v.zoom * k);
          // At no zoom, the whole frame as laid out is a view too.
          const tries = [clampView({ ...v, zoom }), clampView({ panX: both.x, panY: both.y - (safe.y - ctx.height / 2) / zoom, zoom }), ...(zoom === 1 ? [REST] : [])];
          const hit = tries.find((x) => !cutBy(x, keyWords).length);
          if (hit) {
            v = hit;
            cut = [];
            break;
          }
          if (zoom === 1) break;
        }
      }
      if (v !== view) {
        view = v;
        if (cam) shots.at(-1)!.view = v;
        else shots.push({ at, frames: number(s.attrs.move ?? "") ?? Math.max(ctx.theme.moveFrames, Math.round(ctx.fps * 0.6)), ease: "smooth", view: v, drift: 0, line: s.line, zoomBy: shots.at(-1)?.zoomBy ?? 1 });
      }
    }
    // What is still cut is reported with exactly what to change: the camera line and a zoom that holds the words, or how
    // far they run over and how many characters fit.
    // Words that stayed from before and are wholly out of view are not reported: a camera may frame something else on
    // purpose. Words this state puts on screen or changes are there to be read, so they must be in view.
    cut = cutFrom(view, cut, newWords);
    for (const w of cut) {
      const f = frameIn(view);
      const a = allowedIn(view);
      const over = { left: a.x - a.w / 2 - (w.box.x - w.box.w / 2), right: w.box.x + w.box.w / 2 - (a.x + a.w / 2), top: a.y - a.h / 2 - (w.box.y - w.box.h / 2), bottom: w.box.y + w.box.h / 2 - (a.y + a.h / 2) };
      const [side, by] = Object.entries(over).sort((p, q) => q[1] - p[1])[0]!;
      const where = side === "bottom" && w.box.y + w.box.h / 2 <= f.y + f.h / 2 ? "into the captions at the bottom" : `past the ${side} edge`;
      const shot = shots.at(-1);
      const moved = view.zoom > 1.0001 && shot ? shot : undefined;
      let hint = "";
      if (moved) {
        let k = 0.95;
        for (; k >= 0.35; k -= 0.05) if (!cutBy(clampView({ ...view, zoom: Math.max(1, view.zoom * k) }), [w]).length) break;
        hint = k >= 0.35 && view.zoom * k >= 1 ? ` Give the camera on line ${moved.line} zoom=${(moved.zoomBy * k).toFixed(2)} so the view holds it, or` : ` Use camera zoom=1 at line ${moved.line} (the whole frame), or`;
      }
      const chars = Math.max(4, Math.floor(([...(w.text ?? "")].length * a.w) / Math.max(1, w.box.w)) - 2);
      report(w.line, `With the camera where it is at this state${moved ? ` (zoom ${view.zoom.toFixed(2)}, from line ${moved.line})` : ""}, "${w.text}" runs ${where} by ${Math.round(by * view.zoom)} pixels.${hint || ""}${hint ? " shorten" : " Shorten"} it to ${w.box.w > a.w ? `${chars} characters or fewer` : "fewer words"}, or attach it elsewhere (another side=, or at= nearer the middle), or drop it.`);
    }
    seenAt.push({ at, list: keyWords });
    // The room kept for later things, where it falls on the frame with the camera as this state leaves it.
    // A kit's whole box counts too: it keeps room for what its later steps show.
    const keptRoom = [...laid.held, ...laid.slots.filter((x) => x.box.w > 0).map((x) => x.box)];
    if (keptRoom.length) heldAt.push({ from: at, to: index + 1 < doc.states.length ? when(doc.states[index + 1]!.at, ctx) : ctx.frames, boxes: keptRoom.map((b) => ({ x: round((b.x - view.panX) * view.zoom + ctx.width / 2), y: round((b.y - view.panY) * view.zoom + ctx.height / 2), w: round(b.w * view.zoom), h: round(b.h * view.zoom) })) });

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
    const keyGlow = roleLook(ctx.theme, "key").glow ?? 0;
    const lightOn = (id: string): string => {
      const w = wordsById.get(id) ?? wordsById.get(id.replace(/\.l\d+$/, ""));
      const back = w ? behind(w) : surface;
      if (back.startsWith("picture:")) return key;
      return [key, "accent", "highlight"].find((x) => ctx.theme.colors[x] && readability(ctx.theme, x, back) >= MIN_CONTRAST) ?? bestOn(ctx.theme, back, ["accent", "highlight", "ink", "paper"]);
    };
    // Lighting a whole thing colors its lines; words inside it that the color would not read on keep their color and
    // only grow bold. Words lit by their own id take the color as asked, and build checks it.
    const lightUp = (id: string, asked: string | undefined, target = id) => {
      // The card under attached words is their surface, not something to light.
      if (/\.(back|rule)$/.test(id) && parts.get(id.replace(/\.(back|rule)$/, ""))?.kind === "text") return;
      const p = parts.get(id);
      const color = asked ?? (p?.kind === "text" ? lightOn(id) : key);
      const back = (wordsById.get(id) ?? wordsById.get(id.replace(/\.l\d+$/, "")))?.back;
      if (p?.kind === "text" && asked && target !== id && back && readability(ctx.theme, asked, back) < MIN_CONTRAST) effect(id, { weight: 700 });
      else if (p?.kind === "text") effect(id, { color, weight: 700, ...(design ? { glowLevel: Math.max(keyGlow, Number(p.props.glowLevel ?? 0)) } : {}) });
      if (p?.kind === "path") effect(id, { ...(p.props.stroke && p.props.stroke !== "none" ? { stroke: color, strokeWidth: Number(p.props.strokeWidth ?? 6) * 1.5 } : { fill: color }), ...(design ? { glowLevel: Math.max(keyGlow, Number(p.props.glowLevel ?? 0)) } : {}) });
    };
    // Stepping back: the style's muted look where it has one (its color and how far it fades), else a plain fade.
    const muted = styleHas(ctx.theme, "muted") ? roleLook(ctx.theme, "muted") : undefined;
    const stepped = new Set<string>();
    const inside = (id: string): string[] => [...parts.values()].filter((q) => q.parent === id).flatMap((q) => [q.id, ...inside(q.id)]);
    // With a design layer, stepping back is the style's dim: each color moves the style's way (toward the page, or
    // down in lightness keeping its hue), its light drops to the dim glow and its lines thin, at full opacity. A
    // picture fades instead. An `amount` may only dim less than the style does, never past what it checked.
    const dimmed = (paint: string | number | number[] | undefined, d: NonNullable<typeof design>): string | undefined => {
      const hex = typeof paint === "string" ? colorOf(ctx.theme, paint) : undefined;
      return hex && /^#[0-9a-f]{6}$/i.test(hex) ? dimColor(hex, d, ctx.theme.colors) : undefined;
    };
    const stepBackDesigned = (id: string, amount: string | undefined, d: NonNullable<typeof design>) => {
      const by = amount === undefined ? d : { ...d, elements: { ...d.elements, dim: { ...d.elements.dim, amount: Math.min(d.elements.dim.amount, 1 - dimTo(amount)) } } };
      for (const q of [id, ...inside(id)]) {
        const p = parts.get(q);
        if (!p) continue;
        const now = { ...p.props, ...overrides.get(q), ...effects.get(q) };
        if (p.kind === "image") effect(q, { opacity: Math.max(readDim, 1 - by.elements.dim.amount) });
        if (p.kind === "text") {
          // Words step back only as far as they still read on what is behind them: the style checked its dim on the
          // page, and this keeps it true on panels, shapes and lit colors too.
          const w = wordsById.get(q);
          const back = w ? behind(w) : surface;
          let c = dimmed(now.color ?? "ink", by);
          if (c && !back.startsWith("picture:") && readability(ctx.theme, c, back) < MIN_CONTRAST) {
            const [lo0, hi0] = [0, by.elements.dim.amount];
            let [lo, hi] = [lo0, hi0];
            for (let i = 0; i < 12; i++) {
              const mid = (lo + hi) / 2;
              const t = dimmed(now.color ?? "ink", { ...d, elements: { ...d.elements, dim: { ...d.elements.dim, amount: mid } } })!;
              if (readability(ctx.theme, t, back) >= MIN_CONTRAST + 0.05) lo = mid;
              else hi = mid;
            }
            c = lo > 0.02 ? dimmed(now.color ?? "ink", { ...d, elements: { ...d.elements, dim: { ...d.elements.dim, amount: lo } } }) : undefined;
          }
          effect(q, { ...(c ? { color: c } : {}), glowLevel: d.elements.dim.glow });
        }
        if (p.kind === "path") {
          const out: Props = { glowLevel: d.elements.dim.glow };
          const stroke = now.stroke && now.stroke !== "none" ? dimmed(now.stroke, by) : undefined;
          const fill = now.fill && now.fill !== "none" ? dimmed(now.fill, by) : undefined;
          if (stroke) Object.assign(out, { stroke, strokeWidth: round(Number(now.strokeWidth ?? 6) * d.elements.dim.stroke) });
          if (fill) out.fill = fill;
          effect(q, out);
        }
        stepped.add(q);
      }
    };
    const stepBack = (id: string, amount: string | undefined) => {
      if (design) return stepBackDesigned(id, amount, design);
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
        // Laid-out words over a placed picture are a crowding problem, reported below with what to do about it.
        if (w.laid && laid.fields.some((f) => `picture:${f.id}` === back && !f.frame)) continue;
        if (once(w)) report(w.line, `"${w.text}" sits straight on the picture ${back.slice(8)} with nothing behind it, so it cannot read on every part of a photo. Put it on a panel (a stack with role=panel or back=COLOR), give it role=caption, or move it off the picture.`);
        continue;
      }
      const color = String((stepped.has(w.id) && !design ? undefined : effects.get(w.id)?.color) ?? overrides.get(w.id)?.color ?? part.props.color ?? "ink");
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
        // A part that left on its own (a text's second line, gone while its text was one line) comes back on its own too;
        // one that left with its parent comes back with it.
        if (!part.parent || !returning.has(part.parent)) (comeBack[id] ??= {}).opacity = typeof props.opacity === "number" ? props.opacity : 1;
        returning.add(id);
        was.props = props;
        was.alive = true;
        continue;
      }
      const spec: NodeSpec = { id, kind: part.kind, props, ...(part.parent ? { parent: part.parent } : {}), ...(part.under ? { under: part.under } : {}) };
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
    // Leaving things that sit where entering things arrive go first, quickly, so old words never fade out under new ones;
    // the new ones start in before the old are quite gone, so the board is never empty between two states that both
    // have something on it. Leaving things under something that moves into their place also go quickly.
    const now = new Map<string, Box>();
    for (const w of [...laidWords, ...drawnWords]) now.set(w.id, w.box);
    for (const f of laid.fields) if (!f.frame) now.set(f.id, f.box);
    for (const [id, b] of laid.boxes) if (!now.has(id) && parts.has(id) && (parts.get(id)!.kind !== "group" || parts.has(`${id}.shape`) || laid.slots.some((x) => x.item.id === id))) now.set(id, b);
    const goneBoxes = [...before].filter(([id]) => !parts.has(id)).map(([, b]) => b);
    const comingBoxes = [...now].filter(([id]) => fresh.has(id) || returning.has(id)).map(([, b]) => b);
    const movingBoxes = [...now].filter(([id, b]) => !fresh.has(id) && before.has(id) && (Math.abs(before.get(id)!.x - b.x) > 4 || Math.abs(before.get(id)!.y - b.y) > 4)).map(([, b]) => b);
    const meets = (list: Box[]) => goneBoxes.some((g) => list.some((c) => hits(g, c) > 0.1 * Math.min(g.w * g.h, c.w * c.h)));
    const crossing = !s.cut && meets(comingBoxes);
    const quick = !s.cut && (crossing || meets(movingBoxes));
    // Never past the next state, which may already change what arrives here.
    const nextAt = index + 1 < doc.states.length ? when(doc.states[index + 1]!.at, ctx) : Infinity;
    const leave = quick ? Math.max(2, Math.min(Math.max(4, Math.round(ctx.fps * 0.2)), nextAt - at - 2)) : 0;
    const delay = crossing ? Math.max(1, Math.round(leave / 3)) : 0;
    const enterAt = at + delay;
    before = now;
    saidBefore.clear();
    for (const w of [...laidWords, ...drawnWords]) if (w.text !== undefined) saidBefore.set(w.id, w.text);
    labelsBefore.clear();
    for (const [k, v] of labelsNow) labelsBefore.set(k, v);

    // Everything arrives first, so anything in this state can act on anything new in it. A cut changes everything at
    // once: what leaves is gone and what moves is in place on the frame the cut lands.
    if (Object.keys(preset).length) steps.push({ at: Math.max(0, at - 1), move: { frames: 1 }, set: preset });
    const moved = s.cut ? { move: { frames: 1 } } : Object.keys(move).length ? { move } : {};
    // After a crossing, what arrives comes up quickly, so the board is not left bare between the two.
    const arriving = crossing ? { move: { frames: s.attrs.move ? Number(s.attrs.move) : Math.min(ctx.theme.moveFrames, Math.round(ctx.fps * 0.4)), ease: (s.attrs.ease as Ease) ?? "out" } } : moved;
    // Something that simply appears is still hidden until its moment: it fades in over the single frame before it.
    const appear = (add: NodeSpec[]) => steps.push({ at: enterAt - 1, move: { frames: 1 }, enter: "fade", add });
    const mainEnter = s.attrs.enter ?? (s.cut ? "none" : undefined);
    if (addScaled.length) {
      if (s.attrs.enter === "none" || s.cut) appear(addScaled);
      else steps.push({ at: enterAt, ...(crossing ? arriving : {}), enter: "fade", add: addScaled });
    }
    if (addMain.length) {
      if (mainEnter === "none") appear(addMain);
      else steps.push({ at: enterAt, ...arriving, ...(mainEnter ? { enter: mainEnter as Step["enter"] } : {}), add: addMain });
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
    if (remove.length && !leave) change.remove = remove;
    if (change.set || change.remove) steps.push(change);
    // A quick leave drops fast at first, so what is going is mostly gone by the time anything new is in.
    if (remove.length && leave) steps.push({ at, move: { frames: leave, ease: "out" }, remove });
    if (Object.keys(comeBack).length) steps.push({ at: s.cut ? at - 1 : enterAt, ...arriving, set: comeBack });
    const acts: Step = { at: enterAt, ...moved };
    if (play.length || arrivals.length) acts.play = [...arrivals, ...play];
    if (emit.length) acts.emit = emit;
    if (acts.play || acts.emit) steps.push(acts);
    // A scene that moves the camera itself, or keeps it moved, keeps it: the camera only follows from rest.
    for (const p of play) if (p.behavior === "steps" && typeof parts.get(p.target)?.props.truth === "string") follows.push({ at: enterAt, target: p.target, args: p.args ?? {}, still: !!cam || view !== REST, root: parts.get(p.target)!.props, line: s.line, tags: attached.filter((c) => c.do === "tag" && c.target.startsWith(`${p.target}.`)).map((c) => ({ c, box: wordsById.get(attachedId(c))?.box })) });
    // Tags, and words that arrive in this state (a question put during a hold), must stay in view whatever it follows.
    stateWords.push({ at, words: keyWords, tags: new Set([...drawnWords.map((w) => w.id), ...newWords]) });
    if (laterPlay.length) steps.push({ at: enterAt, play: laterPlay });
    laterPlay = [];
  }

  // A truth thing plays each step once, in order, across the whole scene: a play that starts at a step already played
  // is refused on its own line, so a scene joined from parts says which part to change.
  const playedTo = new Map<string, number>();
  for (const st of doc.states) {
    for (const c of st.commands) {
      if (c.do !== "play" || c.behavior !== "steps") continue;
      for (const t of c.targets) {
        const root = expansions.get(t)?.nodes.find((x) => x.id === t);
        if (typeof root?.props?.truth !== "string" || typeof root.props.spec !== "string") continue;
        let n: number;
        try {
          n = storyOf(root.props.truth, t, root.props.spec, kitCtx).steps.length;
        } catch {
          continue;
        }
        const done = playedTo.get(t) ?? Number(root.props.played ?? 0);
        const from = number(c.attrs.from ?? "") ?? 1;
        const to = number(c.attrs.to ?? "") ?? n;
        if (from <= done) report(c.line, `${t} has already played steps 1 to ${done} before this line${playedTo.has(t) ? "" : ` (it is made with done=${done})`}, and a step never plays twice, so this play must start at from=${done + 1}${done < n ? "" : ", but no steps are left"}. Play only the steps this stretch is about.`);
        playedTo.set(t, Math.max(done, to));
      }
    }
  }
  if (problems.length) return { problems: dedupe(problems), stats };

  // The camera follows computed work that would read small. A demonstration whose values come out smaller than about a
  // tenth of the frame's width is shown whole when it starts, then the camera moves in on what its steps work on: on
  // each step at pace=slow (a close look, which a hold gets too), and on all that a quicker stretch of steps works on,
  // which is wider; once a stretch of steps ends, and at the end of the story, it pulls back to the whole. It never
  // moves while the scene has moved the camera itself, and stops where the scene moves it next. Any view it takes holds
  // every tag on screen whole and every line of words whole or wholly out of view; where that cannot be, it goes wider.
  const sceneShots = shots.map((x) => x.at);
  const FOLLOW_SPAN: Record<string, number> = { slow: 0, normal: 1.2, fast: 1.8 };
  const autoShots: typeof shots = [];
  const lead = Math.round(ctx.fps * 0.15);
  const glide = Math.max(ctx.theme.moveFrames, Math.round(ctx.fps * 0.5));
  const frameView = (v: View): View => {
    const [hw, hh] = [ctx.width / (2 * v.zoom), ctx.height / (2 * v.zoom)];
    return { panX: round(Math.min(Math.max(v.panX, hw), ctx.width - hw)), panY: round(Math.min(Math.max(v.panY, hh), ctx.height - hh)), zoom: Math.round(v.zoom * 10000) / 10000 };
  };
  const inside = (b: Box, v: View) => {
    const a = allowedIn(v);
    return b.x - b.w / 2 >= a.x - a.w / 2 - 1 && b.x + b.w / 2 <= a.x + a.w / 2 + 1 && b.y - b.h / 2 >= a.y - a.h / 2 - 1 && b.y + b.h / 2 <= a.y + a.h / 2 + 1;
  };
  // The closest view, up to `most`, that shows the region whole, with the tags and the words just arrived, and leaves
  // every other line of words whole or wholly out of view: centered on them, or moved just enough to clear a cut line.
  // Every line of words beside the followed thing (a heading, a caption, a question) is what the viewer reads as its
  // steps play, so the view keeps them all in, and goes only as close as they allow.
  const viewOn = (area: Box, most: number, from: number, to: number, own: Seen[] = [], target = ""): View | undefined => {
    const seen = stateWords.filter((w, i) => w.at < to && (stateWords[i + 1]?.at ?? Infinity) > from);
    const r = union([area, ...seen.flatMap((w) => w.words.filter((x) => x.slot !== target && !x.id.startsWith(`${target}.`)).map((x) => x.box))]);
    // The kit's own words where its steps put them, too: a value half out of view is as unreadable as a cut line.
    const cuts = (v: View) => [...seen.flatMap((w) => cutFrom(v, w.words, w.tags)), ...cutFrom(v, own)];
    for (let z = Math.min(most, 0.94 * Math.min(safe.w / Math.max(1, r.w), safe.h / Math.max(1, r.h))); z >= 1.12; z *= 0.93) {
      const base = frameView({ panX: r.x, panY: r.y - (safe.y - ctx.height / 2) / z, zoom: z });
      // The view centered on them, else the nearest one around it whose edges fall between things rather than through them.
      const f = frameIn(base);
      const tries = Array.from({ length: 17 * 17 }, (_, i) => [((i % 17) - 8) / 16, (Math.floor(i / 17) - 8) / 16] as const)
        .sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]))
        .map(([dx, dy]) => frameView({ ...base, panX: base.panX + dx * f.w, panY: base.panY + dy * f.h }));
      const v = tries.find((x) => inside(r, x) && !cuts(x).length);
      if (v) return v;
    }
  };
  // Words tagged on a part of a computed thing travel with that part as its steps play. Where that carries them onto the
  // thing's values, both stop reading, so it is refused with the step it happens at.
  for (const f of follows) {
    const made = expansions.get(f.target);
    if (!made || typeof f.root.truth !== "string" || typeof f.root.spec !== "string") continue;
    let board: ReturnType<typeof storyOf>;
    try {
      board = storyOf(f.root.truth, f.target, f.root.spec, kitCtx);
    } catch {
      continue;
    }
    const plan = stepSchedule(f.args, f.at, board.steps.length, ctx);
    const k = Number(f.root.scaleX ?? 1);
    const inScene = (b: Area): Box => ({ x: Number(f.root.x ?? 0) + b.x * k, y: Number(f.root.y ?? 0) + b.y * k, w: b.w * k, h: b.h * k });
    // Under a camera the scene set itself, the values its steps move must stay whole in view: a value the steps carry
    // to the edge of a close view is cut there. (The camera that follows keeps them whole on its own.)
    if (f.still) {
      for (let j = 0; j < plan.times.length; j++) {
        const step = plan.from + j;
        const shot = shots.filter((x) => x.at <= plan.times[j]!).at(-1);
        if (!shot || shot.view.zoom <= 1.0001) continue;
        const values: Seen[] = wordsAfter(board, made.nodes, step).map((w) => ({ id: w.id, box: inScene(w.box), line: f.line, what: "text", text: w.text, laid: false }));
        const cut = cutFrom(shot.view, values);
        if (!cut.length) continue;
        report(shot.line, `With the camera on line ${shot.line} (zoom ${shot.view.zoom.toFixed(2)}), step ${step} of ${f.target} (${board.steps[step - 1]!.say}) carries ${cut.map((w) => `"${w.text}"`).slice(0, 3).join(", ")} to the edge of the view, where ${cut.length > 1 ? "they are" : "it is"} cut. Frame what the steps move: a lower zoom, the whole of ${f.target}, or no camera line, so the camera follows the work itself.`);
        break;
      }
    }
    if (!f.tags.length) continue;
    for (const { c, box } of f.tags) {
      if (c.do !== "tag" || !box) continue;
      const start = partAt(board, made.nodes, c.target, plan.from - 1);
      for (let step = plan.from; step <= plan.to && start; step++) {
        const now = partAt(board, made.nodes, c.target, step)!;
        const moved = { ...box, x: box.x + (now.x - start.x) * k, y: box.y + (now.y - start.y) * k };
        const under = wordsAfter(board, made.nodes, step).filter((w) => !w.id.startsWith(`${c.target}.`)).map((w) => ({ ...w, box: inScene(w.box) })).find((w) => hits(moved, w.box) > 0.2 * Math.min(moved.w * moved.h, w.box.w * w.box.h));
        if (!under) continue;
        report(c.line, `"${c.text}" is tagged on ${c.target}, which moves as ${f.target} plays, and at step ${step} (${board.steps[step - 1]!.say}) it carries the words onto the value "${under.text}", so neither reads. Tag something that stays clear of the values, put the words beside ${f.target} as a whole, or leave the moving part to speak for itself.`);
        break;
      }
    }
  }

  for (let i = 0; i < follows.length; i++) {
    const f = follows[i]!;
    const item = kitItems.get(f.target);
    const made = expansions.get(f.target);
    if (f.still || !item || !made || item.attrs.follow === "no" || typeof f.root.truth !== "string" || typeof f.root.spec !== "string") continue;
    const k = Number(f.root.scaleX ?? 1);
    const font = (textSize(made.nodes) ?? 0) * k;
    // Large enough already: about a tenth of the frame's width, the size of a title.
    const target = ctx.width * 0.09;
    if (!font || font >= target * 0.9) continue;
    let board: ReturnType<typeof storyOf>;
    try {
      board = storyOf(f.root.truth, f.target, f.root.spec, kitCtx);
    } catch {
      continue;
    }
    const plan = stepSchedule(f.args, f.at, board.steps.length, ctx);
    if (!plan.times.length) continue;
    const toScene = (a: Area): Box => ({ x: Number(f.root.x ?? 0) + a.x * k, y: Number(f.root.y ?? 0) + a.y * k, w: a.w * k, h: a.h * k });
    const areas = stepAreas(board, made.nodes, plan.from, plan.to).map((a) => (a ? toScene(a) : undefined));
    const stop = Math.min(...sceneShots.filter((t) => t > f.at), Infinity);
    const end = plan.times.at(-1)! + plan.longest;
    const most = Math.min(3, target / font);
    const views: { at: number; view: View; until: number }[] = [];
    // Steps are taken together in spans of at least this long, so the camera moves at a pace a viewer can follow: every
    // step when slow, a few at a time when quicker, which also frames them wider.
    const span = (FOLLOW_SPAN[plan.pace ?? "normal"] ?? 1.2) * ctx.fps;
    const groups: number[][] = [];
    plan.times.forEach((t, j) => {
      const g = groups.at(-1);
      if (g && t - plan.times[g[0]!]! < span) g.push(j);
      else groups.push([j]);
    });
    groups.forEach((g, n) => {
      const list = g.map((j) => areas[j]).filter((a): a is Box => !!a);
      const at = plan.times[g[0]!]!;
      const until = groups[n + 1] ? plan.times[groups[n + 1]![0]!]! : end;
      const own = [plan.from + g[0]! - 1, ...g.map((j) => plan.from + j)].flatMap((step) => wordsAfter(board, made.nodes, step)).map((w): Seen => ({ id: w.id, box: toScene(w.box), line: f.line, what: "text", text: w.text, laid: false, slot: f.target }));
      const v = list.length ? viewOn(union(list), most, at, until, own, f.target) : undefined;
      views.push({ at: Math.max(f.at, at - lead), view: v ?? REST, until });
    });
    if (!views.some((v) => v.view !== REST)) continue;
    for (const v of views) {
      if (v.at >= stop) break;
      const last = autoShots.at(-1);
      if (!last && v.view === REST) continue;
      if (last && Math.abs(last.view.zoom - v.view.zoom) < 0.01 && Math.abs(last.view.panX - v.view.panX) < 4 && Math.abs(last.view.panY - v.view.panY) < 4) continue;
      autoShots.push({ at: v.at, frames: Math.max(4, Math.min(glide, v.until - v.at)), ease: "smooth", view: v.view, drift: 0, line: f.line, zoomBy: 1 });
    }
    // Back to the whole when this stretch of steps is over, unless more steps follow straight on.
    const back = end + Math.round(ctx.fps * 0.3);
    const next = follows[i + 1];
    const onward = next && !next.still && next.target === f.target && next.at <= back + ctx.fps;
    if (!onward && back < stop && back < ctx.frames - 1) autoShots.push({ at: back, frames: glide, ease: "smooth", view: REST, drift: 0, line: f.line, zoomBy: 1 });
  }
  shots.push(...autoShots);
  shots.sort((a, b) => a.at - b.at);

  // The camera's moves. After it lands it may keep drifting closer until its next move, as a slow push-in.
  shots.forEach((c, i) => {
    steps.push({ at: c.at, move: { frames: c.frames, ease: c.ease }, set: { camera: { ...c.view } } });
    const land = c.at + c.frames;
    const end = shots[i + 1]?.at ?? ctx.frames - 1;
    if (!c.drift || end <= land + 1) return;
    // The drift pushes in only as far as it can without cutting words that were whole when it landed.
    const lists = seenAt.filter((x) => x.at >= c.at && x.at < end).map((x) => x.list);
    const worse = (zoom: number) => lists.some((list) => cutFrom({ ...c.view, zoom }, list).length > cutFrom(c.view, list).length);
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
    const scene = settle(compile(sceneDoc, kitCtx));
    if (heldAt.length) scene.held = heldAt;
    for (const f of [0, Math.floor(ctx.frames / 2), ctx.frames - 1]) evaluate(scene, f);
    // A position or size that is not a number draws nothing where it should be and drags its neighbors with it. Say
    // which thing it was, so it is repaired rather than shipped.
    const broken = [...scene.nodes.filter((n) => Object.values(n.props).some((v) => typeof v === "number" && !Number.isFinite(v))).map((n) => n.id), ...scene.tracks.filter((t) => t.keys.some((k) => typeof k.value === "number" && !Number.isFinite(k.value))).map((t) => t.target)];
    if (broken.length) {
      const first = [...new Set(broken.map((id) => id.split(".")[0]!))].slice(0, 4);
      report(0, `${first.join(", ")} came out with a position or size that is not a number, so it and what is laid out with it would not show. Check its settings (a size as a word on something that takes a number, a missing value), or give it plain settings.`);
      return { problems, stats };
    }
    withheldEarly(scene, doc, momentOf, words, ctx.fps).forEach((p) => report(p.line, p.message));
    falseOrder(scene, doc, momentOf, ctx).forEach((p) => report(p.line, p.message));
    if (problems.length) return { problems, stats };
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
    return { problems: [], doc: sceneDoc, scene, ...(truth.length ? { truth } : {}), ...(notes.length ? { notes: [...new Set(notes)].slice(0, 6) } : {}), stats };
  } catch (e) {
    return { problems: [{ line: 0, message: `The scene could not be built: ${(e as Error).message}` }], doc: sceneDoc, stats };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks on the compiled scene: what the viewer would really see, frame by frame.

type Shown = { opacity: number; x: number; y: number; text?: string; size?: number; truth?: string };
// Everything visible at a frame, with where it sits (offsets added up its parents; scale is ignored, which keeps the
// order of things that share a parent) and what it says.
function shownAt(scene: Scene, frame: number): Map<string, Shown> {
  const out = new Map<string, Shown>();
  const walk = (list: Resolved[], o: number, x: number, y: number) => {
    for (const n of list) {
      const opacity = o * Number(n.props.opacity ?? 1);
      if (opacity <= 0.05) continue;
      const [nx, ny] = [x + Number(n.props.x ?? 0), y + Number(n.props.y ?? 0)];
      out.set(n.id, { opacity, x: nx, y: ny, ...(n.kind === "text" ? { text: String(n.props.text ?? ""), size: Number(n.props.size ?? 40) } : {}), ...(typeof n.props.truth === "string" ? { truth: n.props.truth } : {}) });
      walk(n.children, opacity, nx, ny);
    }
  };
  walk(evaluate(scene, frame), 1, 0, 0);
  return out;
}

const within = (id: string, t: string) => id === t || id.startsWith(`${t}.`);
// What an id names on screen: itself and, for an arrangement (which draws nothing of its own), everything inside it.
function membersOf(doc: Doc): (id: string) => string[] {
  const inside = new Map<string, Set<string>>();
  const walk = (i: Item): string[] => {
    const own = i.kind === "atoms" ? (i.parts ?? []).flatMap((p) => (p.type === "text" ? [p.atom] : p.type === "frac" ? [...p.num, ...p.den] : p.rows.flat())).map((a) => a.id) : [];
    const all = [...own, ...i.children.flatMap((c) => [c.id, ...walk(c)])];
    const set = inside.get(i.id) ?? inside.set(i.id, new Set()).get(i.id)!;
    all.forEach((x) => set.add(x));
    return all;
  };
  doc.states.forEach((s) => s.items.forEach(walk));
  return (id) => [id, ...(inside.get(id) ?? [])];
}
const wordNear = (frame: number, words: { text?: string; start: number }[], fps: number) => {
  let k = 0;
  while (k + 1 < words.length && Math.round(words[k + 1]!.start * fps) <= frame) k++;
  return k;
};

// A withheld thing on screen before its moment spoils what the video holds back. Checked on the built scene, a few
// frames apart, so it catches every way a thing can show: listed, carried, faded in by a step or a program.
function withheldEarly(scene: Scene, doc: Doc, momentOf: (t: Time, line: number) => number, words: { text?: string; start: number }[], fps: number): Problem[] {
  const out: Problem[] = [];
  const members = membersOf(doc);
  const open = doc.withholds.filter((w) => w.targets.length).map((w) => ({ w, until: momentOf(w.until, w.line) }));
  const last = Math.max(0, ...open.map((x) => x.until));
  for (let f = 0; f < last && open.length; f += 2) {
    const seen = [...shownAt(scene, f).keys()];
    for (let k = open.length - 1; k >= 0; k--) {
      const { w, until } = open[k]!;
      if (f >= until) {
        open.splice(k, 1);
        continue;
      }
      const hit = w.targets.find((t) => members(t).some((m) => seen.some((id) => within(id, m))));
      if (!hit) continue;
      const near = wordNear(f, words, fps);
      out.push({ line: w.line, message: `${hit} is on screen at ${(f / fps).toFixed(1)} s, near word ${near}${words[near]?.text ? ` ("${words[near]!.text}")` : ""}, but it is withheld until @${w.until.word}${w.until.offset ? `${w.until.offset > 0 ? "+" : ""}${w.until.offset}` : ""}. Nothing of it may be seen before then: bring it in at that moment or later, and leave it out of every state before it. If ${hit} is not the withheld thing, take it out of this withhold line.` });
      open.splice(k, 1);
    }
  }
  return out;
}

// Words attached to numbers that say they are in order must be true while they are on screen. The numbers are read
// from the built scene where the words are, so a computed thing and a hand-made row are held to the same truth.
const CLAIM = /\b(sorted|in order|ascending|increasing|descending|decreasing)\b/i;
const DENIED = /\b(not|never|no|isn't|aren't|unless|until|before)\b[^.;:,]{0,16}\b(sorted|in order|ascending|increasing|descending|decreasing)\b/i;
const NUMERIC = /^[−-]?\d+(?:[.,]\d+)?$/;
function falseOrder(scene: Scene, doc: Doc, momentOf: (t: Time, line: number) => number, ctx: CompileContext): Problem[] {
  const out: Problem[] = [];
  const told = new Set<number>();
  const members = membersOf(doc);
  doc.states.forEach((s, index) => {
    const end = (index + 1 < doc.states.length ? momentOf(doc.states[index + 1]!.at, doc.states[index + 1]!.line) : ctx.frames) - 1;
    for (const c of s.commands) {
      if ((c.do !== "tag" && c.do !== "mark") || !c.text || told.has(c.line)) continue;
      const claim = CLAIM.exec(c.text);
      if (!claim || DENIED.test(c.text)) continue;
      const targets = c.do === "tag" ? [c.target] : c.targets;
      const seen = shownAt(scene, end);
      if (!seen.has(attachedId(c)) && ![...seen.keys()].some((id) => id.startsWith(`${attachedId(c)}.`))) continue;
      const numbers = [...seen].filter(([id, n]) => n.text !== undefined && NUMERIC.test(n.text.trim()) && targets.some((t) => members(t).some((m) => within(id, m))));
      if (numbers.length < 2) continue;
      // Rows read top to bottom, each left to right; each row must hold its order.
      const band = Math.max(20, ...numbers.map(([, n]) => (n.size ?? 40) * 0.8));
      const rows = new Map<number, { x: number; v: number; t: string }[]>();
      for (const [, n] of numbers) {
        const key = Math.round(n.y / band);
        (rows.get(key) ?? rows.set(key, []).get(key)!).push({ x: n.x, v: Number(n.text!.trim().replace("−", "-").replace(",", ".")), t: n.text!.trim() });
      }
      const word = claim[1]!.toLowerCase();
      const up = (v: number[]) => v.every((x, i) => i === 0 || x >= v[i - 1]!);
      const down = (v: number[]) => v.every((x, i) => i === 0 || x <= v[i - 1]!);
      // Sorted or in order means smallest first, unless the words say the other way.
      const ok = (v: number[]) => (["descending", "decreasing"].includes(word) || /\b(descending|decreasing|largest first|biggest first)\b/i.test(c.text!) ? down(v) : up(v));
      const wrong = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r.sort((a, b) => a.x - b.x)).find((r) => r.length >= 2 && !ok(r.map((x) => x.v)));
      if (!wrong) continue;
      told.add(c.line);
      out.push({ line: c.line, message: `"${c.text}" says ${targets.join(", ")} ${targets.length > 1 ? "are" : "is"} ${word}, but as this state ends it shows ${wrong.map((x) => x.t).join(", ")}, which is not. Words on screen must be true while they are there: attach them once the order is really there (after the step that makes it so), say what is true now, or let a kit's own steps show the order.` });
    }
  });
  return out;
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
