// Rendering power: evaluation speed and blending here, then real markup from SceneView. Node cannot load JSX, so the
// view is bundled for the test. Whether a browser then paints it is checked by looking at engine/proof/rendering.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blendOf, bounds, filterOf, gradientGeometry, inverse, matrixOf, safeId, themed, times, tintMatrix } from "../render/effects.ts";
import { SHADERS, wrapShader } from "../render/shaders.ts";
import { box, circle } from "../kits/shapes.ts";
import { compile } from "./compile.ts";
import { evaluate, mix, parseGradient, sample } from "./evaluate.ts";
import type { CompileContext, Key, NodeSpec, Props, Resolved, Scene, SceneDoc, Theme } from "./types.ts";

const theme: Theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#00ff00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" };
const ctx: CompileContext = { fps: 30, width: 1000, height: 1000, frames: 300, theme };
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const close = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
const shape = box(0, 0, 100, 100);

let SceneView: React.FC<{ scene: Scene; theme: Theme; frame: number }>;
const dir = mkdtempSync(join(tmpdir(), "engine-view-"));
before(async () => {
  const outfile = join(dir, "view.mjs");
  await build({ entryPoints: ["engine/render/SceneView.tsx"], bundle: true, format: "esm", platform: "node", packages: "external", outfile, logLevel: "error", absWorkingDir: process.cwd(), jsx: "automatic" });
  // The bundle lives outside the repo, so it is rewritten to find react from here.
  const { readFileSync, writeFileSync } = await import("node:fs");
  const fix = (s: string) => s.replace(/from "(react(?:\/jsx-runtime)?)"/g, (_, m: string) => `from "${import.meta.resolve(m)}"`);
  writeFileSync(outfile, fix(readFileSync(outfile, "utf8")));
  ({ SceneView } = await import(pathToFileURL(outfile).href));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const draw = (doc: SceneDoc | NodeSpec[], frame = 0, useTheme = theme) => {
  const scene = compile(Array.isArray(doc) ? { steps: [{ at: 0, enter: "none", add: doc }] } : doc, ctx);
  return renderToStaticMarkup(React.createElement(SceneView, { scene, theme: useTheme, frame }));
};
const path = (id: string, props: Props = {}, parent?: string): NodeSpec => ({ id, kind: "path", parent, props: { points: shape, closed: 1, fill: "ink", ...props } });

test("track lookup gives the same answers as walking every key", () => {
  const keys: Key[] = [{ at: 0, value: 0 }, { at: 10, value: 5, ease: "linear" }, { at: 10, value: 7, ease: "linear" }, { at: 30, value: 7 }, { at: 50, value: 20, ease: "linear" }];
  assert.equal(sample(keys, -4), 0);
  assert.equal(sample(keys, 5), 2.5);
  assert.equal(sample(keys, 10), 7);
  assert.equal(sample(keys, 20), 7);
  assert.equal(sample(keys, 40), 13.5);
  assert.equal(sample(keys, 50), 20);
  assert.equal(sample(keys, 999), 20);
});

test("overlapping behaviors with keys out of time order still evaluate in time order", () => {
  const scene: Scene = { fps: 30, width: 10, height: 10, frames: 100, background: "#fff", events: [], nodes: [{ id: "a", kind: "group", props: {} }], tracks: [{ target: "a", prop: "x", keys: [{ at: 0, value: 0 }, { at: 40, value: 40, ease: "linear" }, { at: 20, value: 20, ease: "linear" }] }] };
  assert.equal(evaluate(scene, 30)[0]!.props.x, 30);
});

test("5,000 moving parts evaluate quickly, and more keys do not slow a frame", () => {
  const add: NodeSpec[] = [{ id: "all", kind: "group" }];
  for (let i = 0; i < 5000; i++) add.push(path(`p.${i}`, { x: i }, "all"));
  const steps: SceneDoc["steps"] = [{ at: 0, enter: "none", add }];
  for (let k = 1; k < 30; k++) steps.push({ at: k * 12, set: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`p.${i}`, { x: i + k, fill: k % 2 ? "accent" : "ink" }])) });
  const scene = compile({ steps }, { ...ctx, frames: 600 });
  evaluate(scene, 1);
  const run = (frame: number) => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) evaluate(scene, frame + i * 0.03);
    return (performance.now() - t) / 20;
  };
  run(20);
  const ms = Math.min(run(20), run(330));
  assert.ok(ms < 100, `${ms.toFixed(1)} ms a frame`);
});

test("lists of any length blend, including odd ones and crops", () => {
  assert.deepEqual(mix([10, 20, 30], [20, 40, 60], 0.5), [15, 30, 45]);
  assert.deepEqual(mix([0, 0, 1, 1], [0.5, 0.5, 0.5, 0.5], 0.5), [0.25, 0.25, 0.75, 0.75]);
  assert.deepEqual(mix([1, 2, 3], [1, 2], 0.5), [1, 2, 3]);
});

test("colors blend with alpha, and to and from nothing", () => {
  assert.equal(mix("#ff000080", "#ff000000", 0.5), "#ff000040");
  assert.equal(mix("none", "#ff0000", 0.5), "#ff000080");
  assert.equal(mix("#ff0000", "transparent", 1), "#ff000000");
});

test("gradients parse, and fail loudly when written wrong", () => {
  const g = parseGradient("linear(90, ink, accent 0.25, paper)")!;
  assert.deepEqual(g.args, [90]);
  assert.deepEqual(g.stops.map((s) => s.at), [0, 0.25, 1]);
  assert.deepEqual(parseGradient("radial(ink, paper)")!.args, [0.5, 0.5, 0.5]);
  assert.equal(parseGradient("#ff0000"), undefined);
  assert.throws(() => parseGradient("linear(90, ink)"), /bad gradient/);
  assert.throws(() => parseGradient("radial(1, 2, ink, paper)"), /bad gradient/);
  assert.throws(() => parseGradient("linear(ink high, paper)"), /bad gradient stop/);
});

test("any gradient blends into any other, and into a plain color", () => {
  const a = "linear(0, #000000 0, #ffffff 1)";
  const b = "linear(90, #ff0000 0, #ff0000 0.5, #0000ff 1)";
  const m = parseGradient(mix(a, b, 0.5) as string)!;
  assert.equal(m.args[0], 45);
  assert.deepEqual(m.stops.map((s) => s.at), [0, 0.5, 1]);
  assert.equal(m.stops[0]!.color, "#800000");
  assert.deepEqual(parseGradient(mix("#ff0000", a, 1) as string)!.stops.map((s) => s.color), ["#000000", "#ffffff"]);
  assert.equal(mix(a, "radial(#000000, #ffffff)", 0.5), a);
});

test("captions are never mistaken for gradients", () => {
  assert.equal(mix("linear(x)", "linear(y)", 0.5), "linear(x)");
  assert.equal(mix("Step 1", "Step 2", 0.5), "Step 1");
});

test("a property the node never set starts from rest instead of jumping", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [path("a"), path("b", { blur: 5 })] }, { at: 30, set: { a: { blur: 10, saturation: 0, shadowBlur: 8 }, b: { blur: 25 } } }, { at: 60, set: { a: { blur: 0 } } }] }, ctx);
  const at = (f: number, id = "a") => find(evaluate(scene, f), id)!.props;
  assert.equal(at(0).blur, 0);
  assert.equal(at(29).saturation, 1);
  assert.equal(at(35).blur, 5);
  assert.equal(at(35).saturation, 0.5);
  assert.equal(at(50).blur, 10);
  assert.equal(at(65).blur, 5);
  assert.equal(at(0, "b").blur, 5);
});

test("frames stay pure with effects and shaders in the scene", () => {
  const doc: SceneDoc = { steps: [{ at: 0, add: [path("a", { fill: "linear(0, ink, accent)", glow: 4 }), { id: "s", kind: "image", props: { w: 10, h: 10, shader: "cloud", params: [1, 2, 3] } }] }, { at: 20, set: { a: { fill: "linear(90, paper, ink)", blur: 3 }, s: { params: [3, 2, 1] } } }] };
  const scene = compile(doc, ctx);
  const a = JSON.stringify(evaluate(scene, 25));
  evaluate(scene, 200);
  evaluate(scene, 3);
  assert.equal(JSON.stringify(evaluate(scene, 25)), a);
  assert.equal(draw(doc, 25), draw(doc, 25));
});

test("a bad parent or track target fails loudly", () => {
  const base: Scene = { fps: 30, width: 10, height: 10, frames: 10, background: "#fff", events: [], tracks: [], nodes: [{ id: "a", kind: "group", parent: "gone", props: {} }] };
  assert.throws(() => evaluate(base, 0), /nothing called gone/);
  assert.throws(() => evaluate({ ...base, nodes: [{ id: "a", kind: "group", props: {} }], tracks: [{ target: "b", prop: "x", keys: [{ at: 0, value: 1 }] }] }, 0), /nothing called b/);
});

test("filters: at rest there are none, and each effect joins the chain", () => {
  assert.equal(filterOf({ blur: 0, brightness: 1, saturation: 1, contrast: 1, hue: 0, glow: 0 }, theme), undefined);
  const f = filterOf({ blur: 4, brightness: 1.2, saturation: 0.5, contrast: 2, hue: 30, shadowY: 6, shadowBlur: 9, shadowColor: "#123456", shadowOpacity: 0.5, glow: 10, glowColor: "#00ff00" }, theme)!;
  for (const piece of ["blur(4px)", "brightness(1.2)", "saturate(0.5)", "contrast(2)", "hue-rotate(30deg)", "drop-shadow(0px 6px 9px color-mix(in srgb, #123456 50%, transparent))", "drop-shadow(0 0 10px #00ff00)"]) assert.ok(f.includes(piece), piece);
  assert.equal(filterOf({ shadowY: 6, shadowOpacity: 0 }, theme), undefined);
  assert.ok(filterOf({ saturation: 0 }, theme, "tint")!.indexOf("saturate") < filterOf({ saturation: 0 }, theme, "tint")!.indexOf("url(#tint)"));
});

test("tint keeps light and dark, and needs a real color", () => {
  assert.equal(tintMatrix("#ff0000", 0), undefined);
  const v = tintMatrix("#ff0000", 1)!.split(" ").map(Number);
  assert.equal(v.length, 20);
  close(v[0]! + v[1]! + v[2]!, 1); // white stays at full red
  close(v[5]! + v[6]! + v[7]!, 0); // and loses its green
  assert.equal(v[18], 1); // alpha is untouched
  assert.throws(() => tintMatrix("red", 1), /tint needs/);
});

test("gradients on a straight line use real coordinates, so they still draw", () => {
  const g = gradientGeometry(parseGradient("linear(0, #000000, #ffffff)")!, bounds([0, 50, 200, 50]));
  assert.deepEqual([g.gradientUnits, g.x1, g.x2, g.y1, g.y2], ["userSpaceOnUse", 0, 200, 50, 50]);
  const r = gradientGeometry(parseGradient("radial(0.5, 0, 0.5, #000000, #ffffff)")!, { x: 0, y: 0, w: 100, h: 40 });
  assert.deepEqual([r.cx, r.cy, r.r], [50, 0, 50]);
  assert.equal(gradientGeometry(parseGradient("linear(0, #000000, #ffffff)")!).gradientUnits, "objectBoundingBox");
});

test("transforms invert exactly, and match the order SVG applies them", () => {
  const m = matrixOf({ x: 30, y: -20, rotate: 33, skew: 12, scaleX: 2, scaleY: 0.5 });
  times(inverse(m), m).forEach((v, i) => close(v, [1, 0, 0, 1, 0, 0][i]!));
  const q = matrixOf({ x: 10, y: 0, rotate: 90, scaleX: 2 });
  close(q[0] * 1 + q[2] * 0 + q[4], 10); // (1, 0) doubles, turns to point down, then moves
  close(q[1] * 1 + q[3] * 0 + q[5], 2);
});

test("ids with any characters are made safe", () => {
  assert.match(safeId("g.edge.A B(1)"), /^[a-zA-Z0-9_-]+$/);
  assert.notEqual(safeId("a.b"), safeId("a_b"));
  assert.equal(blendOf({ blend: "screen" }), "screen");
  assert.throws(() => blendOf({ blend: "sparkle" }), /unknown blend/);
});

test("theme names work in every color property and inside gradients, in tracks too", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [path("a", { shadowColor: "accent", glowColor: "highlight", tint: "ink", fill: "radial(ink, paper)" })] }, { at: 10, set: { a: { shadowColor: "ink", fill: "linear(0, accent, highlight)" } } }] }, ctx);
  const done = themed(scene, theme);
  assert.equal(themed(scene, theme), done);
  const p = find(evaluate(done, 0), "a")!.props;
  assert.deepEqual([p.shadowColor, p.glowColor, p.tint], ["#ff0000", "#00ff00", "#111111"]);
  assert.equal(parseGradient(p.fill)!.stops[0]!.color, "#111111");
  assert.equal(find(evaluate(done, 15), "a")!.props.shadowColor, "#880909");
  assert.throws(() => themed(compile({ steps: [{ at: 0, add: [path("b", { fill: "linear(0, nosuch, paper)" })] }] }, ctx), theme), /unknown color nosuch/);
});

test("a plain part is a single element, and one with children or paint gets a group", () => {
  const html = draw([path("a")]);
  assert.ok(!html.includes("<g"));
  assert.match(html, /<path transform="translate\(0 0\)|<path [^>]*transform="translate\(0 0\)/);
  assert.match(draw([path("a"), path("b", {}, "a")]), /<g transform/);
  assert.match(draw([path("a", { fill: "linear(0, ink, paper)" })]), /<g transform/);
  assert.ok(!html.includes("<defs"));
  assert.ok(!html.includes("filter"));
});

test("gradient paints define a gradient the part points at", () => {
  const html = draw([path("a", { fill: "linear(0, ink, accent)", stroke: "radial(paper, ink)" }), { id: "t", kind: "text", props: { text: "hi", color: "linear(0, accent, ink)" } }]);
  assert.match(html, /<linearGradient id="([^"]+)-f"[^>]*userSpaceOnUse/);
  assert.match(html, /<radialGradient id="[^"]+-s"/);
  assert.match(html, /fill="url\(#[^"]+-f\)"/);
  assert.match(html, /stop-color="#ff0000"/);
  assert.match(html, /<linearGradient id="[^"]+t-f"[^>]*objectBoundingBox/);
});

test("effects land on an element outside the transform, so shadows keep their direction", () => {
  const html = draw([path("a", { x: 5, rotate: 40, blur: 3 })]);
  assert.match(html, /<g opacity="1" style="filter:blur\(3px\)"><g transform="translate\(5 0\) rotate\(40\)/);
});

test("blend modes and isolation", () => {
  assert.match(draw([path("a", { blend: "multiply" })]), /mix-blend-mode:multiply/);
  assert.match(draw([{ id: "g", kind: "group", props: { isolate: 1 } }]), /isolation:isolate/);
  assert.throws(() => draw([path("a", { blend: "sparkle" })]), /unknown blend/);
});

test("a clip travels with the part, and goes soft with feather", () => {
  assert.match(draw([path("a", { clip: circle(0, 0, 40) })]), /<clipPath id="[^"]+-c"><path d="M40 0/);
  const soft = draw([path("a", { clip: box(0, 0, 10, 10), feather: 4 })]);
  assert.match(soft, /<mask id="[^"]+-c" maskUnits="userSpaceOnUse" x="-12" y="-12" width="34" height="34"/);
  assert.match(soft, /filter:blur\(4px\)/);
});

test("a matte is drawn only as a matte, and sits where it really is on screen", () => {
  const html = draw([
    { id: "left", kind: "group", props: { x: 100 } },
    { id: "right", kind: "group", props: { x: 400, y: 50 } },
    path("shape", { mask: "cutter" }, "left"),
    path("cutter", { fill: "highlight" }, "right"),
  ]);
  assert.equal(html.match(/<mask/g)!.length, 1);
  assert.match(html, /mask-type:alpha/);
  assert.match(html, /<g transform="matrix\(1 0 0 1 300 50\)">/); // from left's coordinates to right's
  assert.equal(html.match(/fill="#00ff00"/g)!.length, 1); // the cutter, inside the mask and nowhere else
  assert.ok(html.indexOf('fill="#00ff00"') < html.indexOf("</mask>"));
});

test("mattes can be luminance or inverted, and bad ones fail loudly", () => {
  const cut = path("cutter");
  assert.match(draw([path("a", { mask: "cutter", maskMode: "luminance" }), cut]), /mask-type:luminance/);
  assert.match(draw([path("a", { mask: "cutter", maskInvert: 1 }), cut]), /filter:brightness\(0\)/);
  assert.match(draw([path("a", { mask: "cutter", maskInvert: 1, maskMode: "luminance" }), cut]), /filter:invert\(1\)/);
  assert.throws(() => draw([path("a", { mask: "gone" })]), /nothing called gone/);
  assert.throws(() => draw([path("a", { mask: "cutter", maskMode: "soft" }), cut]), /unknown maskMode/);
  assert.throws(() => draw([path("a", { mask: "b" }), path("b", { mask: "a" })]), /mask loop/);
});

test("dashes, caps, joins and trimming", () => {
  const html = draw([path("a", { stroke: "ink", dash: [10, 4, 2], dashOffset: 3, lineCap: "butt", lineJoin: "miter", strokeOpacity: 0.5 })]);
  for (const piece of ['stroke-dasharray="10 4 2"', 'stroke-dashoffset="3"', 'stroke-linecap="butt"', 'stroke-linejoin="miter"', 'stroke-opacity="0.5"']) assert.ok(html.includes(piece), piece);
  const trim = draw([path("a", { stroke: "ink", trimStart: 0.25, trimEnd: 0.75 })]);
  assert.match(trim, /stroke-dasharray="0.5 2"/);
  assert.match(trim, /stroke-dashoffset="-0.25"/);
  assert.match(trim, /pathLength="1"/);
});

test("a dashed line can still draw itself on, and an undrawn line leaves no dot", () => {
  const both = draw([path("a", { stroke: "ink", dash: [10, 4], drawn: 0.5 })]);
  assert.match(both, /<mask[^>]*>.*stroke-dasharray="0.5 2".*<\/mask>/);
  assert.match(both, /stroke-dasharray="10 4"/);
  assert.match(draw([path("a", { stroke: "ink", drawn: 0, fill: "none" })]), /stroke="none"/);
});

test("raw path data allows holes", () => {
  const html = draw([{ id: "a", kind: "path", props: { d: "M0 0H9V9H0Z M3 3H6V6H3Z", fill: "ink", fillRule: "evenodd" } }]);
  assert.match(html, /d="M0 0H9V9H0Z M3 3H6V6H3Z"/);
  assert.match(html, /fill-rule="evenodd"/);
  assert.throws(() => draw([{ id: "b", kind: "path", props: {} }]), /needs points or d/);
});

test("images crop as a moving window, keep their true shape, and fit", () => {
  const html = draw([{ id: "a", kind: "image", props: { src: "x.png", w: 400, h: 200, srcW: 1000, srcH: 500, crop: [0.1, 0.2, 0.5, 0.5], fit: "cover" } }]);
  assert.match(html, /<svg x="-200" y="-100" width="400" height="200" viewBox="100 100 500 250" preserveAspectRatio="xMidYMid slice">/);
  assert.match(html, /<image href="x.png" width="1000" height="500" preserveAspectRatio="none"/);
  assert.match(draw([{ id: "a", kind: "image", props: { src: "x.png", w: 4, h: 2, fit: "fill" } }]), /preserveAspectRatio="none"/);
  assert.throws(() => draw([{ id: "a", kind: "image", props: { src: "x.png", crop: [0, 0, 1] } }]), /crop on a/);
  assert.throws(() => draw([{ id: "a", kind: "image", props: { w: 4, h: 4 } }]), /needs a src or a shader/);
});

test("image filters apply to images, and to anything else", () => {
  const html = draw([{ id: "a", kind: "image", props: { src: "x.png", w: 4, h: 4, brightness: 1.5, saturation: 0.2, tint: "accent", tintAmount: 0.5 } }]);
  assert.match(html, /brightness\(1.5\) saturate\(0.2\) url\(#[^)]+-k\)/);
  assert.match(html, /<filter id="[^"]+-k"[^>]*><feColorMatrix type="matrix" values="/);
  assert.match(draw([{ id: "t", kind: "text", props: { text: "hi", tint: "accent" } }]), /feColorMatrix/);
});

test("z orders siblings whatever order they were added in", () => {
  const order = (html: string) => [...html.matchAll(/translate\((\d+) 0\)/g)].map((m) => m[1]);
  assert.deepEqual(order(draw([path("a", { x: 1, z: 3 }), path("b", { x: 2, z: 1 }), path("c", { x: 3 })])), ["3", "2", "1"]);
  const scene: SceneDoc = { steps: [{ at: 0, enter: "none", add: [path("a", { x: 1, z: 1 }), path("b", { x: 2, z: 2 })] }, { at: 10, set: { a: { z: 5 } } }] };
  assert.deepEqual(order(draw(scene, 0)), ["1", "2"]);
  assert.deepEqual(order(draw(scene, 30)), ["2", "1"]);
});

test("layer lifts a part out of its group, above or below everything, and keeps its position", () => {
  const html = draw([
    { id: "group", kind: "group", props: { x: 7, opacity: 0.5, blur: 2 } },
    path("over", { fill: "#0000ff", layer: 1 }, "group"),
    path("under", { fill: "accent", layer: -1 }, "group"),
    path("top", { fill: "highlight" }),
  ]);
  const [under, top, over] = ['fill="#ff0000"', 'fill="#00ff00"', 'fill="#0000ff"'].map((s) => html.indexOf(s));
  assert.ok(under! < top! && top! < over!);
  assert.equal(html.match(/fill="#0000ff"/g)!.length, 1);
  assert.match(html, /<g transform="translate\(7 0\)[^"]*" opacity="0.5"><path/);
  assert.equal(html.match(/filter:blur/g)!.length, 1); // lifted parts step out of the group's effects
});

test("hidden parts draw nothing, images included (players keep pictures decoded themselves)", () => {
  assert.ok(!draw([path("a", { opacity: 0 })]).includes("<path"));
  assert.ok(!draw([{ id: "a", kind: "image", props: { src: "x.png", w: 4, h: 4, opacity: 0 } }]).includes("<image"));
});

test("text carries an outline and tracking", () => {
  const html = draw([{ id: "t", kind: "text", props: { text: "hi", stroke: "ink", strokeWidth: 4, tracking: 3 } }]);
  for (const piece of ['stroke="#111111"', 'stroke-width="4"', 'letter-spacing="3"', "paint-order"]) assert.ok(html.includes(piece), piece);
});

test("a gradient background works", () => {
  const scene: Scene = { ...compile({ steps: [] }, ctx), background: "linear(90, ink, accent)" };
  const html = renderToStaticMarkup(React.createElement(SceneView, { scene, theme, frame: 0 }));
  assert.match(html, /<linearGradient[^>]*background/);
  assert.match(html, /<rect width="1000" height="1000" fill="url\(#/);
});

test("shaders are data: named or inline, and they name no real colors and read no clock", () => {
  const html = draw([{ id: "s", kind: "image", props: { w: 100, h: 50, density: 0.5, shader: "cloud", opacity: 0.5, blend: "screen" } }]);
  assert.match(html, /<foreignObject x="-50" y="-25" width="100" height="50"><canvas width="50" height="25"/);
  assert.match(html, /mix-blend-mode:screen/);
  for (const source of Object.values(SHADERS)) {
    assert.ok(source.includes("vec4 shade(vec2 uv)"));
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(source));
  }
  assert.ok(wrapShader("vec4 shade(vec2 uv) { return vec4(1.0); }").includes("void main()"));
  assert.ok(!/Date|Math\.random|iTime|gl_FragCoord/.test(wrapShader(SHADERS.rays!)));
});

test("a typeset symbol takes the style's type treatment: the dry grain and the glow its words have", async () => {
  const { themeFrom } = await import("../render/theme.ts");
  const chalk = themeFrom("chalkboard");
  const neon = themeFrom("neon");
  const glyph = (t: Theme) => draw([{ id: "g", kind: "path", props: { glyph: 1, points: shape, closed: 1, fill: t.colors.accent! } }], 0, t);
  assert.match(glyph(chalk), /mask="url\(#sg-dry-text\)"/);
  // Neon words glow, so its symbols carry glow strokes around the fill too.
  assert.ok((glyph(neon).match(/<path/g) ?? []).length > 1);
  // With no style, a symbol is the plain fill it always was.
  assert.ok(!draw([{ id: "g", kind: "path", props: { glyph: 1, points: shape, closed: 1, fill: "ink" } }]).includes("sg-dry"));
});

test("a part added later with under= is drawn beneath the one it names, so a card never covers its own words", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "w", kind: "text", props: { text: "hi" } }, { id: "other", kind: "text", props: { text: "x" } }] }, { at: 5, enter: "none", add: [{ id: "w.back", kind: "path", under: "w", props: { points: shape, closed: 1, fill: "ink" } }] }] }, ctx);
  const order = scene.nodes.map((n) => n.id);
  assert.ok(order.indexOf("w.back") < order.indexOf("w"), order.join(","));
});

test("a drawn object keeps its hand-drawn look for its whole life under every style: only its intended changes animate", async () => {
  const { styleNames, themeFrom } = await import("../render/theme.ts");
  const D = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, skew: 0, opacity: 1, drawn: 1 };
  // A tube with a scale of short ticks, a faint filled body and a level inside, built the way a depicted object is:
  // within one moment it moves, grows, brightens from dimmed, turns a little, and its level falls.
  const nodes: Scene["nodes"] = [
    { id: "obj", kind: "group", props: { ...D, x: 300, y: 400, scaleX: 0.67, scaleY: 0.67 } },
    { id: "obj.glass", kind: "path", parent: "obj", props: { ...D, opacity: 0.06, points: shape, closed: 1, fill: "#f1eee3", stroke: "none" } },
    { id: "obj.level", kind: "path", parent: "obj", props: { ...D, y: 40, points: box(10, 10, 80, 50), closed: 1, fill: "#88aacc", stroke: "none" } },
    { id: "obj.outline", kind: "path", parent: "obj", props: { ...D, points: [0, 0, 0, 100, 100, 100, 100, 0], stroke: "#f1eee3", strokeWidth: 9, fill: "none" } },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `obj.tick.${i}`, kind: "path" as const, parent: "obj", props: { ...D, opacity: 0.85, points: [96, 10 + i * 12, 80, 10 + i * 12], stroke: "#f1eee3", strokeWidth: 2.7, fill: "none" } })),
  ];
  const ramp = (target: string, prop: string, a: number, b: number) => ({ target, prop, keys: [{ at: 0, value: a }, { at: 20, value: b, ease: "smooth" as const }] });
  const scene: Scene = { fps: 30, width: 1000, height: 1000, frames: 30, background: "#26332e", events: [], nodes, tracks: [ramp("obj", "opacity", 0.62, 1), ramp("obj", "x", 300, 340), ramp("obj", "scaleX", 0.67, 0.7), ramp("obj", "scaleY", 0.67, 0.7), ramp("obj", "rotate", 0, 3), ramp("obj.level", "y", 40, 55)] };
  const parts = (html: string) => [...html.matchAll(/<(path|text)\b[^>]*>/g)].map((m) => m[0].replace(/ (transform|opacity)="[^"]*"/g, ""));
  for (const name of styleNames()) {
    const t = themeFrom(name);
    const frames = [0, 7, 13, 20, 29].map((f) => renderToStaticMarkup(React.createElement(SceneView, { scene, theme: t, frame: f })));
    // The same strokes, specks and fills on every frame: only the transforms and fades the tracks ask for differ.
    for (const html of frames.slice(1)) assert.deepEqual(parts(html), parts(frames[0]!), `${name}: the object's drawing changed within the moment`);
    // No stroke carries its own turbulence filter, whose grain browsers resolve differently as a parent fades or turns.
    for (const html of frames) assert.ok(!/<(path|text)\b[^>]*filter="url\(#sg-dry/.test(html), `${name}: a stroke is textured by a filter`);
    if (t.style!.line.grain > 0) {
      assert.match(frames[0]!, /<path\b[^>]*mask="url\(#sg-dry\)"/, `${name}: its dry strokes are masked by the tooth`);
      assert.match(frames[0]!, /<pattern id="sg-dry-tile"[^>]*><image /, `${name}: the tooth is a tile of pixels`);
    }
  }
});
