import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Props, StyleSpec } from "../core/types.ts";
import { circle } from "../kits/shapes.ts";
import { styleNames, themeFrom } from "../render/theme.ts";
import { apart, blend, contrast } from "./color.ts";
import { FEELS, FILLS, PENS, resolveStyle, STYLE_GUIDE, SURFACES } from "./format.ts";
import { hatchPath, outline, type Pt, slice, toPolyline, wobble } from "./geometry.ts";
import { paintPath, paintSurface, paintText } from "./paint.ts";

const palette = { paper: "#ffffff", ink: "#000000", accent: "#cc0000", highlight: "#ffff00" };
const spec = (render: Record<string, unknown>): StyleSpec => resolveStyle({ palette, render });
const all = styleNames().map((name) => ({ name, theme: themeFrom(name), file: JSON.parse(readFileSync(`styles/${name}.json`, "utf8")) }));
const edge: Props = { points: [0, 0, 400, 100], stroke: "#000000", strokeWidth: 7, drawn: 1 };
const node: Props = { points: circle(0, 0, 60), closed: 1, stroke: "#000000", strokeWidth: 7, fill: "#cc0000", drawn: 1 };

test("every style file is valid and still has what the pipeline reads", () => {
  assert.ok(all.length >= 7);
  for (const { name, file, theme } of all) {
    assert.equal(file.name, name);
    for (const key of ["label", "palette", "fonts", "art", "realAssets", "voice"]) assert.ok(file[key], `${name} needs ${key}`);
    for (const key of ["scene", "object", "diagram"]) assert.ok(file.art[key], `${name} needs art.${key}`);
    assert.equal(typeof file.grain, "number");
    assert.equal(typeof file.vignette, "number");
    assert.ok(file.motion === undefined || ["cuts", "board"].includes(file.motion), "motion is the pipeline's field");
    assert.ok(theme.style && theme.colors.ink && theme.moveFrames > 0);
  }
});

test("a style changes the drawing, not just its colors", () => {
  const shape = (theme: (typeof all)[number]["theme"]) => {
    const flat = paintPath({ ...node, stroke: "#000000", fill: "#cc0000" }, "n", theme.style!, "#ffffff", "#cc0000").map((l) => ({ ...l, fill: l.fill && "c", stroke: l.stroke && "c" }));
    return JSON.stringify(flat);
  };
  const seen = new Set(all.map((s) => shape(s.theme)));
  assert.equal(seen.size, all.length, "two styles drew the same geometry with the same layers");
  const looks = new Set(all.map((s) => JSON.stringify([s.theme.style!.line.pen, s.theme.style!.fill.kind, s.theme.style!.surface.kind, s.theme.fonts.body, s.theme.ease, s.theme.moveFrames])));
  assert.equal(looks.size, all.length);
});

test("hand-drawn lines stay still: the same input gives the same line, and it only depends on the object", () => {
  for (const { theme } of all) {
    const a = JSON.stringify(paintPath(node, "g.node.A", theme.style!, "#ffffff", "#cc0000"));
    paintPath(edge, "other", theme.style!, "#ffffff", "#cc0000");
    assert.equal(JSON.stringify(paintPath(node, "g.node.A", theme.style!, "#ffffff", "#cc0000")), a);
    // Things that change every frame during a move must not disturb the line itself.
    assert.equal(JSON.stringify(paintPath({ ...node, x: 300, y: 40, scaleX: 1.2, opacity: 0.5 }, "g.node.A", theme.style!, "#ffffff", "#cc0000")), a);
  }
  const ink = spec({ line: { pen: "ink" } });
  assert.notEqual(JSON.stringify(paintPath(node, "a", ink, "#ffffff", "#000000")), JSON.stringify(paintPath(node, "b", ink, "#ffffff", "#000000")), "objects differ from each other");
});

test("no clock or unseeded randomness in the style code", () => {
  for (const f of ["noise.ts", "geometry.ts", "paint.ts", "draw.tsx", "format.ts", "color.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /Math\.random|Date\.now|performance\.now|useState|useEffect/, f);
  }
});

test("a wobbly line grows without changing the part already drawn", () => {
  const whole = wobble(toPolyline([0, 0, 1001, 0], false, false, 7), false, 3, 42);
  const part = slice(whole, 0, 0.5);
  assert.deepEqual(part.slice(0, 40), whole.slice(0, 40));
  const longer = wobble(toPolyline([0, 0, 1400, 0], false, false, 7), false, 3, 42);
  assert.deepEqual(longer.slice(10, 80), whole.slice(10, 80), "lengthening a line does not change it");
});

test("wobble keeps open ends attached and closes closed shapes", () => {
  const open = wobble(toPolyline([0, 0, 500, 0], false, false, 7), false, 5, 9);
  assert.deepEqual(open[0], [0, 0]);
  assert.deepEqual(open.at(-1), [500, 0]);
  assert.ok(open.some(([, y]) => Math.abs(y) > 1), "and it does wobble");
  const ring = wobble(toPolyline(circle(0, 0, 80), false, true, 7), true, 5, 9);
  assert.ok(Math.hypot(ring[0]![0] - ring.at(-1)![0], ring[0]![1] - ring.at(-1)![1]) < 0.01);
});

test("a pen with pressure changes width along the line", () => {
  const p = toPolyline([0, 0, 300, 0], false, false, 7);
  const d = outline(p, false, (s) => 2 + s / 50);
  assert.match(d, /^M.*Z$/);
  assert.notEqual(d, outline(p, false, () => 2));
});

test("hatching stays inside the shape", () => {
  const square: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  const d = hatchPath(square, 12, 45, 3);
  const nums = [...d.matchAll(/-?\d+\.?\d*/g)].map((m) => Number(m[0]));
  assert.ok(nums.length > 20);
  for (const v of nums) assert.ok(v >= -3 && v <= 103, `${v} left the square`);
});

test("drawn amount hides what is not drawn yet", () => {
  for (const { theme } of all) {
    const empty = paintPath({ ...edge, drawn: 0 }, "e", theme.style!, "#ffffff", "#000000");
    assert.equal(empty.length, 0);
    const half = paintPath({ ...edge, drawn: 0.5 }, "e", theme.style!, "#ffffff", "#000000");
    assert.ok(half.length > 0);
  }
});

test("a shape in the surface's own color gets no material, and a color change fades it in smoothly", () => {
  const s = spec({ fill: { kind: "hatch" } });
  const plain = paintPath({ ...node, fill: "#ffffff" }, "n", s, "#ffffff", "#000000");
  assert.equal(plain.filter((l) => l.stroke && l.d.includes("Q")).length, 0);
  const hatched = (fill: string) => paintPath({ ...node, fill }, "n", s, "#ffffff", "#000000").find((l) => l.d.includes("Q"));
  assert.ok(hatched("#f0e0e0")!.opacity < hatched("#cc0000")!.opacity);
  assert.equal(apart("#123456", "#123456"), 0);
});

test("words stay readable: the base under texture cannot fall too low, and paper-colored words read on colored shapes", () => {
  assert.throws(() => spec({ fill: { kind: "hatch", base: 0.2 } }), /outside/);
  for (const { name, theme } of all) {
    const { paper, accent, ink } = theme.colors as Record<string, string>;
    const under = blend(accent!, paper!, 1 - theme.style!.fill.base);
    assert.ok(contrast(paper!, under) >= 1.7, `${name}: words on a colored shape, ${contrast(paper!, under).toFixed(2)}`);
    assert.ok(contrast(ink!, paper!) >= 4.5, name);
    assert.ok(theme.style!.type.grain <= 0.1, `${name}: grain on words must stay light`);
  }
});

test("texture stays on the surface: a surface is the only full-frame paint, and it is faint", () => {
  for (const { name, theme } of all) {
    const s = paintSurface(theme.style!, theme.colors.paper!, theme);
    assert.ok((s.smudge?.opacity ?? 0) <= 0.05, `${name}: smudge`);
    assert.ok((s.grain?.opacity ?? 0) <= 0.15, `${name}: grain`);
  }
  const source = readFileSync(new URL("draw.tsx", import.meta.url), "utf8");
  assert.match(source, /<image href=\{String\(a\.src\)\} x=\{-n\(a\.w\) \/ 2\} y=\{-n\(a\.h\) \/ 2\} width=\{n\(a\.w\)\} height=\{n\(a\.h\)\} \/>/, "images are drawn with no filter, mask or blend");
  assert.ok(source.indexOf("<Surface style") < source.indexOf("evaluate(scene, frame).map"), "surface is below the objects");
  assert.equal(source.indexOf("evaluate(scene, frame).map"), source.lastIndexOf("evaluate(scene, frame).map"));
});

test("type: case, tracking, jitter and bold follow the style, and stay fixed for an object", () => {
  const theme = { colors: { ink: "#000000" }, fonts: { title: "T", body: "B", mono: "M" }, moveFrames: 9, ease: "out" as const };
  const s = spec({ type: { case: "upper", tracking: 0.1, jitter: 1, bold: 400 } });
  const t = paintText({ text: "Hi", size: 100, weight: 700 }, "a", theme, s, "#ffffff");
  assert.equal(t.text, "HI");
  assert.equal(t.spacing, 10);
  assert.equal(t.weight, 400);
  assert.equal(t.rotate!.split(" ").length, 2);
  assert.deepEqual(t, paintText({ text: "Hi", size: 100, weight: 700 }, "a", theme, s, "#ffffff"));
  assert.equal(paintText({ text: "x", font: "title" }, "a", theme, s, "#ffffff").family, "T");
  assert.equal(paintText({ text: "x", font: "mono" }, "a", theme, s, "#ffffff").family, "M");
});

test("the format is small: a few words make a whole style, and every preset works", () => {
  const s = spec({ line: { pen: "chalk" }, surface: { kind: "slate" } });
  assert.equal(s.line.grain, PENS.chalk.grain);
  assert.equal(s.fill.kind, "solid");
  assert.equal(s.motion.feel, "steady");
  const example = JSON.parse(STYLE_GUIDE.slice(STYLE_GUIDE.lastIndexOf("\n{ ")));
  assert.equal(spec(example).line.passes, 2);
  for (const pen of Object.keys(PENS)) for (const kind of Object.keys(FILLS)) for (const surface of Object.keys(SURFACES)) for (const feel of Object.keys(FEELS)) {
    const style = spec({ line: { pen }, fill: { kind }, surface: { kind: surface }, motion: { feel } });
    assert.ok(paintPath(node, "n", style, "#ffffff", "#000000").length > 0);
    assert.doesNotMatch(JSON.stringify(paintPath(node, "n", style, "#ffffff", "#000000")), /NaN|undefined/);
  }
});

test("a mistake in a style fails loudly and says what is wrong", () => {
  assert.throws(() => spec({ line: { pen: "crayon" } }), /line\.pen.*vector/);
  assert.throws(() => spec({ line: { wibble: 2 } }), /line\.wibble: unknown setting/);
  assert.throws(() => spec({ line: { wobble: 500 } }), /wobble.*outside/);
  assert.throws(() => spec({ fill: { kind: "paper" } }), /fill\.kind/);
  assert.throws(() => spec({ overlay: {} }), /render key/);
  assert.throws(() => spec({ motion: { ease: "wobbly" } }), /motion\.ease/);
  assert.throws(() => resolveStyle({ palette: { ...palette, ink: "#eeeeee" } }), /ink on paper/);
  assert.throws(() => resolveStyle({ palette: { ...palette, ink: "black" } }), /hex/);
  assert.throws(() => resolveStyle({ palette: { paper: "#ffffff" } }), /needs ink/);
});

test("older files with only `hand` keep working", () => {
  const s = resolveStyle({ palette, hand: { wobble: 2.5, weight: 1.3 } });
  assert.equal(s.line.pen, "vector");
  assert.equal(s.line.wobble, 2.5);
  assert.equal(s.line.weight, 1.3);
});

test("see-through colors keep their alpha: blending keeps it, and distance from the surface is judged by what shows", () => {
  const board = "#2f3b36";
  // A clear, nearly white liquid over a dark board is a faint film, not a strong mark, and never black.
  const clear = "#eaf2f566";
  assert.ok(apart(clear, "#c0c8ca") < 0.6 * apart("#eaf2f5", "#c0c8ca"));
  assert.ok(apart(clear, board) > 0.3 && apart(clear, "#c0c8ca") > 0);
  assert.match(blend(clear, board, 0.2), /^#[0-9a-f]{8}$/);
  assert.notEqual(blend(clear, board, 0.2), clear);
  assert.equal(blend("#000000", "#ffffff", 0.5), "#808080");
  const layers = paintPath({ ...node, stroke: "none", fill: clear }, "n", spec({ fill: { kind: "scribble", base: 0.8 } }), board, "#000000");
  for (const l of layers) for (const c of [l.fill, l.stroke]) if (c) assert.ok(c !== "#000000" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c), `${c} is a color the renderer reads`);
});

test("the dry tooth is a seamless tile of fixed pixels, the same in every render, and more grain takes out more", async () => {
  const { TILE, toothPixels, toothTile, grayPng } = await import("./texture.ts");
  const a = toothPixels(0.7);
  assert.deepEqual(a, toothPixels(0.7));
  assert.equal(a.length, TILE * TILE);
  const kept = (p: Uint8Array) => p.reduce((s, v) => s + v, 0) / p.length / 255;
  assert.ok(kept(toothPixels(1)) < kept(toothPixels(0)), "more grain keeps less of the stroke");
  assert.ok(kept(a) > 0.2 && kept(a) < 0.9, `a chalk stroke keeps much of itself, with specks out (${kept(a).toFixed(2)})`);
  // Seamless: the step across the tile's edge is no bigger than the steps inside it.
  const step = (x0: number, x1: number) => {
    let s = 0;
    for (let y = 0; y < TILE; y++) s += Math.abs(a[y * TILE + x0]! - a[y * TILE + x1]!);
    return s / TILE;
  };
  let inside = 0;
  for (let x = 0; x < TILE - 1; x++) inside = Math.max(inside, step(x, x + 1));
  assert.ok(step(TILE - 1, 0) <= inside, "no seam where tiles meet");
  assert.deepEqual([...grayPng(a, TILE, TILE).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(toothTile(0.7), /^data:image\/png;base64,/);
  assert.equal(toothTile(0.7), toothTile(0.7));
});
