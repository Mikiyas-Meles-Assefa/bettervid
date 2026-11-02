// The abilities documentaries need, as general words of the language: pictures that fill the frame, the camera, marks
// at places inside a thing, cuts and entrances.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene } from "../core/types.ts";
import { build, formatProblems } from "./build.ts";

const words = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.5 }));
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 900, words, theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
const pics = { assets: { photo: "/a.jpg", other: "/b.jpg" } };
const ok = async (src: string, extra = {}) => {
  const r = await build(src, { ctx, ...extra });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r.scene!;
};
const bad = async (src: string, extra = {}) => {
  const r = await build(src, { ctx, ...extra });
  assert.ok(r.problems.length, "expected problems");
  return formatProblems(r.problems);
};
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => find(evaluate(s, f), id);

test("a picture can fill the frame, behind the arrangement, taking no room in it", async () => {
  const s = await ok(`@0\nimage p asset=photo w=1000 h=1000 frame=fill\ntext t "over it"\n`, pics);
  const p = at(s, 30, "p")!;
  assert.equal(p.props.w, 1920);
  assert.equal(p.props.h, 1920);
  assert.equal(p.props.z, -2);
  const fit = await ok(`@0\nimage p asset=photo w=1000 h=500 frame=fit\n`, pics);
  assert.equal(at(fit, 30, "p")!.props.w, 1080);
  assert.match(await bad(`@0\ntext t "x" frame=fill\n`), /no setting "frame"/);
});

test("the camera frames a place inside a picture and never shows past the picture's edges", async () => {
  const s = await ok(`@0\nimage p asset=photo w=1080 h=1920 frame=fill\n@2 keep\ncamera p at=0.8,0.8,1,1 frames=10\n`, pics);
  const cam = at(s, 60, "camera")!;
  const zoom = cam.props.scaleX as number;
  assert.ok(zoom > 3, String(zoom));
  const right = (cam.props.x as number) + 1080 * zoom;
  const bottom = (cam.props.y as number) + 1920 * zoom;
  assert.ok(right >= 1080 - 0.5 && bottom >= 1920 - 0.5, `${right} ${bottom}`);
  // A plain state with no camera of its own goes back to rest.
  const back = await ok(`@0\nimage p asset=photo w=1080 h=1920 frame=fill\ncamera p zoom=2\n@4\ntext t "next"\n`, pics);
  assert.equal(at(back, 200, "camera")!.props.scaleX, 1);
  const drift = await ok(`@0\nimage p asset=photo frame=fill\ncamera zoom=1.1 drift=0.05\n`, pics);
  assert.ok((at(drift, 600, "camera")!.props.scaleX as number) > (at(drift, 30, "camera")!.props.scaleX as number));
});

test("marks and tags at a place inside a picture belong to it, and words on a picture sit on a card", async () => {
  const s = await ok(`@0\nimage p asset=photo w=1000 h=1000 frame=fill\nmark ring p at=0.2,0.2,0.4,0.4\nmark dots p at=0.1,0.1,0.5,0.5,0.9,0.9\nmark arrow p at=0.1,0.9,0.5,0.5\ntag p "here" at=0.5,0.5\n`, pics);
  const kids = at(s, 60, "p")!.children.map((c) => c.id);
  for (const id of ["mark.ring.p.l3", "mark.dots.p.l4", "mark.dots.p.l4.2", "mark.dots.p.l4.3", "mark.arrow.p.l5.head", "tag.p.l6", "tag.p.l6.back"]) assert.ok(kids.includes(id), `${id} in ${kids}`);
  assert.match(await bad(`@0\nimage p asset=photo\nmark line p\n`, pics), /needs at=/);
  assert.match(await bad(`@0\nimage p asset=photo\nmark ring p at=0.2,3\n`, pics), /at= is/);
});

test("a cut changes everything on its frame, and nothing shows before its moment", async () => {
  const s = await ok(`@0\nimage a asset=photo frame=fill\n@4 cut\nimage b asset=other frame=fill\n`, pics);
  const f = 4 * 15;
  assert.equal(at(s, f - 2, "b")!.props.opacity, 0);
  assert.equal(at(s, f, "b")!.props.opacity, 1);
  assert.equal(at(s, f, "a")!.props.opacity, 0);
  const none = await ok(`@0\ntext a "first"\n@4 keep enter=none\ntext b "later"\n`);
  assert.equal(at(none, 10, "b")!.props.opacity, 0);
});

test("things can arrive their own way: slide, rise, slam, and an arrangement on a panel arrives as one", async () => {
  const s = await ok(`@0\nbox a "x" enter=slide\nstack c back=paper enter=rise\n  text t "card"\n`);
  assert.ok((at(s, 1, "a")!.props.x as number) > 1080);
  assert.ok(Math.abs((at(s, 200, "a")!.props.x as number) - (at(s, 300, "a")!.props.x as number)) < 1);
  assert.ok((at(s, 1, "c.back")!.props.y as number) > (at(s, 200, "c.back")!.props.y as number) + 500);
  const slam = await ok(`@0\nhuge l enter=slam: w=BIG\n`);
  assert.ok((at(slam, 1, "w")!.props.scaleX as number) > 1.5);
  assert.ok(Math.abs((at(slam, 120, "w")!.props.scaleX as number) - 1) < 0.02);
});

test("an arrow from a thing to itself turns around it", async () => {
  const s = await ok(`@0\ncircle m "moon"\narrow m -> m "spin"\n`);
  const pts = at(s, 60, "arrow.m.m")!.props.points as number[];
  assert.ok(Math.max(...pts.filter((_, i) => i % 2 === 0)) > (at(s, 60, "m")!.props.x as number) + 50);
});
