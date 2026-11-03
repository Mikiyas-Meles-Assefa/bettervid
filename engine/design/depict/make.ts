// The one machine behind every depiction. A kind of thing gives static nodes and a pure `draw(state)` for the props
// that depend on state; this turns that into a Depiction: states, verbs as data, `apply` as a diff of two drawings,
// and the pose every thing has (where it is, its angle, its size, how squashed, how visible, how lit).
import type { Ease, NodeSpec, Props, Theme, Value } from "../../core/types.ts";
import type { PropSpec } from "./spec.ts";
import type { ActResult, Change, DepictLook, Depiction, Part, Pt, StateDef, StateMap, StateValue, Timing, VerbDef } from "./types.ts";
import { isHex, luminance } from "./geom.ts";

/** What a kind's builder gets. `L` is the outline width in local units; `col` reads a named color of the real thing. */
export type BuildCtx = {
  id: string;
  spec: PropSpec;
  theme: Theme;
  look: DepictLook;
  L: number;
  col(name: string): string | undefined;
  param<T>(name: string): T | undefined;
  /** Text size for scale numbers and labels in local units, when the caller decided one. */
  text?: number;
  /** The style's ink or page color, whichever reads better on a surface of this color (marks on a white dial). */
  inkOn(bg: string): string;
};

export type KindBuild = {
  box: { w: number; h: number };
  /** The point the thing turns and scales about, local units (a ball turns about its middle, a lever about its pivot). */
  pivot: Pt;
  /** Nodes under `${id}.body`; ids are full ids. Props that depend on state come from `draw`. */
  nodes: NodeSpec[];
  parts: Record<string, Part>;
  states: Record<string, StateDef>;
  verbs: Record<string, VerbDef>;
  draw(s: StateMap): Record<string, Props>;
  anchors?: Record<string, (s: StateMap) => Pt>;
  /** Values a verb can name as "@name", worked out from the state (an angle at which a vessel pours, say). */
  computed?: Record<string, (s: StateMap) => StateValue>;
  read?(s: StateMap): string | undefined;
  levelAt?(value: number): number | undefined;
  minorLevel?: number;
  /** Continuous processes the diff cannot show (drops falling, a clock running): changes over the timing. */
  animate?(from: StateMap, to: StateMap, t: Timing): Change[];
  capacity?: { unit: string; at(level: number): number; levelOf(amount: number): number };
  notes?: string[];
};

export type KindDef = {
  name: string;
  about: string;
  forms?: Record<string, string>;
  params: Record<string, string>;
  colors: Record<string, string>;
  /** Parameters a spec must give for this kind (or for a form: "form:param"). */
  required?: string[];
  build(ctx: BuildCtx): KindBuild;
};

// The pose: states every depiction has, drawn on `${id}.pose`.
export const POSE_STATES: Record<string, StateDef> = {
  x: { type: "number", about: "sideways offset from where it was placed, local units", initial: 0 },
  y: { type: "number", about: "up or down offset (down is positive), local units", initial: 0 },
  angle: { type: "angle", about: "turn about its pivot, degrees clockwise", initial: 0 },
  scale: { type: "number", about: "size multiplier, about its base", min: 0, initial: 1 },
  squash: { type: "number", about: "height multiplier keeping its base (a landing, a press)", min: 0, initial: 1 },
  opacity: { type: "number", about: "how visible, 0 gone to 1", min: 0, max: 1, initial: 1 },
  lit: { type: "number", about: "light around it, 0 none to 1 full", min: 0, max: 1, initial: 0 },
};

// Verbs every thing understands. A kind's own verb of the same name wins (a gauge "falls" in value, a body in space).
export const POSE_VERBS: Record<string, VerbDef> = {
  "moves to": { about: "goes to a point", sets: [{ state: "x", arg: true }], arg: "point", target: true },
  moves: { about: "shifts by a distance sideways", sets: [{ state: "x", arg: true, by: 1 }], arg: "number" },
  slides: { about: "shifts by a distance sideways", sets: [{ state: "x", arg: true, by: 1 }], arg: "number" },
  falls: { about: "drops by a distance under gravity", sets: [{ state: "y", arg: true, by: 1 }], arg: "number", ease: "in" },
  drops: { about: "drops by a distance under gravity", sets: [{ state: "y", arg: true, by: 1 }], arg: "number", ease: "in" },
  rises: { about: "goes up by a distance", sets: [{ state: "y", arg: true, by: -1 }], arg: "number" },
  lifts: { about: "goes up by a distance", sets: [{ state: "y", arg: true, by: -1 }], arg: "number" },
  sinks: { about: "goes down by a distance", sets: [{ state: "y", arg: true, by: 1 }], arg: "number" },
  turns: { about: "turns by an angle", sets: [{ state: "angle", arg: true, by: 1 }], arg: "angle" },
  rotates: { about: "turns by an angle", sets: [{ state: "angle", arg: true, by: 1 }], arg: "angle" },
  spins: { about: "turns whole turns (the argument counts them)", sets: [{ state: "angle", arg: true, by: 360 }], arg: "number" },
  tilts: { about: "leans to an angle", sets: [{ state: "angle", arg: true }], arg: "angle" },
  tips: { about: "leans to an angle", sets: [{ state: "angle", arg: true }], arg: "angle" },
  grows: { about: "gets bigger by a factor", sets: [{ state: "scale", arg: true }], arg: "number" },
  shrinks: { about: "gets smaller to a factor", sets: [{ state: "scale", arg: true }], arg: "number" },
  appears: { about: "comes into view", sets: [{ state: "opacity", value: 1 }] },
  vanishes: { about: "goes out of view", sets: [{ state: "opacity", value: 0 }] },
  disappears: { about: "goes out of view", sets: [{ state: "opacity", value: 0 }] },
  fades: { about: "fades to an opacity (out when none is given)", sets: [{ state: "opacity", arg: true, value: 0 }], arg: "number" },
  lights: { about: "lights up", sets: [{ state: "lit", value: 1 }] },
  glows: { about: "lights up", sets: [{ state: "lit", value: 1 }] },
  dims: { about: "its light goes out", sets: [{ state: "lit", value: 0 }] },
  flashes: { about: "lights up and goes back", sets: [{ state: "lit", value: 1 }], motion: "pulse" },
  shakes: { about: "rocks side to side and settles (the argument is the angle)", sets: [{ state: "angle", arg: true, by: 1 }], arg: "angle", motion: "shake" },
  wobbles: { about: "rocks side to side and settles", sets: [{ state: "angle", arg: true, by: 1 }], arg: "angle", motion: "shake" },
  bounces: { about: "squashes on landing and springs back", sets: [{ state: "squash", arg: true }], arg: "number", motion: "shake" },
  squashes: { about: "squashes and springs back", sets: [{ state: "squash", arg: true }], arg: "number", motion: "pulse" },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const num = (v: StateValue | undefined, d = 0) => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : d);

/** Normalize an author's verb so "drip into", "drips into" and "Drips" find the same verb; particles are tried both ways. */
export function findVerb(verbs: Record<string, VerbDef>, verb: string): string | undefined {
  const raw = verb.toLowerCase().trim().replace(/\s+/g, " ");
  const v = raw.replace(/^(is|are|gets|starts to|begins to) /, "");
  const tries = new Set<string>([raw, v]);
  const words = v.split(" ");
  const forms = (w: string) => [w, `${w}s`, `${w}es`, w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, ""), w.replace(/y$/, "ies")];
  for (const f of forms(words[0]!)) tries.add([f, ...words.slice(1)].join(" "));
  if (words.length > 1) for (const f of forms(words[0]!)) tries.add(f);
  for (const t of tries) if (verbs[t]) return t;
  return undefined;
}

export function makeDepiction(def: KindDef, spec: PropSpec, theme: Theme, look: DepictLook, opts: { id: string; text?: number }): Depiction {
  const id = opts.id;
  const ctx: BuildCtx = {
    id,
    spec,
    theme,
    look,
    L: look.line.value,
    text: opts.text,
    col: (name) => spec.colors?.[name],
    param: <T,>(name: string) => spec.params?.[name] as T | undefined,
    inkOn: (bg) => {
      const hex = (c: string) => theme.colors[c] ?? c;
      const contrast = (a: string, b: string) => {
        const [x, y] = [luminance(hex(a)), luminance(hex(b))];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      return contrast("ink", bg) >= contrast("paper", bg) ? "ink" : "paper";
    },
  };
  const k = def.build(ctx);
  const states: Record<string, StateDef> = { ...POSE_STATES, ...k.states };
  const verbs: Record<string, VerbDef> = { ...POSE_VERBS, ...k.verbs };
  // The spec's own verbs: the plan's words mapped onto the kind's verbs or onto state changes.
  for (const [name, sv] of Object.entries(spec.verbs ?? {})) {
    // A verb the kind has by that very name is what this thing does under it (a burette with a tap drips from it); a
    // mapping only adds names the kind does not have.
    if (k.verbs[name.toLowerCase()]) continue;
    if (sv.like) {
      const base = findVerb(verbs, sv.like);
      if (!base) throw new Error(`${id}: verb "${name}" is like "${sv.like}", which ${def.name} does not have`);
      verbs[name.toLowerCase()] = { ...verbs[base]!, about: sv.about ?? `${name}: as ${base}`, ...(sv.motion ? { motion: sv.motion } : {}), ...(sv.arg !== undefined ? { sets: verbs[base]!.sets.map((s) => (s.arg ? { ...s, value: sv.arg, arg: false } : s)) } : {}) };
    } else if (sv.sets) verbs[name.toLowerCase()] = { about: sv.about ?? name, sets: sv.sets, motion: sv.motion };
  }
  const resolveArg = (d: StateDef, arg: StateValue): StateValue => {
    if (d.type === "color" && typeof arg === "string") {
      const named = spec.colors?.[arg] ?? spec.colors?.[arg.toLowerCase()];
      if (named) return named;
      if (isHex(arg) || theme.colors[arg]) return arg;
      throw new Error(`${id}: "${arg}" is not one of its colors (${Object.keys(spec.colors ?? {}).join(", ") || "none named"}); the depicter names the colors a thing can take`);
    }
    if ((d.type === "number" || d.type === "angle") && typeof arg === "string") {
      const m = /(-?\d+(?:\.\d+)?)\s*(%)?/.exec(arg);
      if (!m) throw new Error(`${id}: "${arg}" is not a number`);
      return m[2] ? Number(m[1]) / 100 : Number(m[1]);
    }
    if (d.type === "bool") return arg === true || arg === "true" || arg === 1 || arg === "on" || arg === "open";
    return arg;
  };

  const state: StateMap = {};
  for (const [n, d] of Object.entries(states)) state[n] = d.initial;
  // The spec's starting state reads its words as a verb's argument does: a color by its name in colors, a number from
  // "30%". A name painted as it is would be no color at all to the renderer (and an SVG paints that black).
  for (const [n, v] of Object.entries(spec.state ?? {})) {
    if (!(n in states)) throw new Error(`${id}: ${def.name} has no state "${n}" (it has ${Object.keys(states).join(", ")})`);
    state[n] = resolveArg(states[n]!, v);
  }

  const [px, py] = k.pivot;
  const pose = (s: StateMap): Props => {
    const S = num(s.scale, 1);
    const Q = num(s.squash, 1);
    // The pose group sits on the pivot and the body hangs from it, so the base stays put as it scales or squashes.
    const p: Props = { x: num(s.x) + px * S, y: num(s.y) + py * S * Q, rotate: num(s.angle), scaleX: S, scaleY: S * Q, opacity: num(s.opacity, 1) };
    const lit = num(s.lit);
    p.glow = lit > 0 ? look.glow.value : 0;
    p.glowOpacity = lit;
    p.glowColor = ctx.col("light") ?? "accent";
    return p;
  };
  const drawAll = (s: StateMap): Record<string, Props> => ({ [`${id}.pose`]: pose(s), ...k.draw(s) });

  const first = drawAll(state);
  const nodes: NodeSpec[] = [
    { id, kind: "group", props: {} },
    { id: `${id}.pose`, kind: "group", parent: id, props: first[`${id}.pose`]! },
    { id: `${id}.body`, kind: "group", parent: `${id}.pose`, props: { x: -px, y: -py } },
    ...k.nodes.map((n) => ({ ...n, props: { ...n.props, ...(first[n.id] ?? {}) } })),
  ];
  const known = new Set(nodes.map((n) => n.id));
  for (const nid of Object.keys(first)) if (!known.has(nid)) throw new Error(`${id}: draw names ${nid}, which is not a node`);

  const dep: Depiction = {
    id,
    kind: def.name,
    form: spec.form,
    tier: 1,
    label: spec.label,
    box: k.box,
    size: spec.size ? { w: spec.size.w, h: spec.size.h, unit: spec.size.unit } : undefined,
    nodes,
    parts: k.parts,
    // The depicter's points, from 0 to 1 of the box (x from the left, y from the top) to local units.
    ...(spec.points ? { points: Object.fromEntries(Object.entries(spec.points).map(([n, [x, y]]) => [n, [(x - 0.5) * k.box.w, (y - 1) * k.box.h] as Pt])) } : {}),
    states,
    state,
    verbs,
    notes: [...(k.notes ?? [])],
    anchor(name, s = dep.state) {
      const f = k.anchors?.[name];
      if (!f) return k.parts[name]?.anchor;
      const [ax, ay] = f(s);
      // Anchors are in body units; the pose moves, turns and scales them.
      const S = num(s.scale, 1);
      const Q = num(s.squash, 1);
      const [bx, by] = [(ax - px) * S, (ay - py) * S * Q];
      const a = (num(s.angle) * Math.PI) / 180;
      return [num(s.x) + px * S + bx * Math.cos(a) - by * Math.sin(a), num(s.y) + py * S * Q + bx * Math.sin(a) + by * Math.cos(a)];
    },
    apply(next, timing) {
      for (const n of Object.keys(next)) if (!(n in states)) throw new Error(`${id}: ${def.name} has no state "${n}"`);
      const to: StateMap = { ...dep.state, ...next };
      const ease: Ease = timing.ease ?? "smooth";
      const frames = Math.max(1, Math.round(timing.frames));
      const a = drawAll(dep.state);
      const b = drawAll(to);
      const out: Change[] = [];
      for (const [nid, props] of Object.entries(b)) {
        for (const [prop, value] of Object.entries(props)) {
          if (!same(a[nid]?.[prop], value)) out.push({ id: nid, prop, value: value as Value, at: 0, frames, ease });
        }
      }
      if (k.animate) out.push(...k.animate(dep.state, to, { ...timing, frames }));
      dep.state = to;
      return out;
    },
    act(verb, arg, timing = { frames: 30 }) {
      const key = findVerb(verbs, verb);
      if (!key) return { known: false, verb, notes: [`${spec.label} (${def.name}) has no verb "${verb}"; it can: ${Object.keys(verbs).join(", ")}`] };
      const v = verbs[key]!;
      for (const need of v.needs ?? []) if (!k.parts[need]) return { known: false, verb, notes: [`${spec.label} cannot ${key}: it has no ${need}`] };
      const before = { ...dep.state };
      const next: StateMap = {};
      for (const s0 of v.sets) {
        // A state named with {arg} takes the argument as part of its name: "mark.{arg}" with "label" marks the label.
        const s = s0.state.includes("{arg}") ? { ...s0, state: s0.state.replace("{arg}", String(arg ?? "")), arg: false } : s0;
        const d = states[s.state];
        if (!d) return { known: false, verb, notes: [`${key} sets "${s.state}", which ${spec.label} does not have`] };
        let value: StateValue | undefined = s.arg && arg !== undefined ? resolveArg(d, arg) : typeof s.value === "string" && !s.value.startsWith("@") ? resolveArg(d, s.value) : s.value;
        if (typeof value === "string" && value.startsWith("@")) {
          const f = k.computed?.[value.slice(1)];
          if (!f) return { known: false, verb, notes: [`${key} needs "${value}", which ${spec.label} cannot work out`] };
          value = f(dep.state);
        }
        if (s.by !== undefined) value = num(dep.state[s.state]) + s.by * (value === undefined ? 1 : num(value, 1));
        if (value === undefined) return { known: false, verb, notes: [`${spec.label} ${key}: it needs ${v.arg ? `a ${v.arg}` : "a value"}`] };
        if (Array.isArray(value) && s.state === "x") {
          next.x = value[0];
          next.y = value[1];
          continue;
        }
        if (typeof value === "number" && (d.min !== undefined || d.max !== undefined)) value = Math.max(d.min ?? -Infinity, Math.min(d.max ?? Infinity, value));
        next[s.state] = value;
      }
      const t: Timing = { ...timing, ease: v.ease ?? timing.ease };
      const F = Math.max(1, Math.round(t.frames));
      const motion = v.motion ?? "to";
      const changes: Change[] = [];
      const back: StateMap = Object.fromEntries(Object.keys(next).map((n) => [n, before[n]!]));
      const seq = (steps: { s: StateMap; f: number; ease?: Ease }[]) => {
        let at = 0;
        for (const st of steps) {
          changes.push(...dep.apply(st.s, { ...t, frames: st.f, ease: st.ease ?? t.ease }).map((c) => ({ ...c, at: c.at + at })));
          at += st.f;
        }
      };
      if (motion === "to") changes.push(...dep.apply(next, t));
      else if (motion === "pulse") seq([{ s: next, f: Math.ceil(F / 2), ease: "out" }, { s: back, f: Math.floor(F / 2) || 1, ease: "in" }]);
      else if (motion === "shake" || motion === "cycle") {
        // A damped swing: each half swing loses the same share of its size, as a struck spring does, and it ends at rest.
        const swings = motion === "cycle" ? 2 : 4;
        const steps: { s: StateMap; f: number }[] = [];
        for (let i = 0; i < swings; i++) {
          const k2 = (i % 2 ? -1 : 1) * Math.pow(0.55, i);
          steps.push({ s: Object.fromEntries(Object.entries(next).map(([n, val]) => [n, typeof val === "number" ? num(before[n]) + (val - num(before[n])) * k2 : val])), f: Math.max(1, Math.round(F / (swings + 1))) });
        }
        steps.push({ s: back, f: Math.max(1, F - steps.reduce((a, b) => a + b.f, 0)) });
        seq(steps);
      }
      const notes = [`${spec.label} ${key}${arg !== undefined ? ` ${typeof arg === "object" ? JSON.stringify(arg) : arg}` : ""}: ${v.about}`];
      return { known: true, verb: key, state: { ...dep.state }, changes, notes } satisfies ActResult;
    },
  };
  if (k.read) dep.read = (s = dep.state) => k.read!(s);
  if (k.levelAt) dep.levelAt = k.levelAt;
  if (k.minorLevel !== undefined) dep.minorLevel = k.minorLevel;
  if (k.capacity) dep.capacity = k.capacity;
  return dep;
}
