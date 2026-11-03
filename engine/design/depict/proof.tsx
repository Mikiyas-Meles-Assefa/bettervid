// Proof sheet: every kind of thing, before and after a verb, in several styles, as one small PNG.
// Usage: node_modules/.bin/esbuild engine/design/depict/proof.tsx --bundle --platform=node --format=esm --jsx=automatic
//          --packages=external --outfile=out/depict/proof.mjs && node out/depict/proof.mjs <out.png> [styles] [cell px] [only kinds]
// Draws with the engine's own compile and SceneView (rendered to SVG on the server), photographed by headless Chrome.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { screenshot } from "./shot.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SceneView } from "../../render/SceneView.tsx";
import { compile } from "../../core/compile.ts";
import { themeFrom } from "../../render/theme.ts";
import type { NodeSpec, Step } from "../../core/types.ts";
import { changesToSteps, depictionFrom, suggestLook } from "./depict.ts";
import { SAMPLES, type Sample } from "./samples.ts";
import { spriteDepiction, type LoadedSprite } from "./sprite.ts";
import { pictureDepiction } from "./picture.ts";
import type { PropSpec } from "./spec.ts";
import type { PartCard } from "../types.ts";

const [outArg, stylesArg, cellArg, onlyArg] = process.argv.slice(2);
const out = resolve(outArg ?? "out/depict/proof.png");
const styles = (stylesArg ?? "flat,chalkboard,neon").split(",");
const CELL = Number(cellArg ?? 150);
const only = onlyArg ? new Set(onlyArg.split(",")) : undefined;
const FX = resolve("engine/design/depict/fixtures");
// Tiers 2 and 3 from the local fixture (no model is called): a sprite with hand-made masks, and a picture with a part card.
const lamp: LoadedSprite = { key: "fixture", desc: "desk lamp", style: "fixture", src: "lamp.png", size: [160, 160], dir: FX, made: { by: "hand", prompt: "" }, parts: { shade: { mask: "lamp-shade.png", box: [0.18, 0.18, 0.82, 0.47], anchor: [0.5, 0.47], changes: ["tint", "turn"] }, base: { mask: "lamp-base.png", box: [0.25, 0.8, 0.75, 0.91], changes: ["tint"] } } };
const lampSpec: PropSpec = { kind: "sprite", label: "lamp sprite", tier: 2, colors: { blue: "#3b7dd8" }, colorSources: { blue: "known: sample" }, why: "fixture" };
const card: PartCard = { name: "lamp photo", file: "lamp.png", size: [160, 160], kind: "photo", about: "a lamp", parts: { shade: { box: [0.18, 0.18, 0.82, 0.47], about: "the shade" } }, requirements: [], checked: { ok: true, notes: [] } };
const EXTRA: Sample[] = [
  { name: "sprite (tier 2)", spec: lampSpec, acts: [["turns", "blue"]], make: (t, l, id) => spriteDepiction(id, lamp, lampSpec, t, l) },
  { name: "picture (tier 3)", spec: { ...lampSpec, tier: 3 }, acts: [["zooms to", "shade"], ["marks", "shade"]], make: (t, l, id) => pictureDepiction(id, card, `${FX}/lamp.png`, t, l, { tier: 3 }) },
];
const samples = [...SAMPLES, ...EXTRA].filter((s) => !only || only.has(s.spec.kind) || only.has(s.name));
const COLS = 8; // four things per row, each before and after
const LABEL = 16;
const SHOT = 40; // the frame photographed

function sheet(style: string): string {
  const theme = themeFrom(style);
  const rows = Math.ceil((samples.length * 2) / COLS);
  const W = COLS * CELL;
  const H = rows * (CELL + LABEL);
  const add: NodeSpec[] = [];
  const later: Step[] = [];
  samples.forEach((s, i) => {
    for (const after of [false, true]) {
      const k = i * 2 + (after ? 1 : 0);
      const [cx, cy] = [(k % COLS) * CELL + CELL / 2, Math.floor(k / COLS) * (CELL + LABEL)];
      const id = `p${k}`;
      const probe = s.make ? s.make(theme, suggestLook(theme, 1), id) : depictionFrom(s.spec, theme, { id, look: suggestLook(theme, 1) });
      const sc = Math.min((CELL * 0.8) / probe.box.w, (CELL * 0.74) / probe.box.h);
      const look = suggestLook(theme, sc * (540 / CELL)); // lines as thick as on a thing half a 1080 frame tall
      const d = s.make ? s.make(theme, look, id) : depictionFrom(s.spec, theme, { id, look, text: 9 / sc });
      add.push(...d.nodes.map((n) => (n.id === id ? { ...n, props: { ...n.props, x: cx, y: cy + CELL * 0.9, scaleX: sc, scaleY: sc } } : n)));
      if (after) {
        for (const [verb, arg] of s.acts) {
          // A state change has finished by the photographed frame; a process (drops, a clock) is caught mid-way.
          const r = d.act(verb, arg, { frames: s.frames ?? 30, fps: 30 });
          if (!r.known) throw new Error(`${s.name}: ${r.notes.join("; ")}`);
          later.push(...changesToSteps(r.changes, 1));
        }
      }
      const caption = after ? s.acts.map(([v, a]) => `${v}${a !== undefined ? ` ${typeof a === "object" ? "" : a}` : ""}`).join(", ") : s.name;
      add.push({ id: `${id}.cap`, kind: "text", props: { x: cx, y: cy + CELL + LABEL * 0.45, text: caption.slice(0, 26), size: 11, color: "ink", opacity: 0.75 } });
    }
  });
  const scene = compile({ steps: [{ at: 0, add, enter: "none" }, ...later] }, { fps: 30, width: W, height: H, frames: 200, theme });
  const svg = renderToStaticMarkup(<SceneView scene={scene} theme={theme} frame={SHOT} />);
  return `<div style="margin:0 0 4px 0">${svg}</div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#888}</style></head><body>${styles.map(sheet).join("")}</body></html>`;
mkdirSync(dirname(out), { recursive: true });
const page = out.replace(/\.png$/, ".html");
writeFileSync(page, html);
const rows = Math.ceil((samples.length * 2) / COLS);
const height = styles.length * (rows * (CELL + LABEL) + 4);
const chrome = process.env.BETTERVID_CHROME!;
await screenshot(chrome, page, out, COLS * CELL, height);
rmSync(page);
console.log(out);
