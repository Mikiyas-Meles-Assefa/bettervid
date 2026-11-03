// The motion vocabulary the agents choose from, per moment and per thing: how a thing goes from its state in one moment
// to its state in the next (keeping its identity, or not), how it arrives, how it leaves, and accents played on it while
// it is there. Each move is carried out with the engine's own behaviors (engine/motion/moves.ts: spring, arc, hop,
// follow, orbit, fall, squash, jiggle, wiggle, morph) or with plain timed changes. Nothing here chooses: the composer
// carries out what the director or the designer picked (MomentDesign.moves), and a thing no move names stays as it is.
// Numbers in `args` are the behaviors' own settings; an agent may set any of them.
import type { Ease, Value } from "../../core/types.ts";
import type { MoveChoice, MoveUse } from "../types.ts";
import type { Triple } from "./types.ts";

export type { MoveChoice, MoveUse };
import type { Writer } from "./writer.ts";


export type MoveDef = {
  name: string;
  uses: MoveUse[];
  /** What it does, in plain words, for the agents. */
  does: string;
  /** Its settings and what each means (with the behavior's own value when none is given). */
  args: Record<string, string>;
  /** Only for things drawn as one outline (a bar, a floor, an arrow, a column): the move reshapes points. */
  outline?: boolean;
};

export const MOVE_VOCABULARY: MoveDef[] = [
  { name: "stay", uses: ["change"], does: "keeps its place and size from the moment before; only its emphasis (dim, color) follows its role now. A thing no move names stays.", args: {} },
  { name: "travel", uses: ["change", "enter", "exit"], does: "keeps its identity and glides to its new place and size by the shortest way, easing in and out; arriving, it slides in from an edge; leaving, it slides out to one", args: { from: "enter: the edge it comes from (left, right, top, bottom)", to: "exit: the edge it leaves by", seconds: "how long (default: by distance, the style's motion.move)", ease: "smooth, out, in, linear, overshoot, anticipate" } },
  { name: "cut", uses: ["change", "enter", "exit"], does: "is in its new state at once, on the moment's first frame: no motion between", args: {} },
  { name: "fade", uses: ["change", "enter", "exit"], does: "fades out where it was and fades in where it goes (arriving: fades in from slightly smaller; leaving: fades out)", args: { seconds: "the whole change" } },
  { name: "morph", uses: ["change"], outline: true, does: "its outline reshapes into the new one, matching like with like (for things drawn as one line: a bar, a floor, an arrow, a column)", args: { seconds: "how long" } },
  { name: "spring", uses: ["change", "enter"], does: "goes to its new place and size on a real spring: overshoots a little and settles, keeping the speed it has; arriving, it grows from small on the spring", args: { stiffness: "spring stiffness (170)", damping: "damping (18): lower bounces more", mass: "mass (1)", from: "enter: the size it grows from, as a share of its own (0.2)" } },
  { name: "drop", uses: ["enter"], does: "drops in from above under gravity and lands in its place with a squash and a small bounce", args: { height: "how far above it starts, share of the frame's height (0.25)", bounce: "how much of its speed a bounce keeps (0.3)", squash: "how flat it squashes on landing (0.2)", gravity: "pixels per second squared (2400)" } },
  { name: "arc", uses: ["change", "enter"], does: "goes to its new place along a true circular arc; arriving, it swings in from an edge along one", args: { bend: "how far the arc bows, share of the distance; the sign picks the side (0.3)", from: "enter: the edge it comes from", seconds: "how long" } },
  { name: "hop", uses: ["change", "accent"], does: "jumps with weight: crouches, stretches in flight, squashes on landing, settles; to its new place, or (as an accent) in place", args: { height: "jump height, share of the frame's shorter side (0.08)", seconds: "the whole jump (1.3)", squash: "how far it crouches and squashes (0.3)", stretch: "how far it stretches in flight (0.22)" } },
  { name: "follow", uses: ["change"], does: "travels to its new place along a smooth line through the points given", args: { via: "points it passes through on the way, [[x, y], ...] as fractions of the frame", seconds: "how long" } },
  { name: "orbit", uses: ["accent"], does: "circles another thing (or a point beside its place) while the moment holds, then is back where it was", args: { around: "the plan name it circles (else a point `radius` above its place)", radius: "share of the frame's shorter side", turns: "how many times round (1)", seconds: "how long (the moment)" } },
  { name: "squash", uses: ["accent"], does: "an impact or a beat: flattens, rebounds past normal and settles, its volume kept", args: { amount: "how flat (0.3)", axis: "y flattens its height, x its width", seconds: "how long" } },
  { name: "jiggle", uses: ["accent"], does: "follow-through: a dying wobble on top of whatever it is doing", args: { prop: "what wobbles: rotate (degrees), x, y, scaleX, scaleY (rotate)", size: "how far (10)", cycles: "wobbles (3)", seconds: "how long" } },
  { name: "wiggle", uses: ["accent"], does: "restless motion from smooth noise, on top, for as long as the moment holds", args: { prop: "what wiggles: x, y, rotate (y)", size: "how far, in pixels or degrees (8)", speed: "wobbles a second (2)", seconds: "how long (the moment)" } },
];

export const MOVE_NAMES = MOVE_VOCABULARY.map((m) => m.name);
export const moveDef = (name: string) => MOVE_VOCABULARY.find((m) => m.name === name);


/** The vocabulary as the agents read it, with the style's leanings marked (a leaning is a suggestion, never a limit). */
export function movesText(leans: { move: string; why: string }[] = []): string {
  const lean = new Map(leans.map((l) => [l.move, l.why]));
  return MOVE_VOCABULARY.map((m) => {
    const a = Object.entries(m.args).map(([k, v]) => `${k}: ${v}`).join("; ");
    const l = lean.get(m.name);
    return `- ${m.name} (${m.uses.join(", ")})${l ? ` [the style leans this way: ${l}]` : ""}: ${m.does}${a ? `. Settings: ${a}` : ""}`;
  }).join("\n");
}

/** Problems with a list of move choices, for a repair round: unknown moves, uses a move does not have, unknown settings. */
export function moveChoiceProblems(list: unknown, names: Set<string>, at = "moves"): string[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return [`${at}: a list of {move, ids, args, why}`];
  const out: string[] = [];
  list.forEach((c: MoveChoice, i) => {
    const p = `${at}[${i}]`;
    const d = c && typeof c.move === "string" ? moveDef(c.move) : undefined;
    if (!d) return void out.push(`${p}: "${c?.move}" is not a move (${MOVE_NAMES.join(", ")})`);
    if (!Array.isArray(c.ids) || c.ids.some((x) => typeof x !== "string")) return void out.push(`${p}: ids is a list of plan names ([] for every thing it can apply to)`);
    for (const id of c.ids) if (!names.has(id)) out.push(`${p}: "${id}" is not a name in the plan or the material`);
    if (c.as !== undefined && !d.uses.includes(c.as)) out.push(`${p}: ${d.name} cannot be used as ${c.as} (it is used as ${d.uses.join(", ")})`);
    for (const k of Object.keys(c.args ?? {})) if (!(k in d.args)) out.push(`${p}: ${d.name} has no setting "${k}"${Object.keys(d.args).length ? ` (it has ${Object.keys(d.args).join(", ")})` : ""}`);
    if (!c.why?.trim()) out.push(`${p}: why is needed`);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Carrying a move out. `targets` are a thing's end state as property changes; the thing's own node is `id` (its group).

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const ROOT = new Set(["x", "y", "scaleX", "scaleY"]);

export type CarryCtx = { fps: number; width: number; height: number; /** The frames a plain change takes here (by distance). */ frames: number; ease?: Ease };

/** Every target that is not the thing's own place and size, changed over `frames` (dim, color, a line's text ...). */
function rest(w: Writer, id: string, targets: Triple[], at: number, frames: number, ease: Ease) {
  for (const [n, p, v] of targets) if (!(n === id && ROOT.has(p))) w.put(n, p, v, at, frames, ease);
}
const root = (id: string, targets: Triple[]) => Object.fromEntries(targets.filter(([n, p]) => n === id && ROOT.has(p)).map(([, p, v]) => [p, v as number])) as Partial<Record<"x" | "y" | "scaleX" | "scaleY", number>>;

/**
 * A thing that stays goes to its new state by the move chosen. Returns the frames the change takes, and any note
 * (a move that cannot apply to this thing says so, and the change is not made: the thing stays).
 */
export function carryChange(w: Writer, id: string, targets: Triple[], choice: MoveChoice, at: number, c: CarryCtx): { frames: number; note?: string } {
  const a = choice.args ?? {};
  const frames = Math.max(1, Math.round(a.seconds !== undefined ? num(a.seconds, 0) * c.fps : c.frames));
  const ease = (typeof a.ease === "string" ? a.ease : c.ease ?? "smooth") as Ease;
  const r = root(id, targets);
  switch (choice.move) {
    case "stay":
      return { frames: 0 };
    case "cut":
      for (const [n, p, v] of targets) w.put(n, p, v, at, 1, "step");
      return { frames: 1 };
    case "fade": {
      const half = Math.max(1, Math.round(frames / 2));
      const op = targets.find(([n, p]) => n === id && p === "opacity")?.[2] ?? w.value(id, "opacity") ?? 1;
      w.put(id, "opacity", 0, at, half, "in");
      for (const [n, p, v] of targets) if (!(n === id && p === "opacity")) w.put(n, p, v, at + half, 1, "step");
      w.put(id, "opacity", op, at + half + 1, half, "out");
      return { frames: 2 * half + 1 };
    }
    case "morph": {
      const pts = targets.find(([n, p]) => n === id && p === "points");
      if (!pts) return { frames: 0, note: `${id}: morph reshapes a thing drawn as one outline, and this one is not: it glides there instead` };
      w.play(at, id, "morph", { to: pts[2], frames });
      w.moved(id, "points", pts[2]);
      rest(w, id, targets.filter(([n, p]) => !(n === id && p === "points")), at, frames, ease);
      for (const [p, v] of Object.entries(r)) w.put(id, p, v, at, frames, ease);
      return { frames };
    }
    case "spring": {
      const args: Record<string, Value> = { stiffness: num(a.stiffness, 170), damping: num(a.damping, 18), mass: num(a.mass, 1) };
      let any = false;
      for (const [p, v] of Object.entries(r)) if (w.would(id, p, v)) (args[p] = v, w.moved(id, p, v), (any = true));
      if (any) w.play(at, id, "spring", args);
      rest(w, id, targets, at, frames, ease);
      return { frames };
    }
    case "arc":
    case "hop":
    case "follow": {
      const x1 = r.x ?? (w.value(id, "x") as number);
      const y1 = r.y ?? (w.value(id, "y") as number);
      const short = Math.min(c.width, c.height);
      const f = choice.move === "hop" && a.seconds === undefined ? Math.round(1.3 * c.fps) : frames;
      if (w.would(id, "x", x1) || w.would(id, "y", y1)) {
        if (choice.move === "arc") w.play(at, id, "arc", { x: x1, y: y1, bend: num(a.bend, 0.3), frames: f, ease });
        else if (choice.move === "hop") w.play(at, id, "hop", { x: x1, y: y1, height: num(a.height, 0.08) * short, frames: f, squash: num(a.squash, 0.3), stretch: num(a.stretch, 0.22) });
        else {
          const via = Array.isArray(a.via) ? (a.via as unknown[]).filter((p): p is number[] => Array.isArray(p) && p.length === 2).map(([px, py]) => [px! * c.width, py! * c.height]) : [];
          w.play(at, id, "follow", { points: [w.value(id, "x") as number, w.value(id, "y") as number, ...via.flat(), x1, y1], smooth: 1, frames: f, ease });
        }
        w.moved(id, "x", x1);
        w.moved(id, "y", y1);
      }
      for (const p of ["scaleX", "scaleY"] as const) if (r[p] !== undefined) w.put(id, p, r[p]!, at, f, ease);
      rest(w, id, targets, at, f, ease);
      return { frames: f };
    }
    default:
      // travel
      for (const [n, p, v] of targets) w.put(n, p, v, at, frames, ease);
      return { frames };
  }
}

/** Where a thing stands just outside the frame on an edge, for an entrance or exit by travel or arc. */
function offEdge(edge: unknown, x: number, y: number, c: CarryCtx, size: number): [number, number] | undefined {
  if (edge === "left") return [-size, y];
  if (edge === "right") return [c.width + size, y];
  if (edge === "top") return [x, -size];
  if (edge === "bottom") return [x, c.height + size];
  return undefined;
}

/**
 * A thing arrives by the move chosen, from hidden to its targets. `size` is its extent on screen (for starting off an
 * edge). Returns the frames, or a note when the move cannot be carried (the caller then brings it in its usual way).
 */
export function carryEnter(w: Writer, id: string, targets: Triple[], choice: MoveChoice, at: number, prep: number, size: number, c: CarryCtx): { frames: number; note?: string } {
  const a = choice.args ?? {};
  const frames = Math.max(1, Math.round(a.seconds !== undefined ? num(a.seconds, 0) * c.fps : c.frames));
  const r = root(id, targets);
  const op = (targets.find(([n, p]) => n === id && p === "opacity")?.[2] as number | undefined) ?? 1;
  const x = r.x ?? 0;
  const y = r.y ?? 0;
  // Everything but the thing's own place, size and opacity is set before it shows.
  const setRest = () => {
    for (const [n, p, v] of targets) if (!(n === id && (ROOT.has(p) || p === "opacity"))) w.put(n, p, v, prep);
  };
  switch (choice.move) {
    case "cut":
      for (const [n, p, v] of targets) w.put(n, p, v, at, 1, "step");
      return { frames: 1 };
    case "drop": {
      setRest();
      const h = num(a.height, 0.25) * c.height;
      if (r.x !== undefined) w.put(id, "x", x, prep);
      for (const p of ["scaleX", "scaleY"] as const) if (r[p] !== undefined) w.put(id, p, r[p]!, prep);
      w.put(id, "y", y - h, prep);
      w.put(id, "opacity", op, at, Math.max(1, Math.round(c.fps * 0.1)), "out");
      w.play(at, id, "fall", { floor: y, bounce: num(a.bounce, 0.3), squash: num(a.squash, 0.2), gravity: num(a.gravity, 2400), minHop: 3 });
      w.moved(id, "y", y);
      return { frames: Math.round(Math.sqrt((2 * h) / num(a.gravity, 2400)) * c.fps) + Math.round(0.5 * c.fps) };
    }
    case "spring": {
      setRest();
      const s0 = num(a.from, 0.2);
      if (r.x !== undefined) w.put(id, "x", x, prep);
      if (r.y !== undefined) w.put(id, "y", y, prep);
      const args: Record<string, Value> = { stiffness: num(a.stiffness, 170), damping: num(a.damping, 18), mass: num(a.mass, 1) };
      for (const p of ["scaleX", "scaleY"] as const) {
        const v = r[p] ?? 1;
        w.put(id, p, v * s0, prep);
        args[p] = v;
        w.moved(id, p, v);
      }
      w.put(id, "opacity", op, at, Math.max(1, Math.round(c.fps * 0.15)), "out");
      w.play(at, id, "spring", args);
      return { frames };
    }
    case "travel":
    case "arc": {
      const from = offEdge(a.from, x, y, c, size);
      if (!from) return { frames: 0, note: `${id}: ${choice.move} in needs from: left, right, top or bottom; it arrives as usual` };
      setRest();
      for (const p of ["scaleX", "scaleY"] as const) if (r[p] !== undefined) w.put(id, p, r[p]!, prep);
      w.put(id, "x", from[0], prep);
      w.put(id, "y", from[1], prep);
      w.put(id, "opacity", op, prep);
      if (choice.move === "travel") {
        w.put(id, "x", x, at, frames, (typeof a.ease === "string" ? a.ease : "out") as Ease);
        w.put(id, "y", y, at, frames, (typeof a.ease === "string" ? a.ease : "out") as Ease);
      } else {
        w.play(at, id, "arc", { x, y, bend: num(a.bend, 0.3), frames, ease: "out" });
        w.moved(id, "x", x);
        w.moved(id, "y", y);
      }
      return { frames };
    }
    case "fade":
    default:
      return { frames: 0, note: "" };
  }
}

/** A thing leaves by the move chosen. Returns the frames, or a note when the move is not one for leaving. */
export function carryExit(w: Writer, id: string, choice: MoveChoice, at: number, size: number, c: CarryCtx): { frames: number; note?: string } {
  const a = choice.args ?? {};
  const frames = Math.max(1, Math.round(a.seconds !== undefined ? num(a.seconds, 0) * c.fps : c.frames));
  if (choice.move === "cut") {
    w.put(id, "opacity", 0, at, 1, "step");
    return { frames: 1 };
  }
  if (choice.move === "travel") {
    const x = w.value(id, "x") as number;
    const y = w.value(id, "y") as number;
    const to = offEdge(a.to, x, y, c, size);
    if (!to) return { frames: 0, note: `${id}: travel out needs to: left, right, top or bottom; it leaves as usual` };
    w.put(id, "x", to[0], at, frames, "in");
    w.put(id, "y", to[1], at, frames, "in");
    w.put(id, "opacity", 0, at + frames, 1, "step");
    return { frames };
  }
  return { frames: 0, note: "" };
}

/** An accent played on a thing while it is there. `until` is when the moment ends (for moves that last the moment). */
export function carryAccent(w: Writer, id: string, choice: MoveChoice, at: number, until: number, c: CarryCtx, aroundId?: string): { frames: number; note?: string } {
  const a = choice.args ?? {};
  const short = Math.min(c.width, c.height);
  const sec = (d: number) => Math.max(1, Math.round((a.seconds !== undefined ? num(a.seconds, d) : d) * c.fps));
  switch (choice.move) {
    case "squash": {
      const f = sec(0.47);
      w.play(at, id, "squash", { amount: num(a.amount, 0.3), axis: a.axis === "x" ? "x" : "y", frames: f });
      return { frames: f };
    }
    case "jiggle": {
      const f = sec(0.6);
      w.play(at, id, "jiggle", { prop: typeof a.prop === "string" ? a.prop : "rotate", size: num(a.size, 10), cycles: num(a.cycles, 3), frames: f });
      return { frames: f };
    }
    case "wiggle": {
      const f = a.seconds !== undefined ? sec(1) : Math.max(1, until - at);
      w.play(at, id, "wiggle", { prop: typeof a.prop === "string" ? a.prop : "y", size: num(a.size, 8), speed: num(a.speed, 2), frames: f, seed: id.length });
      return { frames: f };
    }
    case "orbit": {
      const f = a.seconds !== undefined ? sec(1) : Math.max(1, until - at);
      const x = w.value(id, "x") as number;
      const y = w.value(id, "y") as number;
      const args: Record<string, Value> = { turns: num(a.turns, 1), frames: f, ease: "smooth" };
      if (aroundId) args.around = aroundId;
      else Object.assign(args, { cx: x, cy: y - num(a.radius, 0.05) * short });
      w.play(at, id, "orbit", args);
      return { frames: f };
    }
    case "hop": {
      const f = sec(1.3);
      w.play(at, id, "hop", { height: num(a.height, 0.08) * short, frames: f, squash: num(a.squash, 0.3), stretch: num(a.stretch, 0.22) });
      return { frames: f };
    }
  }
  return { frames: 0, note: `${id}: ${choice.move} is not an accent` };
}
