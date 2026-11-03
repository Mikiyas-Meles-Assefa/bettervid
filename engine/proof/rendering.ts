// Proof of rendering power: silent vignettes from unrelated subjects, built only from the four primitives and theme
// names, each using effects a motion graphics tool would. The same scene renders in every style. `crowd` is a separate
// clip of 5,000 moving parts that measures real render speed.
// Usage: node --experimental-strip-types engine/proof/rendering.ts <outDir> <style> [<style> ...] [--crowd]
import { join, resolve } from "node:path";
import { bundled } from "../render/bundle.ts";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import type { NodeSpec, Props, SceneDoc, Step } from "../core/types.ts";
import { box, circle } from "../kits/shapes.ts";
import { themeFrom } from "../render/theme.ts";

const [W, H] = [1080, 1920];
const LENGTH = 96;
const FULL = box(0, 0, W, H);

// A made-up specimen, as an image file would arrive, so crops and color filters have real pixels to work on.
function specimen(): string {
  const cells = Array.from({ length: 150 }, (_, i) => {
    const [x, y] = [(Math.sin(i * 12.9898) * 0.5 + 0.5) * 1600, (Math.sin(i * 78.233) * 0.5 + 0.5) * 1000];
    const r = 34 + (Math.sin(i * 4.1) * 0.5 + 0.5) * 70;
    const hue = 90 + (i % 7) * 34;
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="hsl(${hue} 55% 62%)" fill-opacity=".75" stroke="hsl(${hue} 60% 28%)" stroke-width="5"/><circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(r / 3).toFixed(0)}" fill="hsl(${hue + 150} 60% 34%)"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#e9dcc4"/>${cells}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

type Piece = { add: NodeSpec[]; steps: Step[] };

// Each vignette is a group that fades in, plays and fades out.
function vignette(name: string, index: number, label: string, background: string, parts: (s: string, at: number) => Piece): Step[] {
  const start = 4 + index * LENGTH;
  const { add, steps } = parts(name, start);
  return [
    { at: start, enter: "fade", move: { frames: 10 }, add: [{ id: name, kind: "group" }] },
    { at: start, enter: "none", add: [
      { id: `${name}.back`, kind: "path", parent: name, props: { points: FULL, closed: 1, fill: background } },
      ...add,
      { id: `${name}.label`, kind: "text", parent: name, props: { x: W / 2, y: 1800, size: 42, text: label, color: "paper", stroke: "ink", strokeWidth: 5, tracking: 1, layer: 5 } },
    ] },
    ...steps,
    { at: start + LENGTH - 10, remove: [name], move: { frames: 10 } },
  ];
}

const eclipse = (s: string, at: number): Piece => ({
  add: [
    { id: `${s}.sky`, kind: "image", parent: s, props: { x: W / 2, y: H / 2, w: W, h: H, density: 0.5, shader: "stars", params: [46, 3, 0.12], colorA: "paper", colorB: "highlight", blend: "screen" } },
    { id: `${s}.rays`, kind: "image", parent: s, props: { x: W / 2, y: 820, w: 1600, h: 1600, density: 0.5, shader: "rays", params: [0.5, 0.5, 14, 0.7, 0.46], colorA: "highlight", blend: "screen", opacity: 0.2 } },
    { id: `${s}.sun`, kind: "path", parent: s, props: { x: W / 2, y: 820, points: circle(0, 0, 210), closed: 1, fill: "radial(0.5, 0.5, 0.5, highlight 0, accent 1)", glow: 30, glowColor: "highlight" } },
    { id: `${s}.moon`, kind: "path", parent: s, props: { x: 40, y: 700, points: circle(0, 0, 206), closed: 1, fill: "linear(45, ink, ink)" } },
  ],
  steps: [
    { at: at + 4, move: { frames: 74, ease: "linear" as const }, set: { [`${s}.moon`]: { x: W / 2, y: 820 }, [`${s}.sun`]: { glow: 120 }, [`${s}.rays`]: { opacity: 1 } } },
  ],
});

const route = (s: string, at: number): Piece => ({
  add: [
    { id: `${s}.land`, kind: "group", parent: s, props: { x: 60, y: 300 } },
    { id: `${s}.land.a`, kind: "path", parent: `${s}.land`, props: { points: [0, 120, 260, 40, 520, 110, 620, 320, 460, 520, 180, 470, 20, 330, 0, 120], smooth: 1, closed: 1, fill: "linear(90, accent, highlight)", shadowX: 14, shadowY: 22, shadowBlur: 20, shadowColor: "ink", shadowOpacity: 0.45 } },
    { id: `${s}.land.b`, kind: "path", parent: `${s}.land`, props: { x: 340, y: 760, points: [0, 90, 220, 0, 560, 70, 640, 320, 420, 480, 120, 420, 0, 90], smooth: 1, closed: 1, fill: "linear(120, highlight, accent)", shadowX: 14, shadowY: 22, shadowBlur: 20, shadowColor: "ink", shadowOpacity: 0.45 } },
    { id: `${s}.route`, kind: "path", parent: s, props: { points: [240, 560, 420, 760, 380, 980, 620, 1120, 800, 1360], smooth: 1, stroke: "linear(60, ink, paper)", strokeWidth: 12, dash: [2, 26], drawn: 0 } },
    { id: `${s}.ship`, kind: "path", parent: `${s}.land`, props: { x: 180, y: 260, points: circle(0, 0, 26), closed: 1, fill: "paper", stroke: "ink", strokeWidth: 8, layer: 2 } },
  ],
  steps: [
    { at: at + 10, move: { frames: 64, ease: "linear" as const }, set: { [`${s}.route`]: { drawn: 1, dashOffset: -140 }, [`${s}.ship`]: { x: 740, y: 1060 } } },
  ],
});

const bars = (s: string, at: number): Piece => {
  const values = [0.38, 0.7, 0.52, 0.9];
  const add: NodeSpec[] = values.map((v, i) => ({ id: `${s}.bar.${i}`, kind: "path", parent: s, props: { x: 170 + i * 240, y: 1400, points: box(-85, -40, 170, 40), closed: 1, fill: "accent", stroke: "none", shadowY: 10, shadowBlur: 14, shadowColor: "ink", shadowOpacity: 0.5 } }));
  add.push(
    { id: `${s}.card.a`, kind: "path", parent: s, props: { x: 430, y: 300, points: box(-250, -130, 500, 260), closed: 1, fill: "ink", z: 1, shadowY: 18, shadowBlur: 30, shadowColor: "ink", shadowOpacity: 0.6 } },
    { id: `${s}.card.b`, kind: "path", parent: s, props: { x: 650, y: 380, points: box(-250, -130, 500, 260), closed: 1, fill: "accent", z: 2, shadowY: 18, shadowBlur: 30, shadowColor: "ink", shadowOpacity: 0.6 } },
  );
  return {
    add,
    steps: [
      ...values.map((v, i): Step => ({ at: at + 8 + i * 6, move: { frames: 34, ease: "spring" }, set: { [`${s}.bar.${i}`]: { points: box(-85, -v * 800, 170, v * 800), fill: "linear(90, highlight, accent 0.6, ink)", brightness: 1 + v * 0.2 } } })),
      { at: at + 50, move: { frames: 16 }, set: { [`${s}.card.a`]: { z: 3, x: 500, y: 330 }, [`${s}.card.b`]: { x: 600, y: 350 } } },
    ],
  };
};

const microscope = (s: string, at: number, src: string): Piece => {
  const slide: Props = { x: W / 2, y: H / 2, w: W, h: H, src, srcW: 1600, srcH: 1000, fit: "cover", crop: [0, 0, 1, 1] };
  return {
    add: [
      { id: `${s}.field`, kind: "image", parent: s, props: { ...slide, blur: 0, saturation: 1 } },
      { id: `${s}.lens`, kind: "image", parent: s, props: { x: W / 2, y: 900, w: 700, h: 700, src, srcW: 1600, srcH: 1000, fit: "cover", crop: [0.36, 0.3, 0.3, 0.3], clip: circle(0, 0, 330), feather: 12 } },
      { id: `${s}.ring`, kind: "path", parent: s, props: { x: W / 2, y: 900, points: circle(0, 0, 340), closed: 1, stroke: "paper", strokeWidth: 10, dash: [40, 18], drawn: 1, glow: 10, glowColor: "paper" } },
    ],
    steps: [
      { at: at + 10, move: { frames: 60 }, set: {
        [`${s}.field`]: { blur: 14, saturation: 0.15, brightness: 0.6, tint: "accent", tintAmount: 0.65, crop: [0.1, 0.1, 0.8, 0.8] },
        [`${s}.lens`]: { crop: [0.45, 0.38, 0.1, 0.1], contrast: 1.2, hue: 40 },
        [`${s}.ring`]: { dashOffset: 300, rotate: 30 },
      } },
    ],
  };
};

const word = (s: string, at: number): Piece => ({
  add: [
    { id: `${s}.matte`, kind: "text", parent: s, props: { x: W / 2, y: 660, size: 310, weight: 900, font: "Arial Black", text: "WORD", color: "paper" } },
    { id: `${s}.fill`, kind: "path", parent: s, props: { x: 0, points: box(-W, 300, W * 3, 720), closed: 1, fill: "linear(0, accent, highlight, accent, ink)", mask: `${s}.matte` } },
    { id: `${s}.hole`, kind: "path", parent: s, props: { x: W / 2, y: 1300, points: box(-470, -230, 940, 460), closed: 1, fill: "linear(0, accent, highlight)", mask: `${s}.spot`, maskInvert: 1 } },
    { id: `${s}.spot`, kind: "path", parent: s, props: { x: 200, y: 1300, points: circle(0, 0, 120), closed: 1, fill: "paper" } },
  ],
  steps: [
    { at: at + 6, move: { frames: 76, ease: "linear" as const }, set: { [`${s}.fill`]: { x: 700 }, [`${s}.spot`]: { x: 880, scaleX: 1.6, scaleY: 1.6 } } },
  ],
});

const venn = (s: string, at: number): Piece => ({
  add: [
    { id: `${s}.set`, kind: "group", parent: s, props: { isolate: 1 } },
    { id: `${s}.a`, kind: "path", parent: `${s}.set`, props: { x: 160, y: 760, points: circle(0, 0, 300), closed: 1, fill: "accent", blend: "multiply", trimEnd: 1 } },
    { id: `${s}.b`, kind: "path", parent: `${s}.set`, props: { x: 920, y: 760, points: circle(0, 0, 300), closed: 1, fill: "highlight", blend: "multiply" } },
    { id: `${s}.c`, kind: "path", parent: `${s}.set`, props: { x: W / 2, y: 1320, points: circle(0, 0, 300), closed: 1, fill: "radial(0.5, 0.5, 0.6, paper, accent)", blend: "multiply" } },
    { id: `${s}.loop`, kind: "path", parent: s, props: { x: W / 2, y: 880, points: circle(0, 0, 500), closed: 1, stroke: "linear(0, accent, ink)", strokeWidth: 18, lineCap: "butt", trimStart: 0, trimEnd: 0.05 } },
  ],
  steps: [
    { at: at + 6, move: { frames: 60 }, set: { [`${s}.a`]: { x: 400, y: 800 }, [`${s}.b`]: { x: 680, y: 800 }, [`${s}.c`]: { y: 1080 }, [`${s}.loop`]: { trimStart: 0.5, trimEnd: 1 } } },
  ],
});

function scene(): { doc: SceneDoc; frames: number } {
  const src = specimen();
  const steps = [
    ...vignette("eclipse", 0, "shader, glow, radial paint, screen blend", "ink", eclipse),
    ...vignette("route", 1, "dashes, draw, shadows, layer above the group", "paper", route),
    ...vignette("bars", 2, "color morphs to gradient, depth order swaps", "paper", bars),
    ...vignette("cells", 3, "crop, blur, tint, feathered clip", "ink", (s, at) => microscope(s, at, src)),
    ...vignette("word", 4, "matte from text, inverted matte", "ink", word),
    ...vignette("venn", 5, "multiply blend, stroke trim, gradient stroke", "paper", venn),
  ];
  return { doc: { background: "paper", steps }, frames: 6 * LENGTH + 8 };
}

function crowd(): { doc: SceneDoc; frames: number } {
  const count = 5000;
  const place = (i: number, spin: number) => ({ x: W / 2 + Math.cos(i * 0.31 + spin) * (40 + (i % 97) * 4.6), y: H / 2 + Math.sin(i * 0.17 + spin) * (60 + (i % 89) * 9.4) });
  const add: NodeSpec[] = [{ id: "all", kind: "group" }];
  for (let i = 0; i < count; i++) add.push({ id: `dot.${i}`, kind: "path", parent: "all", props: { ...place(i, 0), points: box(-6, -6, 12, 12), closed: 1, fill: i % 2 ? "accent" : "ink", stroke: "none" } });
  const move = Object.fromEntries(Array.from({ length: count }, (_, i) => [`dot.${i}`, { ...place(i, 1.4), fill: i % 2 ? "ink" : "accent", rotate: 90 }]));
  return { doc: { background: "paper", steps: [{ at: 0, enter: "none", add }, { at: 10, move: { frames: 40 }, set: move }] }, frames: 60 };
}

const args = process.argv.slice(2);
const wantCrowd = args.includes("--crowd");
const [out, ...styles] = args.filter((a) => a !== "--crowd");
const serveUrl = await bundled(resolve("engine/render/preview.tsx"));
for (const name of styles) {
  const theme = themeFrom(name);
  for (const [label, made] of wantCrowd ? ([["crowd", crowd()]] as const) : ([["rendering", scene()]] as const)) {
    const built = compile(made.doc, { fps: 30, width: W, height: H, frames: made.frames, theme });
    const inputProps = { scene: built, theme };
    const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, chromiumOptions: { gl: "angle" } });
    const t0 = Date.now();
    await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, crf: 20, chromiumOptions: { gl: "angle" }, outputLocation: join(out!, `${label}-${name}.mp4`) });
    const seconds = (Date.now() - t0) / 1000;
    console.log(`${label} ${name}: ${built.nodes.length} parts, ${built.tracks.length} tracks, ${made.frames} frames in ${seconds.toFixed(0)} s, ${((seconds * 1000) / made.frames).toFixed(0)} ms a frame`);
  }
}
