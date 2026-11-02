// Turns a scene document into a scene: resolves spoken moments, expands kits into primitives, and writes the tracks.
import { BEHAVIORS } from "./behaviors.ts";
import type { CompileContext, Moment, NodeSpec, Primitive, Props, Scene, SceneDoc, SceneEvent, SceneNode, Track, Value } from "./types.ts";

const PRIMITIVES = new Set(["group", "path", "text", "image"]);
const DEFAULTS: Props = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, skew: 0, opacity: 1, drawn: 1 };

export function when(m: Moment, ctx: CompileContext): number {
  if (typeof m === "number") return m;
  const word = ctx.words?.[m.word];
  if (!word) throw new Error(`no spoken word ${m.word}`);
  return Math.round(word.start * ctx.fps) + (m.offset ?? 0);
}

export function compile(doc: SceneDoc, ctx: CompileContext): Scene {
  const kinds = Object.assign({}, ...(ctx.kits ?? []).map((k) => k.kinds)) as NonNullable<NonNullable<CompileContext["kits"]>[number]["kinds"]>;
  const behaviors = Object.assign({}, BEHAVIORS, ...(ctx.kits ?? []).map((k) => k.behaviors));
  const color = (v: Value): Value => (typeof v === "string" && ctx.theme.colors[v]) || v;
  const paint = (p: Props) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, /^(fill|stroke|color|pulseColor)$/.test(k) ? color(v) : v]));

  const nodes: SceneNode[] = [];
  const known = new Map<string, Props>();
  const tracks = new Map<string, Track>();
  const events: SceneEvent[] = [];

  const track = (target: string, prop: string) => {
    const key = `${target}\u0000${prop}`;
    return tracks.get(key) ?? tracks.set(key, { target, prop, keys: [] }).get(key)!;
  };
  // A change holds the old value until `at`, then moves to the new one.
  const change = (target: string, prop: string, value: Value, at: number, frames: number, ease = ctx.theme.ease) => {
    const props = known.get(target);
    if (!props) throw new Error(`nothing called ${target}`);
    const t = track(target, prop);
    const from = t.keys.at(-1)?.value ?? props[prop] ?? DEFAULTS[prop] ?? value;
    if (!t.keys.length) t.keys.push({ at: 0, value: from });
    if (at > t.keys.at(-1)!.at) t.keys.push({ at, value: from });
    t.keys.push({ at: at + Math.max(1, frames), value, ease });
    props[prop] = value;
  };
  const expand = (n: NodeSpec): NodeSpec[] => {
    if (PRIMITIVES.has(n.kind)) return [n];
    const make = kinds[n.kind];
    if (!make) throw new Error(`unknown kind ${n.kind} on ${n.id}`);
    return make(n, ctx).flatMap(expand);
  };

  const steps = doc.steps.map((s) => ({ s, at: when(s.at, ctx) })).sort((a, b) => a.at - b.at);
  for (const { s, at } of steps) {
    const frames = s.move?.frames ?? ctx.theme.moveFrames;
    const ease = s.move?.ease;
    for (const spec of s.add ?? []) {
      for (const n of expand(spec)) {
        const props = paint({ ...DEFAULTS, ...n.props });
        nodes.push({ id: n.id, kind: n.kind as Primitive, parent: n.parent, props });
        known.set(n.id, { ...props });
        const enter = s.enter ?? "fade";
        if (enter === "none") continue;
        const final = enter === "draw" && n.kind === "path" ? "drawn" : "opacity";
        const end = props[final] as number;
        known.get(n.id)![final] = 0;
        props[final] = 0;
        change(n.id, final, end, at, frames, ease ?? "smooth");
        if (enter === "pop") {
          known.get(n.id)!.scaleX = known.get(n.id)!.scaleY = 0.2;
          change(n.id, "scaleX", 1, at, frames, "spring");
          change(n.id, "scaleY", 1, at, frames, "spring");
        }
      }
    }
    for (const [target, props] of Object.entries(s.set ?? {})) {
      for (const [prop, value] of Object.entries(paint(props))) change(target, prop, value, at, frames, ease);
    }
    for (const id of s.remove ?? []) change(id, "opacity", 0, at, frames, ease ?? "smooth");
    for (const p of s.play ?? []) {
      const behave = behaviors[p.behavior];
      if (!behave) throw new Error(`unknown behavior ${p.behavior}`);
      if (!known.has(p.target)) throw new Error(`nothing called ${p.target}`);
      for (const made of behave({ target: p.target, start: at, args: p.args ?? {}, ctx, now: (prop: string) => known.get(p.target)![prop] }) as Track[]) {
        const t = track(made.target, made.prop);
        if (!t.keys.length && made.keys[0]!.at > 0) t.keys.push({ at: 0, value: made.keys[0]!.value });
        t.keys.push(...made.keys.map((k) => ({ ...k, value: color(k.value) })));
      }
    }
    for (const e of s.emit ?? []) events.push({ ...e, at });
  }
  return { fps: ctx.fps, width: ctx.width, height: ctx.height, frames: ctx.frames, background: String(color(doc.background ?? "paper")), nodes, tracks: [...tracks.values()], events };
}
