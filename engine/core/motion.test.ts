import assert from "node:assert/strict";
import { test } from "node:test";
import { graphKit, part } from "../kits/graph.ts";
import { box, circle } from "../kits/shapes.ts";
import { area, clipLine, clipLoop, polyline, ring, toPts, walker, wedges, type Pt } from "../motion/geometry.ts";
import { apply, decompose, invert, local, mul } from "../motion/matrix.ts";
import { matchShapes } from "../motion/morph.ts";
import { fallAt, flights, springAt } from "../motion/physics.ts";
import { noise, seeded } from "../motion/random.ts";
import { compile } from "./compile.ts";
import { EASES } from "./ease.ts";
import { evaluate, resample } from "./evaluate.ts";
import type { CompileContext, Ease, NodeSpec, Props, Resolved, Scene, Step } from "./types.ts";

const ctx: CompileContext = { fps: 30, width: 1000, height: 1000, frames: 300, kits: [graphKit], theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", other: "#0000ff" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, id: string, frame: number): Props => {
  const hit = find(evaluate(s, frame), id);
  assert.ok(hit, `no ${id}`);
  return hit.props;
};
const dot = (id: string, x = 0, y = 0, more: Props = {}): NodeSpec => ({ id, kind: "path", props: { x, y, points: circle(0, 0, 20), closed: 1, fill: "ink", ...more } });
const stage = (nodes: NodeSpec[], ...steps: Step[]) => compile({ steps: [{ at: 0, enter: "none", add: nodes }, ...steps] }, ctx);
const close = (a: unknown, b: number, tol = 1e-6) => assert.ok(typeof a === "number" && Math.abs(a - b) <= tol, `${String(a)} is not ${b}`);
const star = (n = 5, r = 100, inner = 40) => {
  const out: number[] = [];
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const s = i % 2 ? inner : r;
    out.push(Math.cos(a) * s, Math.sin(a) * s);
  }
  return out;
};
const hasPoint = (flat: number[], p: Pt) => toPts(flat).some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6);
const travel = (a: number[], b: number[]) => toPts(a).reduce((s, p, i) => s + Math.hypot(p[0] - b[i * 2]!, p[1] - b[i * 2 + 1]!), 0) / (a.length / 2);

// --- eases

test("every ease starts at 0 and ends at 1", () => {
  for (const name of Object.keys(EASES) as Ease[]) {
    if (name !== "step") close(EASES[name](0), 0, 1e-9);
    close(EASES[name](1), 1, 1e-9);
  }
  assert.ok(EASES.anticipate(0.2) < 0, "anticipate pulls back first");
  assert.ok(EASES.overshoot(0.8) > 1, "overshoot goes past");
  assert.ok(EASES.swing(0.1) < 0 && EASES.swing(0.9) > 1);
});

// --- composition

test("a change that interrupts another takes over from the live value, with no jump", () => {
  const s = stage([dot("a")], { at: 10, move: { frames: 20 }, set: { a: { x: 100 } } }, { at: 20, move: { frames: 20 }, set: { a: { x: 300 } } });
  close(at(s, "a", 15).x, 25);
  close(at(s, "a", 20).x, 50);
  close(at(s, "a", 30).x, 175);
  close(at(s, "a", 40).x, 300);
  close(at(s, "a", 90).x, 300);
});

test("two changes starting on one frame: the later one in the document wins", () => {
  const s = stage([dot("a")], { at: 10, move: { frames: 10 }, set: { a: { x: 100 } } }, { at: 10, move: { frames: 10 }, set: { a: { x: 500 } } });
  close(at(s, "a", 15).x, 250);
  close(at(s, "a", 20).x, 500);
});

test("the document's order of steps does not matter, only their times", () => {
  const a = stage([dot("a")], { at: 30, set: { a: { x: 9 } } }, { at: 10, set: { a: { x: 5 } } });
  const b = stage([dot("a")], { at: 10, set: { a: { x: 5 } } }, { at: 30, set: { a: { x: 9 } } });
  assert.deepEqual(a.tracks, b.tracks);
});

test("additive moves both finish, and their distances sum", () => {
  const s = stage([dot("a")], { at: 0, move: { frames: 20, blend: "add" }, set: { a: { x: 100 } } }, { at: 10, move: { frames: 20, blend: "add" }, set: { a: { x: 300 } } });
  close(at(s, "a", 10).x, 50);
  close(at(s, "a", 20).x, 200);
  close(at(s, "a", 30).x, 300);
  assert.equal(s.tracks.filter((t) => t.target === "a" && t.prop === "x").length, 1);
});

test("offsets ride on a moving value and survive a takeover", () => {
  const s = stage([dot("a")], { at: 0, move: { frames: 30 }, set: { a: { x: 300 } } }, { at: 12, play: [{ behavior: "shake", target: "a", args: { size: 10 } }] }, { at: 15, move: { frames: 10 }, set: { a: { x: 0 } } });
  close(at(s, "a", 12).x, 120);
  close(at(s, "a", 15).x, 150 + 10);
  close(at(s, "a", 27).x, 0);
  close(at(s, "a", 18).x, 150 - 150 * 0.3 - 10);
});

test("overlapping pulses stack by multiplying and return exactly to rest", () => {
  const s = stage([dot("a", 0, 0, { scaleX: 2, scaleY: 2 })], { at: 10, play: [{ behavior: "pulse", target: "a", args: { size: 2, frames: 20 } }, { behavior: "pulse", target: "a", args: { size: 3, frames: 20 } }] });
  close(at(s, "a", 20).scaleX, 12, 1e-6);
  close(at(s, "a", 40).scaleX, 2);
});

test("a clean timeline stays a few eased keys", () => {
  const s = stage([dot("a")], { at: 10, set: { a: { x: 100 } } }, { at: 50, set: { a: { x: 200 } } });
  assert.equal(s.tracks.find((t) => t.prop === "x")!.keys.length, 5);
});

test("offsets on text or colors fail loudly", () => {
  assert.throws(() => evaluateAll(stage([{ id: "t", kind: "text", props: { text: "hi" } }], { at: 5, play: [{ behavior: "shake", target: "t", args: { prop: "text" } }] })), /cannot add/);
});
function evaluateAll(s: Scene) {
  return evaluate(s, 7);
}

test("a flow pulse does not show before it starts", () => {
  const s = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "l", kind: "path", props: { points: [0, 0, 100, 0] } }] }, { at: 40, play: [{ behavior: "flow", target: "l" }] }] }, ctx);
  assert.equal(at(s, "l", 20).pulse, -1);
  assert.equal(at(s, "l", 40).pulse, 0);
});

test("step stagger delays each target, and patterns select many parts", () => {
  const s = stage([dot("row.a"), dot("row.b"), dot("row.c")], { at: 10, move: { frames: 10, stagger: 5 }, set: { "row.*": { y: 100 } } });
  close(at(s, "row.a", 20).y, 100);
  close(at(s, "row.b", 20).y, 50);
  close(at(s, "row.c", 20).y, 0);
  assert.throws(() => stage([dot("a")], { at: 1, set: { "b.*": { y: 1 } } }), /nothing matches/);
});

test("a behavior value that is text is never treated as a color name", () => {
  const s = stage([{ id: "t", kind: "text", props: { text: "x" } }], { at: 5, set: { t: { text: "accent" } } });
  assert.equal(at(s, "t", 40).text, "accent");
});

// --- geometry and matrices

test("matrices match the render order and undo cleanly", () => {
  const m = local({ x: 10, y: 20, rotate: 30, skew: 10, scaleX: 2, scaleY: 3 });
  const p = apply(invert(m), apply(m, [7, -4]));
  close(p[0], 7, 1e-9);
  close(p[1], -4, 1e-9);
  const d = decompose(m);
  close(d.rotate, 30, 1e-9);
  close(d.skew, 10, 1e-9);
  close(d.scaleY, 3, 1e-9);
  assert.deepEqual(mul(m, [1, 0, 0, 1, 0, 0]).map((v) => +v.toFixed(9)), m.map((v) => +v.toFixed(9)));
});

test("walking a line goes by distance, not by point index", () => {
  const walk = walker([[0, 0], [1, 0], [100, 0]]);
  close(walk(0.5).x, 50);
});

test("smooth paths are walked on the curve that is drawn", () => {
  const c = polyline([0, 0, 50, 100, 100, 0], true);
  assert.ok(c.length >= 10);
  assert.ok(Math.max(...c.map((p) => p[1])) < 100);
});

test("wedges cover the whole outline and clipping keeps the right side", () => {
  const square = toPts(box(0, 0, 100, 100));
  const cut = wedges(square, [1, 1, 2]);
  const sum = cut.reduce((s, w) => s + Math.abs(area(ring(w))), 0);
  close(sum, 10000, 1e-6);
  close(Math.abs(area(cut[2]!.slice(0, -1))), 5000, 1e-6);
  close(Math.abs(area(clipLoop(ring(square), 1, 0, 30))), 3000, 1e-6);
  close(clipLine([[0, 0], [100, 0]], 1, 0, 40).at(-1)![0], 40);
});

// --- morph

test("a morph keeps both shapes exact, corners included, with equal counts", () => {
  const m = matchShapes(box(-50, -50, 100, 100), circle(0, 0, 60));
  assert.equal(m.a.length, m.b.length);
  for (const corner of [[-50, -50], [50, -50], [50, 50], [-50, 50]] as Pt[]) assert.ok(hasPoint(m.a, corner));
  close(Math.abs(area(ring(toPts(m.a)))), 10000, 1e-3);
  for (const p of toPts(m.b)) close(Math.hypot(p[0], p[1]), 60, 2);
  assert.equal(m.closed, true);
});

test("matching beats plain index resampling on shapes of any kind", () => {
  const pairs: [number[], number[]][] = [[star(), circle(0, 0, 80)], [box(-100, -20, 200, 40), circle(0, 0, 60)], [star(5), star(7)], [circle(0, 0, 50, 12), [...box(-80, -80, 160, 160)].reverse()]];
  for (const [a, b] of pairs) {
    const m = matchShapes(a, b);
    const n = Math.max(a.length, b.length) / 2;
    const flipped = toPts(b).reverse().flat();
    const naive = Math.min(travel(resample(a, n), resample(b, n)), travel(resample(a, n), resample(flipped, n)));
    assert.ok(travel(m.a, m.b) <= naive * 1.02, `${travel(m.a, m.b)} vs ${naive}`);
  }
});

test("opposite windings are matched without turning the shape inside out", () => {
  const m = matchShapes(circle(0, 0, 50), toPts(circle(0, 0, 50)).reverse().flat());
  assert.ok(travel(m.a, m.b) < 6);
  const middle = toPts(m.a).map((p, i): Pt => [(p[0] + m.b[i * 2]!) / 2, (p[1] + m.b[i * 2 + 1]!) / 2]);
  assert.ok(Math.abs(area(ring(middle))) > Math.PI * 2500 * 0.9, "halfway it still has its area");
});

test("rotated copies of a shape match with almost no travel", () => {
  const turned = toPts(box(-40, -40, 80, 80)).slice(2, 4).concat(toPts(box(-40, -40, 80, 80)).slice(0, 2), toPts(box(-40, -40, 80, 80)).slice(2, 3)).flat();
  assert.ok(travel(...(Object.values(matchShapes(box(-40, -40, 80, 80), turned)).slice(0, 2) as [number[], number[]])) < 1);
});

test("open lines match end to sensible end, and open can become closed", () => {
  const m = matchShapes([0, 0, 100, 0], [100, 50, 50, 80, 0, 50]);
  assert.ok(Math.hypot(m.a[0]! - m.b[0]!, m.a[1]! - m.b[1]!) < 60, "the line is not flipped");
  assert.equal(matchShapes([0, 0, 100, 0], circle(0, 0, 50)).closed, false);
  assert.throws(() => matchShapes([0, 0], box(0, 0, 1, 1)), /two points/);
  assert.throws(() => matchShapes([0, 0, 0, 0], box(0, 0, 1, 1)), /some length/);
});

test("morph takes any path to any path, in any coordinates", () => {
  const s = stage([dot("a", 100, 100), { id: "b", kind: "path", props: { x: 300, y: 100, points: box(-30, -30, 60, 60), closed: 1 } }], { at: 10, play: [{ behavior: "morph", target: "a", args: { to: "b", frames: 20 } }] });
  const done = at(s, "a", 30).points as number[];
  const xs = toPts(done).map((p) => p[0]);
  close(Math.min(...xs), 170, 1e-6);
  close(Math.max(...xs), 230, 1e-6);
  assert.equal((at(s, "a", 20).points as number[]).length, done.length);
  assert.throws(() => stage([{ id: "t", kind: "text", props: { text: "hi" } }], { at: 1, play: [{ behavior: "morph", target: "t", args: { to: box(0, 0, 1, 1) } }] }), /needs a path/);
});

test("a morph interrupted halfway continues from the shape it has reached", () => {
  const s = stage([dot("a")], { at: 10, play: [{ behavior: "morph", target: "a", args: { to: box(-40, -40, 80, 80), frames: 20, ease: "linear" } }] }, { at: 20, play: [{ behavior: "morph", target: "a", args: { to: star(), frames: 20, ease: "linear" } }] });
  const size = (f: number) => Math.abs(area(ring(polyline(at(s, "a", f).points as number[]))));
  assert.ok(Math.abs(size(20) - size(19)) <= Math.abs(size(19) - size(18)) * 1.3, "no jump at the handover");
});

// --- paths and arcs

test("follow moves at even speed along the line and can face along it", () => {
  const s = stage([dot("a")], { at: 10, play: [{ behavior: "follow", target: "a", args: { points: [0, 0, 100, 0, 100, 100], frames: 20, ease: "linear", orient: 1 } }] });
  close(at(s, "a", 20).x, 100, 1e-6);
  close(at(s, "a", 25).y, 50, 1e-6);
  close(at(s, "a", 15).rotate, 0, 1e-6);
  close(at(s, "a", 25).rotate, 90, 1e-6);
});

test("follow can ride a path that is itself moving, even if it moves later in the document", () => {
  const s = stage([dot("a"), { id: "track", kind: "path", props: { x: 0, y: 500, points: [0, 0, 100, 0] } }], { at: 0, play: [{ behavior: "follow", target: "a", args: { path: "track", frames: 100, ease: "linear" } }] }, { at: 0, move: { frames: 100 }, set: { track: { x: 400 } } });
  close(at(s, "a", 50).x, 250, 1e-6);
  close(at(s, "a", 50).y, 500, 1e-6);
});

test("arc reaches its end by a true circle, bowing to the side asked for", () => {
  const s = stage([dot("a")], { at: 0, play: [{ behavior: "arc", target: "a", args: { x: 200, y: 0, bend: 0.5, frames: 20 } }] });
  close(at(s, "a", 20).x, 200);
  close(at(s, "a", 20).y, 0);
  const mid = at(s, "a", 10);
  close(mid.x, 100, 1e-6);
  close(mid.y, 100, 1e-6);
  const other = stage([dot("a")], { at: 0, play: [{ behavior: "arc", target: "a", args: { x: 200, bend: -0.5, frames: 20 } }] });
  close(at(other, "a", 10).y, -100, 1e-6);
  for (let f = 1; f < 20; f++) close(Math.hypot((at(s, "a", f).x as number) - 100, at(s, "a", f).y as number), 100, 1e-6);
});

test("orbit circles a part while that part travels", () => {
  const s = stage([dot("sun", 100, 100), dot("moon", 200, 100)], { at: 0, play: [{ behavior: "orbit", target: "moon", args: { around: "sun", turns: 1, frames: 100 } }] }, { at: 0, move: { frames: 100 }, set: { sun: { x: 500 } } });
  close(at(s, "moon", 50).x, 200, 1e-6);
  close(at(s, "moon", 50).y, 100, 1e-6);
  close(at(s, "moon", 25).y, 200, 1e-6);
});

// --- physics

test("spring matches the exact solution of a damped oscillator, in every regime", () => {
  for (const s of [{ stiffness: 100, damping: 4, mass: 1 }, { stiffness: 100, damping: 20, mass: 1 }, { stiffness: 100, damping: 60, mass: 1 }]) {
    let [x, v] = [1, 0.5];
    const h = 1e-5;
    for (let t = 0; t < 1; t += h) {
      v += (-s.stiffness * x - s.damping * v) * h;
      x += v * h;
    }
    close(springAt(1, 1, 0.5, s), x, 1e-3);
  }
});

test("a spring reaches its value exactly, and overshoots when underdamped", () => {
  const s = stage([dot("a")], { at: 5, play: [{ behavior: "spring", target: "a", args: { x: 100, stiffness: 200, damping: 10 } }] });
  const track = s.tracks.find((t) => t.prop === "x")!;
  const end = track.keys.at(-1)!.at;
  close(at(s, "a", end).x, 100);
  const peak = Math.max(...Array.from({ length: end }, (_, f) => at(s, "a", f).x as number));
  assert.ok(peak > 105);
});

test("a spring that interrupts a move keeps its speed", () => {
  const s = stage([dot("a")], { at: 0, move: { frames: 20 }, set: { a: { x: 200 } } }, { at: 10, play: [{ behavior: "spring", target: "a", args: { x: 0, stiffness: 100, damping: 20 } }] });
  const [a, b, c] = [at(s, "a", 9).x as number, at(s, "a", 10).x as number, at(s, "a", 11).x as number];
  close(b - a, 10, 1e-6);
  assert.ok(c - b > 0, "still moving forward just after");
});

test("a fall obeys gravity, bounces lower each time, and comes to rest on the floor", () => {
  const f = { y: 0, vy: 0, floor: 1000, gravity: 2000, bounce: 0.5, minHop: 2 };
  const path = flights(f);
  close(path.list[1]!.start, 1, 1e-9);
  close(fallAt(0.5, f, path), 250, 1e-9);
  close(fallAt(1 + 0.5, f, path), 1000 - 250, 1e-9); // rebounds to a quarter of the height, the top of its flight
  assert.equal(fallAt(100, f, path), 1000);
  const s = stage([dot("a")], { at: 3, play: [{ behavior: "fall", target: "a", args: { floor: 500, bounce: 0.5, vx: 60 } }] });
  const y = s.tracks.find((t) => t.prop === "y")!;
  close(at(s, "a", y.keys.at(-1)!.at).y, 500, 1e-6);
  assert.ok(s.events.filter((e) => e.name === "bounce").length >= 3);
  assert.ok((at(s, "a", 30).x as number) > 0);
});

test("physics gives the same frames whatever order they are asked in", () => {
  const make = () => stage([dot("a"), dot("b", 300)], { at: 0, play: [{ behavior: "fall", target: "a", args: { floor: 400 } }, { behavior: "spring", target: "b", args: { y: 200, damping: 6 } }, { behavior: "wiggle", target: "b", args: { prop: "x", seed: 4 } }] });
  const s = make();
  const forward = [10, 40, 80].map((f) => JSON.stringify(evaluate(s, f)));
  const back = [80, 40, 10].map((f) => JSON.stringify(evaluate(s, f))).reverse();
  assert.deepEqual(forward, back);
  assert.equal(JSON.stringify(make().tracks), JSON.stringify(s.tracks));
});

// --- weight

test("squash keeps volume, overshoots, and leaves the size exactly as it was", () => {
  const s = stage([dot("a", 0, 0, { scaleX: 2, scaleY: 2 })], { at: 10, play: [{ behavior: "squash", target: "a", args: { amount: 0.4, frames: 30 } }] });
  const [x, y] = [at(s, "a", 15).scaleX as number, at(s, "a", 15).scaleY as number];
  assert.ok(y < 2);
  close(x * y, 4, 1e-6);
  const tall = Math.max(...Array.from({ length: 30 }, (_, i) => at(s, "a", 10 + i).scaleY as number));
  assert.ok(tall > 2, "rebounds past normal");
  close(at(s, "a", 40).scaleY, 2);
});

test("hop crouches first, keeps its feet down, stretches in the air, and lands exactly", () => {
  const s = stage([dot("a", 0, 500)], { at: 0, play: [{ behavior: "hop", target: "a", args: { x: 300, height: 200, frames: 50 } }] });
  const crouch = at(s, "a", 8);
  assert.ok((crouch.scaleY as number) < 0.9 && (crouch.scaleX as number) > 1);
  close((crouch.y as number) + 20 * (crouch.scaleY as number), 520, 1e-6);
  assert.ok((at(s, "a", 15).scaleY as number) > 1, "stretched leaving the ground");
  assert.ok((at(s, "a", 25).y as number) < 330, "high in the air");
  close(at(s, "a", 50).x, 300);
  close(at(s, "a", 50).y, 500);
  close(at(s, "a", 50).scaleY, 1);
});

test("jiggle and wiggle add on top and end at rest", () => {
  const s = stage([dot("a", 100)], { at: 0, play: [{ behavior: "jiggle", target: "a", args: { prop: "x", size: 20, frames: 30 } }, { behavior: "wiggle", target: "a", args: { prop: "x", size: 5, frames: 60, seed: 3 } }] });
  assert.notEqual(at(s, "a", 8).x, 100);
  close(at(s, "a", 60).x, 100);
  assert.notEqual(noise(0.5, 1), noise(0.5, 2));
  assert.equal(seeded("a")(), seeded("a")());
});

// --- attachments

test("attach keeps the gap as the leader moves, across different parents, at any time in the document", () => {
  const s = stage([{ id: "room", kind: "group", props: { x: 100, y: 0 } }, { ...dot("leader", 0, 0), parent: "room" }, dot("tag", 150, 50)], { at: 0, play: [{ behavior: "attach", target: "tag", args: { to: "leader" } }] }, { at: 20, move: { frames: 20 }, set: { leader: { x: 300 } } });
  close(at(s, "tag", 40).x, 450, 1e-6);
  close(at(s, "tag", 40).y, 50, 1e-6);
  close(at(s, "tag", 0).x, 150, 1e-6);
});

test("attach can carry rotation, lag behind, add its own moves, and let go", () => {
  const spin = stage([dot("arm", 100, 100), dot("hand", 200, 100)], { at: 0, play: [{ behavior: "attach", target: "hand", args: { to: "arm", rotate: 1 } }] }, { at: 0, move: { frames: 10 }, set: { arm: { rotate: 90 } } });
  close(at(spin, "hand", 10).x, 100, 1e-6);
  close(at(spin, "hand", 10).y, 200, 1e-6);
  close(at(spin, "hand", 10).rotate, 90, 1e-6);

  const lag = stage([dot("a"), dot("b")], { at: 0, play: [{ behavior: "attach", target: "b", args: { to: "a", lag: 5 } }] }, { at: 0, move: { frames: 10 }, set: { a: { x: 100 } } });
  close(at(lag, "b", 8).x, 30, 1e-6);

  const own = stage([dot("a"), dot("b")], { at: 0, play: [{ behavior: "attach", target: "b", args: { to: "a" } }] }, { at: 0, move: { frames: 10 }, set: { a: { x: 100 }, b: { y: 40 } } });
  close(at(own, "b", 10).x, 100, 1e-6);
  close(at(own, "b", 10).y, 40, 1e-6);

  const free = stage([dot("a"), dot("b")], { at: 0, play: [{ behavior: "attach", target: "b", args: { to: "a", frames: 10 } }] }, { at: 0, move: { frames: 20 }, set: { a: { x: 200 } } });
  close(at(free, "b", 10).x, 100, 1e-6);
  close(at(free, "b", 30).x, 100, 1e-6);
});

test("chains resolve in any order, and loops fail loudly", () => {
  const s = stage([dot("a"), dot("b", 10), dot("c", 20)], { at: 0, play: [{ behavior: "attach", target: "c", args: { to: "b" } }, { behavior: "attach", target: "b", args: { to: "a" } }] }, { at: 0, move: { frames: 10 }, set: { a: { x: 100 } } });
  close(at(s, "c", 10).x, 120, 1e-6);
  assert.throws(() => stage([dot("a"), dot("b")], { at: 0, play: [{ behavior: "attach", target: "a", args: { to: "b" } }, { behavior: "attach", target: "b", args: { to: "a" } }] }), /motion loop/);
});

test("a tether keeps a line between two moving parts", () => {
  const s = stage([dot("a"), dot("b", 100), { id: "line", kind: "path", props: { points: [0, 0, 1, 1] } }], { at: 0, play: [{ behavior: "tether", target: "line", args: { from: "a", to: "b", gap: 10 } }] }, { at: 0, move: { frames: 10 }, set: { b: { x: 300 } } });
  assert.deepEqual((at(s, "line", 10).points as number[]).map((v) => +v.toFixed(6)), [10, 0, 290, 0]);
});

// --- stagger

test("stagger runs any behavior in any order", () => {
  const nodes = [dot("n.a", 0), dot("n.b", 100), dot("n.c", 300), dot("n.d", 200)];
  const delayOf = (order: string, more = {}) => {
    const s = stage(nodes, { at: 10, play: [{ behavior: "stagger", target: "n.*", args: { use: "squash", gap: 10, order, frames: 8, ...more } }] });
    return nodes.map((n) => s.tracks.find((t) => t.target === n.id && t.prop === "scaleY")!.keys.find((k) => (k.value as number) !== 1)!.at);
  };
  const first = (order: string, more = {}) => delayOf(order, more);
  assert.deepEqual(first("index").map((v, i, l) => v - l[0]!), [0, 10, 20, 30]);
  assert.deepEqual(first("reverse").map((v, i, l) => v - l[3]!), [30, 20, 10, 0]);
  assert.deepEqual(first("x").map((v, i, l) => v - l[0]!), [0, 10, 30, 20]);
  assert.deepEqual(first("center").map((v, i, l) => v - l[1]!), [10, 0, 0, 10]);
  assert.deepEqual(first("distance", { from: "n.a" }).map((v, i, l) => v - l[0]!), [0, 10, 30, 20]);
  assert.deepEqual(first("random", { seed: 2 }), first("random", { seed: 2 }));
  assert.throws(() => stage(nodes, { at: 0, play: [{ behavior: "stagger", target: "n.*", args: { use: "pulse", order: "sideways" } }] }), /unknown stagger order/);
});

// --- split and merge

test("split cuts a shape into parts that cover it and fly apart", () => {
  const s = stage([dot("cell", 500, 500)], { at: 10, play: [{ behavior: "split", target: "cell", args: { parts: 5, spread: 100, frames: 20, seed: 3 } }] });
  const ids = [0, 1, 2, 3, 4].map((i) => `cell.part.${i}`);
  const total = ids.reduce((sum, id) => sum + Math.abs(area(ring(toPts(at(s, id, 10).points as number[])))), 0);
  close(total, Math.abs(area(ring(toPts(circle(0, 0, 20))))), 1);
  assert.equal(at(s, "cell", 9).opacity, 1);
  assert.equal(at(s, "cell", 10).opacity, 0);
  assert.equal(at(s, ids[0]!, 9).opacity, 0);
  assert.equal(at(s, ids[0]!, 10).opacity, 1);
  for (const id of ids) close(Math.hypot((at(s, id, 40).x as number) - 500, (at(s, id, 40).y as number) - 500), 100, 1e-6);
});

test("split also cuts a line into lengths", () => {
  const s = stage([{ id: "rope", kind: "path", props: { points: [0, 0, 300, 0], stroke: "ink" } }], { at: 0, play: [{ behavior: "split", target: "rope", args: { parts: 3, seed: 1, frames: 10 } }] });
  const spans = [0, 1, 2].map((i) => at(s, `rope.part.${i}`, 0).points as number[]);
  close(spans[0]![0], 0);
  close(spans[2]!.at(-2), 300, 1e-6);
  close(spans[0]!.at(-2), spans[1]![0]!, 1e-6);
});

test("split into existing parts ends with them, and they stay hidden until it does", () => {
  const s = stage([dot("whole", 300, 300), dot("kid.a", 100, 100), dot("kid.b", 500, 500)], { at: 10, play: [{ behavior: "split", target: "whole", args: { into: "kid.*", frames: 20 } }] });
  assert.equal(at(s, "kid.a", 5).opacity, 0);
  assert.equal(at(s, "kid.a", 37).opacity, 1);
  const shape = at(s, "whole.part.0", 30);
  const pts = toPts(shape.points as number[]).map((p) => p[0] + (shape.x as number));
  const xs = [Math.min(...pts), Math.max(...pts)];
  assert.ok(Math.abs(xs[0]! - 80) < 1 || Math.abs(xs[0]! - 480) < 1, `${xs[0]}`);
});

test("merge turns parts into a whole, wherever the parts sit", () => {
  const s = stage([dot("seed.a", 100, 100), dot("seed.b", 500, 100), { id: "note", kind: "text", props: { x: 300, y: 500, text: "ok" } }, { id: "fruit", kind: "path", props: { x: 300, y: 300, points: box(-50, -50, 100, 100), closed: 1, fill: "accent" } }], { at: 10, play: [{ behavior: "merge", target: "seed.*", args: { into: "fruit", frames: 20 } }] });
  assert.equal(at(s, "fruit", 5).opacity, 0);
  const a = at(s, "seed.a", 30);
  const inScene = toPts(a.points as number[]).map((p): Pt => [p[0] + (a.x as number), p[1] + (a.y as number)]);
  const total = ["seed.a", "seed.b"].reduce((sum, id) => sum + Math.abs(area(ring(toPts(at(s, id, 30).points as number[])))), 0);
  close(total, 10000, 1);
  assert.ok(inScene.every((p) => p[0] >= 249 && p[0] <= 351 && p[1] >= 249 && p[1] <= 351));
  assert.equal(at(s, "fruit", 37).opacity, 1);
  assert.equal(at(s, "seed.a", 37).opacity, 0);
});

test("merge carries parts that have no outline", () => {
  const s = stage([{ id: "w.a", kind: "text", props: { x: 0, y: 0, text: "one" } }, dot("w.b", 600, 0), { id: "all", kind: "path", props: { x: 300, y: 300, points: box(-40, -40, 80, 80), closed: 1 } }], { at: 0, play: [{ behavior: "merge", target: "w.*", args: { into: "all", frames: 20 } }] });
  assert.ok(Math.hypot((at(s, "w.a", 20).x as number) - 300, (at(s, "w.a", 20).y as number) - 300) < 60);
});

// --- trails, ripples, waves

test("ghost trails replay the leader's past, fainter the further back", () => {
  const s = stage([dot("a")], { at: 0, play: [{ behavior: "trail", target: "a", args: { count: 3, gap: 5, frames: 40, fade: 0.6 } }] }, { at: 0, move: { frames: 30 }, set: { a: { x: 300 } } });
  close(at(s, "a.ghost.1", 20).x, 150, 1e-6);
  close(at(s, "a.ghost.2", 20).x, 100, 1e-6);
  assert.ok((at(s, "a.ghost.1", 20).opacity as number) > (at(s, "a.ghost.3", 20).opacity as number));
  assert.equal(at(s, "a.ghost.1", 60).opacity, 0);
  const order = s.nodes.map((n) => n.id);
  assert.ok(order.indexOf("a.ghost.1") < order.indexOf("a"), "drawn beneath the leader");
});

test("ghost trails copy whole groups", () => {
  const s = stage([{ id: "car", kind: "group", props: {} }, { ...dot("car.wheel", 10, 0), parent: "car" }], { at: 0, play: [{ behavior: "trail", target: "car", args: { count: 1, frames: 20 } }] });
  assert.ok(find(evaluate(s, 5), "car.ghost.1")!.children.length === 1);
});

test("a line trail traces where a part has been", () => {
  const s = stage([dot("a")], { at: 0, play: [{ behavior: "trail", target: "a", args: { mode: "line", length: 10, frames: 40 } }] }, { at: 0, move: { frames: 30 }, set: { a: { x: 300 } } });
  const p = at(s, "a.trail", 20).points as number[];
  close(p[0], 200, 1e-6);
  close(p.at(-2), 100, 1e-6);
});

test("ripple sends fading rings out, and wave passes through parts from a source", () => {
  const s = stage([dot("drop", 200, 200)], { at: 10, play: [{ behavior: "ripple", target: "drop", args: { count: 2, gap: 5, frames: 20, size: 100 } }] });
  close(at(s, "drop.ripple.0", 30).scaleX, 5, 1e-6);
  assert.equal(at(s, "drop.ripple.0", 30).opacity, 0);
  assert.equal(at(s, "drop.ripple.1", 12).opacity, 0);
  const ring20 = at(s, "drop.ripple.0", 17);
  close((ring20.strokeWidth as number) * (ring20.scaleX as number), 6, 1e-6);

  const w = stage([dot("src"), dot("g.a", 120), dot("g.b", 240)], { at: 0, play: [{ behavior: "wave", target: "g.*", args: { from: "src", speed: 12, size: 50, period: 20, cycles: 1 } }] });
  assert.equal(at(w, "g.a", 10).y, 0);
  assert.notEqual(at(w, "g.a", 14).y, 0);
  assert.equal(at(w, "g.b", 19).y, 0);
  assert.notEqual(at(w, "g.b", 24).y, 0);
  close(at(w, "g.b", 60).y, 0);
});

test("a wave along one line bumps it and restores it exactly", () => {
  const points = [0, 0, 400, 0];
  const s = stage([{ id: "rope", kind: "path", props: { points } }], { at: 0, play: [{ behavior: "wave", target: "rope", args: { size: 40, frames: 30 } }] });
  const mid = toPts(at(s, "rope", 15).points as number[]);
  assert.ok(Math.max(...mid.map((p) => Math.abs(p[1]))) > 30);
  assert.deepEqual(at(s, "rope", 40).points, points);
});

// --- wipes and text

test("wipe truly cuts a shape along the edge and restores it", () => {
  const original = box(0, 0, 100, 100);
  const s = stage([{ id: "a", kind: "path", props: { points: original, closed: 1, fill: "ink" } }], { at: 10, play: [{ behavior: "wipe", target: "a", args: { frames: 20, ease: "linear", angle: 0 } }] });
  assert.equal(at(s, "a", 5).opacity, 0);
  const half = toPts(at(s, "a", 20).points as number[]);
  close(Math.max(...half.map((p) => p[0])), 50, 1.1);
  assert.deepEqual(at(s, "a", 31).points, original);
  assert.equal(at(s, "a", 31).opacity, 1);

  const out = stage([{ id: "a", kind: "path", props: { points: original, closed: 1 } }], { at: 10, play: [{ behavior: "wipe", target: "a", args: { frames: 20, ease: "linear", out: 1, angle: 90 } }] });
  assert.equal(at(out, "a", 5).opacity, 1);
  close(Math.min(...toPts(at(out, "a", 20).points as number[]).map((p) => p[1])), 50, 1.1);
  assert.equal(at(out, "a", 30).opacity, 0);
});

test("wipe respects transforms, and covers a whole group", () => {
  const s = stage([{ id: "sign", kind: "group", props: { x: 100 } }, { id: "sign.plate", kind: "path", parent: "sign", props: { points: box(0, 0, 100, 40), closed: 1, scaleX: 2 } }, { id: "sign.word", kind: "text", parent: "sign", props: { x: 50, text: "hello", size: 20 } }], { at: 0, play: [{ behavior: "wipe", target: "sign", args: { frames: 30, ease: "linear" } }] });
  const p = toPts(at(s, "sign.plate", 15).points as number[]);
  close(Math.max(...p.map((q) => q[0])), 50, 1.5);
  const a = at(s, "sign.word", 15).opacity as number;
  assert.ok(a > 0 && a <= 1);
  assert.equal(at(s, "sign.word", 30).opacity, 1);
});

test("open lines wipe too", () => {
  const s = stage([{ id: "l", kind: "path", props: { points: [0, 0, 100, 0] } }], { at: 0, play: [{ behavior: "wipe", target: "l", args: { frames: 10, ease: "linear" } }] });
  close(Math.max(...toPts(at(s, "l", 5).points as number[]).map((p) => p[0])), 50, 1.5);
});

test("type reveals letters, and counts land exactly", () => {
  const s = stage([{ id: "t", kind: "text", props: { text: "abcd" } }], { at: 10, play: [{ behavior: "type", target: "t", args: { frames: 8 } }] });
  assert.equal(at(s, "t", 5).text, "");
  assert.equal(at(s, "t", 14).text, "ab");
  assert.equal(at(s, "t", 18).text, "abcd");

  const c = stage([{ id: "n", kind: "text", props: { text: "12" } }], { at: 0, play: [{ behavior: "count", target: "n", args: { to: 1250000, frames: 30, prefix: "$", sep: 1, ease: "linear" } }] });
  assert.equal(at(c, "n", 0).text, "$12");
  assert.equal(at(c, "n", 30).text, "$1,250,000");
  const d = stage([{ id: "n", kind: "text", props: { text: "" } }], { at: 0, play: [{ behavior: "count", target: "n", args: { from: 0, to: 2.5, decimals: 2, suffix: " kg", frames: 10, ease: "linear" } }] });
  assert.equal(at(d, "n", 5).text, "1.25 kg");
  assert.equal(at(d, "n", 10).text, "2.50 kg");
});

// --- color spreading

test("color spreads along a line from either end, then belongs to the line", () => {
  const s = stage([{ id: "l", kind: "path", props: { points: [0, 0, 100, 0], stroke: "ink", strokeWidth: 4 } }], { at: 10, play: [{ behavior: "spread", target: "l", args: { color: "accent", frames: 20 } }] });
  close(at(s, "l.spread", 20).drawn, 0.5, 1e-6);
  assert.equal(at(s, "l.spread", 20).stroke, "#ff0000");
  assert.equal(at(s, "l.spread", 5).opacity, 0);
  assert.equal(at(s, "l", 31).stroke, "#ff0000");
  assert.equal(at(s, "l.spread", 40).opacity, 0);
  const back = stage([{ id: "l", kind: "path", props: { points: [0, 0, 100, 0] } }], { at: 0, play: [{ behavior: "spread", target: "l", args: { reverse: 1, frames: 5 } }] });
  assert.equal((at(back, "l.spread", 0).points as number[])[0], 100);
});

test("color spreads through a graph by real distance, in time with each route", () => {
  const nodes = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }, { id: "c", x: 300, y: 300 }, { id: "d", x: 900, y: 900 }];
  const s = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "g", kind: "graph", data: { nodes, edges: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }] } }] }, { at: 10, play: [{ behavior: "spread", target: part.node("g", "a"), args: { through: "g.**", color: "accent", speed: 10 } }] }] }, ctx);
  const [a, b, c, d] = ["a", "b", "c", "d"].map((n) => part.node("g", n));
  const arrivals = s.events.filter((e) => e.name === "arrive");
  assert.deepEqual(arrivals.map((e) => e.data!.target), [a, b, c]);
  assert.ok(arrivals[1]!.at! < arrivals[2]!.at!);
  assert.equal(at(s, b!, arrivals[1]!.at! - 1).fill, "#ffffff");
  assert.equal(at(s, b!, arrivals[1]!.at! + 10).fill, "#ff0000");
  assert.equal(at(s, d!, 200).fill, "#ffffff", "an unconnected node stays untouched");
  assert.equal(at(s, part.edge("g", "bc"), 200).stroke, "#ff0000");
});

test("spreading works on any drawing, with no kit, and from a route's far end", () => {
  const places = [dot("pipe.tank", 0, 0), dot("pipe.tap", 300, 0)];
  const route: NodeSpec = { id: "pipe.run", kind: "path", props: { points: [300, 0, 0, 0], stroke: "ink" } };
  const s = stage([...places, route], { at: 0, play: [{ behavior: "spread", target: "pipe.tank", args: { through: "pipe.*", color: "other", speed: 30 } }] });
  assert.equal((at(s, "pipe.run.spread", 3).points as number[])[0], 0, "it fills from the end nearest the source");
  assert.equal(at(s, "pipe.tap", 30).fill, "#0000ff");
  assert.throws(() => stage([...places, route], { at: 0, play: [{ behavior: "spread", target: "pipe.run", args: { through: "pipe.*" } }] }), /closed shape/);
});

// --- camera

const seen = (s: Scene, id: string, frame: number): Pt => {
  const chain: Props[] = [];
  const walk = (list: Resolved[], up: Props[]): boolean => list.some((r) => (r.id === id ? (chain.push(...up, r.props), true) : walk(r.children, [...up, r.props])));
  walk(evaluate(s, frame), []);
  const n = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  const m = chain.reduce<ReturnType<typeof local>>((acc, p) => mul(acc, local({ x: n(p.x, 0), y: n(p.y, 0), rotate: n(p.rotate, 0), skew: n(p.skew, 0), scaleX: n(p.scaleX, 1), scaleY: n(p.scaleY, 1) })), [1, 0, 0, 1, 0, 0]);
  return apply(m, [0, 0]);
};

test("a scene that does not use a camera has none", () => {
  assert.ok(!stage([dot("a")]).nodes.some((n) => n.id === "camera"));
});

test("the camera pans, zooms and tilts around what it looks at", () => {
  const s = stage([dot("thing", 800, 200), dot("near", 900, 200)], { at: 0, move: { frames: 20 }, set: { camera: { panX: 800, panY: 200, zoom: 2 } } });
  close(seen(s, "thing", 0)[0], 800, 1e-6);
  close(seen(s, "thing", 20)[0], 500, 1e-6);
  close(seen(s, "thing", 20)[1], 500, 1e-6);
  close(seen(s, "near", 20)[0], 700, 1e-6);
  const t = stage([dot("thing", 600, 500)], { at: 0, move: { frames: 10 }, set: { camera: { tilt: 90 } } });
  close(seen(t, "thing", 10)[0], 500, 1e-6);
  close(seen(t, "thing", 10)[1], 600, 1e-6);
});

test("everything works on the camera: springs, shakes, overlaps; and screen parts stay put", () => {
  const s = stage([dot("thing", 500, 500), dot("caption", 100, 900, { screen: 1 })], { at: 0, play: [{ behavior: "spring", target: "camera", args: { panX: 700, damping: 30 } }] }, { at: 5, play: [{ behavior: "shake", target: "camera", args: { prop: "panY", size: 10 } }] });
  close(seen(s, "thing", 150)[0], 300, 1e-3);
  assert.notEqual(seen(s, "thing", 8)[1], 500);
  close(seen(s, "caption", 150)[0], 100, 1e-9);
});

test("things attached across the camera line stay glued on screen", () => {
  const s = stage([dot("thing", 200, 200), dot("tag", 30, 30, { screen: 1 })], { at: 0, play: [{ behavior: "attach", target: "tag", args: { to: "thing", x: 0, y: -50 } }] }, { at: 0, move: { frames: 20 }, set: { camera: { panX: 200, panY: 200, zoom: 2 } } });
  close(seen(s, "tag", 20)[0], 500, 1e-6);
  close(seen(s, "tag", 20)[1], 450, 1e-6);
});

// --- across topics, nothing is special

test("the vocabulary composes on one part at once, over different worlds", () => {
  const worlds: [string, Step[]][] = [
    ["a cell dividing", [{ at: 0, play: [{ behavior: "morph", target: "x", args: { to: star(), frames: 40 } }, { behavior: "hop", target: "x", args: { x: 200, frames: 40 } }, { behavior: "wiggle", target: "x", args: { prop: "rotate", frames: 40 } }, { behavior: "trail", target: "x", args: { count: 2, frames: 40 } }] }]],
    ["a price rising", [{ at: 5, play: [{ behavior: "follow", target: "x", args: { points: [0, 0, 50, -90, 200, -300], smooth: 1, frames: 30 } }, { behavior: "pulse", target: "x" }, { behavior: "ripple", target: "x" }] }]],
    ["a planet in orbit", [{ at: 0, play: [{ behavior: "orbit", target: "x", args: { cx: 300, cy: 300, turns: 2, frames: 60 } }, { behavior: "squash", target: "x" }, { behavior: "wipe", target: "x" }] }]],
  ];
  for (const [, steps] of worlds) {
    const s = stage([dot("x", 100, 100)], ...steps);
    for (let f = 0; f < 80; f += 7) {
      const text = JSON.stringify(evaluate(s, f));
      assert.ok(!text.includes("null"), "no broken numbers");
    }
  }
});
