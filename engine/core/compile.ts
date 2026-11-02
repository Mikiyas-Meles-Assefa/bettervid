// Turns a scene document into a scene: resolves spoken moments, expands kits into primitives, and writes the tracks.
// How overlapping changes combine is decided in engine/motion/compose.ts.
import { Timeline } from "../motion/compose.ts";
import { CAMERA, cameraConstraint, cameraProps, usesCamera } from "../motion/camera.ts";
import { BEHAVIORS } from "./behaviors.ts";
import type { Behavior, CompileContext, Ease, Moment, MotionTools, NodeSpec, Primitive, Props, Scene, SceneDoc, SceneEvent, SceneNode, Value } from "./types.ts";

const PRIMITIVES = new Set(["group", "path", "text", "image"]);
const DEFAULTS: Props = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, skew: 0, opacity: 1, drawn: 1 };
const RESTING: Props = { pulse: -1 }; // what a property means before anything has set it, for props a node does not carry
const PAINT = /^(fill|stroke|color|pulseColor)$/;

export function when(m: Moment, ctx: CompileContext): number {
  if (typeof m === "number") return m;
  const word = ctx.words?.[m.word];
  if (!word) throw new Error(`no spoken word ${m.word}`);
  return Math.round(word.start * ctx.fps) + (m.offset ?? 0);
}

export function compile(doc: SceneDoc, ctx: CompileContext): Scene {
  const kinds = Object.assign({}, ...(ctx.kits ?? []).map((k) => k.kinds)) as NonNullable<NonNullable<CompileContext["kits"]>[number]["kinds"]>;
  const behaviors: Record<string, Behavior> = Object.assign({}, BEHAVIORS, ...(ctx.kits ?? []).map((k) => k.behaviors));
  const color = (v: Value): Value => (typeof v === "string" && ctx.theme.colors[v]) || v;
  const paint = (p: Props) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, PAINT.test(k) ? color(v) : v]));

  const nodes: SceneNode[] = [];
  const known = new Map<string, Props>(); // what each node starts as, before any track
  const parents = new Map<string, string | undefined>();
  const events: SceneEvent[] = [];
  const timeline = new Timeline((id, prop) => known.get(id)?.[prop] ?? DEFAULTS[prop] ?? RESTING[prop], (id) => parents.get(id));

  const need = (id: string) => {
    if (!known.has(id)) throw new Error(`nothing called ${id}`);
  };
  const change = (target: string, prop: string, value: Value, at: number, frames: number, ease: Ease = ctx.theme.ease, add?: boolean) => {
    need(target);
    timeline.change(target, prop, value, at, frames, ease, add);
  };
  const expand = (n: NodeSpec): NodeSpec[] => {
    if (PRIMITIVES.has(n.kind)) return [n];
    const make = kinds[n.kind];
    if (!make) throw new Error(`unknown kind ${n.kind} on ${n.id}`);
    return make(n, ctx).flatMap(expand);
  };

  // A camera exists only if the document uses one. Everything then hangs from it, except nodes marked `screen`.
  const camera = usesCamera(doc);
  const place = (n: NodeSpec, props: Props, before?: string) => {
    if (known.has(n.id)) throw new Error(`two things called ${n.id}`);
    const parent = n.parent ?? (camera && !props.screen && n.id !== CAMERA ? CAMERA : undefined);
    const node: SceneNode = { id: n.id, kind: n.kind as Primitive, parent, props };
    const index = before ? nodes.findIndex((x) => x.id === before) : -1;
    if (index >= 0) nodes.splice(index, 0, node);
    else nodes.push(node);
    parents.set(n.id, parent);
    known.set(n.id, { ...props });
  };
  if (camera) {
    place({ id: CAMERA, kind: "group" }, { ...DEFAULTS, ...cameraProps(ctx) });
    timeline.constrain(cameraConstraint(ctx));
  }

  const select = (pattern: string): string[] => {
    if (!pattern.includes("*")) {
      need(pattern);
      return [pattern];
    }
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^.]*").replace(/\u0000/g, ".*")}$`);
    const found = nodes.map((n) => n.id).filter((id) => re.test(id));
    if (!found.length) throw new Error(`nothing matches ${pattern}`);
    return found;
  };

  const run = (name: string, target: string, start: number, args: Record<string, Value> = {}) => {
    const behave = behaviors[name];
    if (!behave) throw new Error(`unknown behavior ${name}`);
    for (const id of behave.selects ? [target] : select(target)) {
      if (!behave.selects) need(id);
      const made = behave({ target: id, start, args, ctx, now: (prop) => timeline.value(id, prop, start), tools });
      for (const t of made) tools.write(t);
    }
  };

  const tools: MotionTools = {
    select,
    has: (id) => known.has(id),
    kind: (id) => {
      need(id);
      return nodes.find((n) => n.id === id)!.kind;
    },
    parent: (id) => parents.get(id),
    props: (id) => {
      need(id);
      return { ...known.get(id)! };
    },
    children: (id) => nodes.filter((n) => parents.get(n.id) === id).map((n) => n.id),
    value: (id, prop, frame) => timeline.value(id, prop, frame),
    matrix: (id, frame) => timeline.matrix(id, frame),
    spawn: (n, where) => {
      for (const part of expand(n)) place(part, paint({ ...DEFAULTS, ...part.props }), where?.before);
    },
    run,
    write: (t) => {
      need(t.target);
      timeline.write(PAINT.test(t.prop) ? { ...t, keys: t.keys.map((k) => ({ ...k, value: color(k.value) })) } : t);
    },
    constrain: (c) => {
      need(c.target);
      timeline.constrain(c);
    },
    emit: (e) => events.push(e),
  };

  const steps = doc.steps.map((s) => ({ s, at: when(s.at, ctx) })).sort((a, b) => a.at - b.at);
  for (const { s, at } of steps) {
    const frames = s.move?.frames ?? ctx.theme.moveFrames;
    const ease = s.move?.ease;
    const add = s.move?.blend === "add";
    const gap = s.move?.stagger ?? 0;
    let turn = 0;
    for (const spec of s.add ?? []) {
      for (const n of expand(spec)) {
        const props = paint({ ...DEFAULTS, ...n.props });
        place(n, props, n.under && known.has(n.under) && parents.get(n.under) === (n.parent ?? (camera && !props.screen ? CAMERA : undefined)) ? n.under : undefined);
        const enter = s.enter ?? ctx.theme.enter ?? "fade";
        if (enter === "none") continue;
        const final = enter === "draw" && n.kind === "path" ? "drawn" : "opacity";
        const end = props[final] as number;
        known.get(n.id)![final] = 0;
        props[final] = 0;
        const begin = at + gap * turn++;
        change(n.id, final, end, begin, frames, ease ?? "smooth");
        if (enter === "pop") {
          known.get(n.id)!.scaleX = known.get(n.id)!.scaleY = 0.2;
          change(n.id, "scaleX", 1, begin, frames, "spring");
          change(n.id, "scaleY", 1, begin, frames, "spring");
        }
      }
    }
    for (const [pattern, props] of Object.entries(s.set ?? {})) {
      for (const target of select(pattern)) {
        const begin = at + gap * turn++;
        for (const [prop, value] of Object.entries(paint(props))) change(target, prop, value, begin, frames, ease, add);
      }
    }
    for (const pattern of s.remove ?? []) {
      for (const id of select(pattern)) change(id, "opacity", 0, at + gap * turn++, frames, ease ?? "smooth");
    }
    for (const p of s.play ?? []) run(p.behavior, p.target, at, p.args);
    for (const e of s.emit ?? []) events.push({ ...e, at });
  }
  return { fps: ctx.fps, width: ctx.width, height: ctx.height, frames: ctx.frames, background: String(color(doc.background ?? "paper")), nodes, tracks: timeline.finish(), events };
}
