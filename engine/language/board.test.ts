// A board: one canvas larger than the frame, written state by state, with the camera going where the scene sends it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { CompileContext, Theme } from "../core/types.ts";
import { KITS } from "../kits/index.ts";
import { parse } from "./syntax.ts";
import { build, formatProblems } from "./build.ts";
import { followWriting } from "./board.ts";
import { safeArea } from "./layout.ts";

const words = Array.from({ length: 120 }, (_, i) => ({ start: i * 0.5 }));
const theme: Theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "TitleFont", body: "b" }, moveFrames: 10, ease: "linear" };
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 1900, words, theme, kits: KITS };
const safe = safeArea(1080, 1920);
const cams = (r: Awaited<ReturnType<typeof build>>) => r.doc!.steps.filter((s) => s.set?.camera).map((s) => ({ at: Number(s.at), ...(s.set!.camera as { panX: number; panY: number; zoom: number }) }));
const props = (r: Awaited<ReturnType<typeof build>>, id: string) => r.scene!.nodes.find((n) => n.id === id)?.props ?? {};

// A tall board about how a seed becomes a tree, written down three screens.
const tall = (follow: string, end = "camera b1") => `@0
board b1 w=1 h=3 ${follow}
  text t1 "A seed holds a tiny plant"
@6 keep
text t2 "Water wakes it up" into=b1 at=50,45
@12 keep
text t3 "Roots go down, a shoot goes up" into=b1 at=50,85
@20 keep
${end}
`;

test("the board parses as a container whose size is in screens", () => {
  const { doc, problems } = parse(`@0\nboard b1 w=2 h=2 follow=writing align=left\n  text a "one"\n`);
  assert.deepEqual(problems, []);
  const b = doc.states[0]!.items[0]!;
  assert.equal(b.kind, "board");
  assert.deepEqual(b.attrs, { w: "2", h: "2", follow: "writing", align: "left" });
  assert.equal(b.children[0]!.id, "a");
  assert.match(parse(`@0\nboard b1 zoom=2\n  text a "one"\n`).problems[0]!.message, /board has no setting "zoom"/);
});

test("a board is larger than the frame, and its writing keeps the size and place it has on a frame", async () => {
  const r = await build(tall("follow=writing"), { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  // Three screens tall, from the top left of the frame at rest.
  const t1 = props(r, "t1");
  const t3 = props(r, "t3");
  assert.ok(Number(t3.y) > safe.y + safe.h * 1.5, `t3 is two screens down: ${t3.y}`);
  assert.ok(Number(t1.y) < safe.y, `t1 is on the first screen: ${t1.y}`);
  // Text is laid out at its own size, not shrunk to fit the whole board on one frame.
  const size = props(r, "t1.l1").size;
  assert.equal(size, 70);
});

test("with follow=writing the camera goes to each new piece of writing and ends where the scene says, on the whole", async () => {
  const r = await build(tall("follow=writing"), { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  const c = cams(r);
  // Down to t2, down to t3, then out to the whole board.
  assert.equal(c.length, 3, JSON.stringify(c));
  assert.ok(c[0]!.panY > 960 && c[0]!.zoom === 1);
  assert.ok(c[1]!.panY > c[0]!.panY && c[1]!.zoom === 1);
  const last = c.at(-1)!;
  assert.ok(Math.abs(last.zoom - 1 / 3) < 0.01, `the whole board, three screens, at a third: ${last.zoom}`);
  // The overview's words are small on screen, which is a note with the measurement, not a problem.
  assert.ok(r.notes?.some((n) => /overview/.test(n) && /pixels tall on screen/.test(n)), JSON.stringify(r.notes));
});

test("without follow the camera stays where the scene puts it, and writing out of view is reported", async () => {
  const r = await build(tall(""), { ctx });
  assert.ok(r.problems.some((p) => /runs past the bottom edge|past the bottom/.test(p.message)), formatProblems(r.problems));
  // The scene moves the camera itself: no follow needed, nothing reported.
  const own = await build(`@0
board b1 w=1 h=2
  text t1 "Light comes in" size=big at=50,20
@6 keep
text t2 "Sugar comes out" size=big into=b1 at=50,75
camera t2 zoom=0.6
@12 keep
camera b1
`, { ctx });
  assert.deepEqual(own.problems, [], formatProblems(own.problems));
  assert.equal(cams(own).length, 2);
});

test("writing that arrives while the camera shows the whole board is too small to read and is reported", async () => {
  const r = await build(`@0
board b1 w=1 h=3
  text t1 "A seed holds a tiny plant"
camera b1
@6 keep
text t2 "Water wakes it up" into=b1 at=50,45
`, { ctx });
  assert.ok(r.problems.some((p) => /is written while the camera shows the board at zoom 0.33/.test(p.message)), formatProblems(r.problems));
});

test("things keep their place on the board while later states write more", async () => {
  const r = await build(`@0
board b1 w=1 h=2 follow=writing
  text t1 "First line" size=big
@6 keep
text t2 "Second line" size=big into=b1
@12 keep
text t3 "Third line" size=big into=b1
`, { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  // Lines without at= are written down the board in reading order, and t1 never moves.
  const ys = r.doc!.steps.filter((s) => s.set?.t1 && "y" in (s.set.t1 as object));
  assert.ok(ys.length <= 1, `t1 is placed once: ${JSON.stringify(ys)}`);
  const [y1, y2, y3] = ["t1", "t2", "t3"].map((id) => Number(props(r, id).y ?? NaN));
  assert.ok(y1! < y2! && y2! < y3!, `${y1} ${y2} ${y3}`);
});

test("a board stands alone and its writing stays inside it", async () => {
  const beside = await build(`@0\ntext h "Title"\nboard b1 w=1 h=2\n  text a "one"\n`, { ctx });
  assert.ok(beside.problems.some((p) => /A board is the whole frame/.test(p.message)), formatProblems(beside.problems));
  const spill = await build(`@0\nboard b1 w=1 h=1\n  text a "one" size=big at=50,99\n`, { ctx });
  assert.ok(spill.problems.some((p) => /runs past its edge/.test(p.message)), formatProblems(spill.problems));
  const bad = await build(`@0\nboard b1 follow=always\n  text a "one"\n`, { ctx });
  assert.ok(bad.problems.some((p) => /follow is writing .* or no/.test(p.message)), formatProblems(bad.problems));
});

test("the follow moves as little as it must and never past the board's edges", () => {
  const board = { x: safe.x, y: safe.y - safe.h / 2 + (safe.h * 3) / 2, w: safe.w, h: safe.h * 3 };
  const rest = { panX: 540, panY: 960, zoom: 1 };
  // Already in view: no move.
  assert.equal(followWriting({ x: safe.x, y: safe.y, w: 400, h: 100 }, board, rest, safe, 1080, 1920), undefined);
  // Just below the view: moves down so its bottom edge is in, no further.
  const below = safe.y + safe.h / 2 + 100;
  const v = followWriting({ x: safe.x, y: below, w: 400, h: 100 }, board, rest, safe, 1080, 1920)!;
  assert.equal(v.zoom, 1);
  assert.ok(Math.abs(v.panY - (960 + 150)) < 1, `${v.panY}`);
  // Past the bottom of the board: held at its edge.
  const end = followWriting({ x: safe.x, y: board.y + board.h / 2, w: 400, h: 100 }, board, rest, safe, 1080, 1920)!;
  assert.ok(Math.abs(end.panY + (safe.y - 960) + safe.h / 2 - (board.y + board.h / 2)) < 1, `${end.panY}`);
});

test("rewriting a line on the board is writing too, and the follow goes to it", async () => {
  const r = await build(`@0
board b1 w=1 h=2 follow=writing
  text t1 "Ice melts" at=50,10
  text t2 "at zero" at=50,90
@6 keep
text t1 "Ice melts at zero degrees" into=b1 at=50,10
`, { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  const c = cams(r);
  // First to the whole first state's writing (wider than a screen), then back up to the rewritten line at full size.
  assert.equal(c.at(-1)!.zoom, 1);
  assert.equal(c.at(-1)!.at, 90);
});

test("the guide's board example builds clean and ends on the whole board", async () => {
  const guide = readFileSync(new URL("../../prompts/engine-language.md", import.meta.url), "utf8");
  const section = guide.slice(guide.indexOf("# A board"), guide.indexOf("# Readable"));
  const block = section.slice(section.indexOf("    @0"));
  const src = block.split("\n").filter((l) => l.startsWith("    ")).map((l) => l.slice(4)).join("\n");
  const r = await build(src, { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  assert.ok(cams(r).at(-1)!.zoom < 0.34);
});
