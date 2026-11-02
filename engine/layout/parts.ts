// What text and math have in common: a thing made of small parts, shown in one or more states. A part that exists in
// two states is the same part: it travels from where it was to where it is now, as on the teaching stage. New parts
// appear and finished ones fade. Each part is a plain primitive, so nothing here is ever visible as a container.
import { EASES } from "../core/ease.ts";
import type { CompileContext, Ease, Key, Kit, NodeSpec, Props, Track, Value } from "../core/types.ts";

export type Box = { left: number; top: number; right: number; bottom: number };

export type Atom = {
  key: string; // what it is, such as a letter or a math symbol; only parts with the same key can be the same part
  chunk?: string; // a run of atoms that belong together, such as a word; equal chunks are matched whole first
  x: number; // center, in the coordinates of the whole thing
  y: number;
  w: number;
  h: number;
  kind: "text" | "path";
  props: Props; // text or points, size, font, and so on
  home?: string[]; // real groups it sits in, outermost first
  of?: string[]; // further named sets it belongs to; a part can be in a row and a column at once
};
export type PartState = { atoms: Atom[] };

type Actor = { id: string; parent: string; ox: number; oy: number; kind: Atom["kind"]; first: Atom; bornIn: number };
type Placed = { actor: Actor; atom: Atom; crossed: boolean };
export type Cast = { root: string; actors: Actor[]; scenes: Placed[][]; groups: { id: string; parent: string; x: number; y: number; name: string }[]; box: Box };

const box = (a: Atom[]): Box => ({
  left: Math.min(...a.map((p) => p.x - p.w / 2)),
  right: Math.max(...a.map((p) => p.x + p.w / 2)),
  top: Math.min(...a.map((p) => p.y - p.h / 2)),
  bottom: Math.max(...a.map((p) => p.y + p.h / 2)),
});
export const boxOf = (atoms: Atom[]): Box => (atoms.length ? box(atoms) : { left: 0, top: 0, right: 0, bottom: 0 });

// Longest run of equal keys kept in order. These parts can simply glide; the others have to cross something.
function lcs(a: string[], b: string[]): [number, number][] {
  const t = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out: [number, number][] = [];
  for (let [i, j] = [0, 0]; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) out.push([i++, j++]);
    else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

export type Match = { from: number; to: number; crossed: boolean };

// Pairs parts of one state with parts of the next. Whole chunks first, then single parts in order, then any part still
// looking for its twin takes the nearest one in reading order.
export function matchAtoms(a: Pick<Atom, "key" | "chunk">[], b: Pick<Atom, "key" | "chunk">[]): Match[] {
  const out: Match[] = [];
  const [usedA, usedB] = [new Set<number>(), new Set<number>()];
  const pair = (from: number, to: number, crossed: boolean) => {
    out.push({ from, to, crossed });
    usedA.add(from);
    usedB.add(to);
  };
  const runs = (list: typeof a) => {
    const r: { name: string; at: number[] }[] = [];
    list.forEach((p, i) => {
      if (!p.chunk) return;
      const last = r.at(-1);
      if (last && last.name === p.chunk && last.at.at(-1) === i - 1) last.at.push(i);
      else r.push({ name: p.chunk, at: [i] });
    });
    return r;
  };
  const [ra, rb] = [runs(a), runs(b)];
  const taken = new Set<number>();
  const takenB = new Set<number>();
  const whole = (i: number, j: number, crossed: boolean) => {
    taken.add(i);
    takenB.add(j);
    const [x, y] = [ra[i]!.at, rb[j]!.at];
    if (x.length === y.length) x.forEach((p, n) => pair(p, y[n]!, crossed));
  };
  for (const [i, j] of lcs(ra.map((r) => r.name), rb.map((r) => r.name))) whole(i, j, false);
  rb.forEach((r, j) => {
    if (takenB.has(j)) return;
    const i = ra.findIndex((q, n) => !taken.has(n) && q.name === r.name);
    if (i >= 0) whole(i, j, true);
  });
  const leftA = a.flatMap((_, i) => (usedA.has(i) ? [] : [i]));
  const leftB = b.flatMap((_, i) => (usedB.has(i) ? [] : [i]));
  for (const [i, j] of lcs(leftA.map((i) => a[i]!.key), leftB.map((j) => b[j]!.key))) pair(leftA[i]!, leftB[j]!, false);
  for (const j of b.keys()) {
    if (usedB.has(j)) continue;
    let best = -1;
    for (const i of a.keys()) if (!usedA.has(i) && a[i]!.key === b[j]!.key && (best < 0 || Math.abs(i - j) < Math.abs(best - j))) best = i;
    if (best >= 0) pair(best, j, true);
  }
  return out;
}

// Lays out the cast: who exists, who sits where, and which part is which in each state.
export function buildCast(root: string, states: PartState[], name: (atom: Atom, index: number) => string): Cast {
  if (!states.length) throw new Error(`${root} has no states`);
  const groups: Cast["groups"] = [];
  const homes = new Map<string, { atoms: Atom[]; parent?: string }>();
  for (const atom of states[0]!.atoms) {
    (atom.home ?? []).forEach((g, i, all) => {
      const known = homes.get(g) ?? homes.set(g, { atoms: [], parent: all[i - 1] }).get(g)!;
      known.atoms.push(atom);
    });
  }
  const origin = new Map<string, [number, number]>();
  for (const [g, { atoms }] of homes) {
    const b = box(atoms);
    origin.set(g, [(b.left + b.right) / 2, (b.top + b.bottom) / 2]);
  }
  for (const [g, { parent }] of homes) {
    const [x, y] = origin.get(g)!;
    const [px, py] = parent ? origin.get(parent)! : [0, 0];
    groups.push({ id: `${root}.${g}`, parent: parent ? `${root}.${parent}` : root, x: x - px, y: y - py, name: g });
  }
  const actors: Actor[] = [];
  const cast = (atom: Atom, bornIn: number, parent?: string): Actor => {
    const [ox, oy] = parent ? origin.get(parent)! : [0, 0];
    const actor = { id: `${root}.${name(atom, actors.length)}`, parent: parent ? `${root}.${parent}` : root, ox, oy, kind: atom.kind, first: atom, bornIn };
    actors.push(actor);
    return actor;
  };
  const scenes: Placed[][] = [states[0]!.atoms.map((atom) => ({ actor: cast(atom, 0, atom.home?.at(-1)), atom, crossed: false }))];
  // The last place each part was seen, including parts that have left, so a part that comes back is the same part.
  const pool = new Map<string, Atom>(scenes[0]!.map((p) => [p.actor.id, p.atom]));
  const byId = new Map(actors.map((a) => [a.id, a]));
  for (let s = 1; s < states.length; s++) {
    const now = states[s]!.atoms;
    const before = scenes[s - 1]!;
    const matches = matchAtoms(before.map((p) => p.atom), now);
    const scene: (Placed | undefined)[] = now.map(() => undefined);
    const used = new Set<string>();
    for (const m of matches) {
      scene[m.to] = { actor: before[m.from]!.actor, atom: now[m.to]!, crossed: m.crossed };
      used.add(before[m.from]!.actor.id);
    }
    now.forEach((atom, i) => {
      if (scene[i]) return;
      const back = [...pool].find(([id, a]) => !used.has(id) && a.key === atom.key);
      if (back) used.add(back[0]);
      const actor = back ? byId.get(back[0])! : cast(atom, s);
      byId.set(actor.id, actor);
      used.add(actor.id);
      scene[i] = { actor, atom, crossed: false };
    });
    scenes.push(scene as Placed[]);
    for (const p of scene as Placed[]) pool.set(p.actor.id, p.atom);
  }
  const all = states.flatMap((s) => s.atoms);
  return { root, actors, scenes, groups, box: boxOf(all) };
}

const round = (p: number[]) => p.map((v) => Math.round(v * 100) / 100);

// The cast as primitives, showing the first state. Parts of later states exist from the start, unseen.
export function castNodes(c: Cast, n: NodeSpec): NodeSpec[] {
  const out: NodeSpec[] = [{ id: n.id, kind: "group", parent: n.parent, props: n.props, data: { box: [c.box.left, c.box.top, c.box.right, c.box.bottom] } }];
  for (const g of c.groups) out.push({ id: g.id, kind: "group", parent: g.parent, props: { x: g.x, y: g.y } });
  const visible = new Set(c.scenes[0]!.map((p) => p.actor.id));
  for (const a of c.actors) {
    const props: Props = { ...a.first.props, x: a.first.x - a.ox, y: a.first.y - a.oy };
    if (!visible.has(a.id)) props.opacity = 0;
    if (Array.isArray(props.points)) props.points = round(props.points as number[]);
    out.push({ id: a.id, kind: a.kind, parent: a.parent, props });
  }
  return out;
}

const num = (v: Value | undefined, d: number) => (typeof v === "number" ? v : d);
type Live = Map<string, Props>; // what each part looks like right now, so the next change starts from there

export type Entry = {
  become: (a: { start: number; args: Record<string, Value>; ctx: CompileContext }) => Track[];
  members: (part: string) => { id: string; x: number; y: number; kind: Atom["kind"]; live: Props }[];
};
const registers = new WeakMap<CompileContext, Map<string, Entry>>();
export function register(ctx: CompileContext, id: string, entry: Entry) {
  (registers.get(ctx) ?? registers.set(ctx, new Map()).get(ctx)!).set(id, entry);
}
export function entryFor(ctx: CompileContext, id: string): Entry {
  const e = registers.get(ctx)?.get(id);
  if (!e) throw new Error(`${id} has no parts or states`);
  return e;
}

// Named sets in a scene. Every set a part belongs to in that state, plus its reading position and what it is.
const named = (p: Placed, i: number, base: string) => ["all", ...(p.atom.home ?? []), ...(p.atom.of ?? []), `char.${p.atom.key}`, `${base}.${i}`];

export function castEntry(c: Cast, base = "part"): Entry {
  const live: Live = new Map();
  for (const p of c.scenes[0]!) live.set(p.actor.id, { ...p.atom.props, x: p.atom.x - p.actor.ox, y: p.atom.y - p.actor.oy, opacity: 1 });
  for (const a of c.actors) if (!live.has(a.id)) live.set(a.id, { ...a.first.props, x: a.first.x - a.ox, y: a.first.y - a.oy, opacity: 0 });
  let current = 0;
  const groupsHome = c.groups.flatMap((g) => [
    { target: g.id, prop: "x", value: g.x },
    { target: g.id, prop: "y", value: g.y },
  ]);
  return {
    members: (part) => {
      const hit = c.scenes[current]!.flatMap((p, i) => (named(p, i, base).includes(part) ? [p] : []));
      if (!hit.length) throw new Error(`${c.root} has no part called ${part}`);
      return hit.map((p) => {
        const l = live.get(p.actor.id)!;
        return { id: p.actor.id, x: l.x as number, y: l.y as number, kind: p.actor.kind, live: l };
      });
    },
    become: ({ start, args, ctx }) => {
      const state = args.state;
      if (typeof state !== "number" || !c.scenes[state]) throw new Error(`${c.root} has no state ${String(state)}`);
      const frames = num(args.frames, ctx.theme.moveFrames * 2);
      const stagger = num(args.stagger, 0);
      const ease = (typeof args.ease === "string" ? args.ease : ctx.theme.ease) as Ease;
      const hop = num(args.hop, 1);
      const next = c.scenes[state]!;
      const prior = new Set(c.scenes[current]!.map((p) => p.actor.id));
      const staying = new Set(next.map((p) => p.actor.id));
      const tracks: Track[] = [];
      const move = (target: string, prop: string, from: Value, to: Value, at: number, len: number) => tracks.push({ target, prop, keys: [{ at, value: from }, { at: at + len, value: to, ease }] });
      for (const g of groupsHome) tracks.push({ target: g.target, prop: g.prop, keys: [{ at: start, value: g.value }] });
      next.forEach((p, i) => {
        const id = p.actor.id;
        const was = live.get(id)!;
        const [x, y] = [p.atom.x - p.actor.ox, p.atom.y - p.actor.oy];
        const at = start + i * stagger;
        if (!prior.has(id)) {
          // Arrives in place, except that its shape and position are set the moment before it shows.
          tracks.push({ target: id, prop: "x", keys: [{ at, value: x }] }, { target: id, prop: "y", keys: [{ at, value: y }] });
          if (Array.isArray(p.atom.props.points)) tracks.push({ target: id, prop: "points", keys: [{ at, value: round(p.atom.props.points as number[]) }] });
          tracks.push({ target: id, prop: "opacity", keys: [{ at: at + frames / 2, value: 0 }, { at: at + frames, value: 1, ease: "smooth" }] });
          live.set(id, { ...was, x, y, opacity: 1, ...(Array.isArray(p.atom.props.points) ? { points: p.atom.props.points } : {}) });
          return;
        }
        const [wx, wy] = [was.x as number, was.y as number];
        const far = Math.hypot(x - wx, y - wy);
        if (p.crossed && hop && far > 1) {
          // Parts that change order arc around the others. The arc leans to one side of the direction of travel, so
          // parts going the same way lift together and parts trading places pass on opposite sides.
          const lift = Math.max(p.atom.h, 30) * 1.15 * hop;
          const [nx, ny] = [(y - wy) / far, -(x - wx) / far];
          const arc = (from: number, to: number, side: number): Key[] =>
            Array.from({ length: 13 }, (_, n) => {
              const t = EASES.smooth(n / 12);
              return { at: at + (n / 12) * frames, value: from + (to - from) * t + side * lift * Math.sin(Math.PI * t), ease: "linear" as const };
            });
          tracks.push({ target: id, prop: "x", keys: arc(wx, x, nx) }, { target: id, prop: "y", keys: arc(wy, y, ny) });
        } else {
          if (wx !== x) move(id, "x", wx, x, at, frames);
          if (wy !== y) move(id, "y", wy, y, at, frames);
        }
        const points = p.atom.props.points;
        if (Array.isArray(points) && JSON.stringify(points) !== JSON.stringify(was.points)) {
          move(id, "points", round(was.points as number[]), round(points as number[]), at, frames);
          was.points = points;
        }
        for (const prop of ["size"] as const) if (p.atom.props[prop] !== undefined && p.atom.props[prop] !== was[prop]) move(id, prop, was[prop]!, p.atom.props[prop]!, at, frames);
        live.set(id, { ...was, x, y, ...(p.atom.props.size !== undefined ? { size: p.atom.props.size } : {}) });
      });
      for (const id of prior) {
        if (staying.has(id)) continue;
        tracks.push({ target: id, prop: "opacity", keys: [{ at: start, value: 1 }, { at: start + frames / 2, value: 0, ease: "smooth" }] });
        live.get(id)!.opacity = 0;
      }
      current = state;
      return tracks;
    },
  };
}

// Abilities every thing with parts shares. `part` names a set: word.2, line.0, frac.0.num, matrix.0.col.1, char.x.
export const partBehaviors: NonNullable<Kit["behaviors"]> = {
  // Move to another state: matching parts travel, the rest appear or fade.
  become: ({ target, start, args, ctx }) => entryFor(ctx, target).become({ start, args, ctx }),
  // Recolor, nudge or fade every part of a set at once. Rows and columns both work, though no part can sit in two groups.
  each: ({ target, start, args, ctx }) => {
    const parts = entryFor(ctx, target).members(String(args.part));
    const frames = num(args.frames, ctx.theme.moveFrames);
    const stagger = num(args.stagger, 0);
    return parts.flatMap((p, i): Track[] => {
      const at = start + i * stagger;
      const key = (prop: string, from: Value, to: Value): Track => ({ target: p.id, prop, keys: [{ at, value: from }, { at: at + frames, value: to, ease: "smooth" }] });
      const out: Track[] = [];
      const change = (prop: string, to: Value) => {
        const from = p.live[prop] ?? to;
        out.push(key(prop, typeof from === "string" ? (ctx.theme.colors[from] ?? from) : from, to));
        p.live[prop] = to;
      };
      if (args.color !== undefined) change(p.kind === "text" ? "color" : "fill", args.color);
      if (args.opacity !== undefined) change("opacity", args.opacity);
      if (args.dx !== undefined) change("x", p.x + num(args.dx, 0));
      if (args.dy !== undefined) change("y", p.y + num(args.dy, 0));
      return out;
    });
  },
  // A set of parts swells and settles around its shared middle, as if it were one thing.
  swell: ({ target, start, args, ctx }) => {
    const parts = entryFor(ctx, target).members(String(args.part));
    const size = num(args.size, 1.2);
    const frames = num(args.frames, ctx.theme.moveFrames);
    const [cx, cy] = [parts.reduce((a, p) => a + p.x, 0) / parts.length, parts.reduce((a, p) => a + p.y, 0) / parts.length];
    return parts.flatMap((p): Track[] => {
      const wave = (prop: string, base: number, center: number, scale: number): Track => ({ target: p.id, prop, keys: [{ at: start, value: base }, { at: start + frames / 2, value: center + (base - center) * scale, ease: "out" }, { at: start + frames, value: base, ease: "smooth" }] });
      return [wave("x", p.x, cx, size), wave("y", p.y, cy, size), wave("scaleX", 1, 0, size), wave("scaleY", 1, 0, size)];
    });
  },
  // Parts arrive one after another. `rise` lifts them into place; the default just fades them in.
  reveal: ({ target, start, args, ctx }) => {
    const parts = entryFor(ctx, target).members(String(args.part ?? "all"));
    const frames = num(args.frames, ctx.theme.moveFrames);
    const stagger = num(args.stagger, 2);
    const rise = num(args.rise, 0);
    return parts.flatMap((p, i): Track[] => {
      const at = start + i * stagger;
      const out: Track[] = [{ target: p.id, prop: "opacity", keys: [{ at, value: 0 }, { at: at + frames, value: 1, ease: "smooth" }] }];
      if (rise) out.push({ target: p.id, prop: "y", keys: [{ at, value: p.y + rise }, { at: at + frames, value: p.y, ease: "out" }] });
      return out;
    });
  },
};

// Ids in a named set of the first state, for writing `set` by hand.
export function idsOf(ctx: CompileContext, root: string, part: string): string[] {
  return entryFor(ctx, root).members(part).map((m) => m.id);
}
