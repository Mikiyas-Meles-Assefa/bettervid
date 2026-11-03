// Depiction for the design brain prototype: a thing the author names as an `object` is drawn, not written. The
// description is resolved to a prop with parts that carry state (a liquid with a level and a color, a body that can
// fall, a scale that can be read, a hand that can turn), drawn from vector parts in the style's own ink.
//
// This is the first of the depiction tiers in docs/DESIGN-BRAIN.md (drawn parametric props). The others (a generated
// sprite cut into parts with SAM, the user's own picture with its parts, a real picture) give the same interface:
// a box, named parts, and states. The lexicon here is about kinds of things (containers, balls, clocks), never about a
// topic, and anything it does not know becomes a card with the thing's name and a note asking the pictures stage.
//
// Local units: every prop is drawn with its origin at its base (bottom center), y going up as negative numbers.

export type Shape = "flask" | "beaker" | "burette" | "glass" | "bottle" | "tube";
export type Prop = {
  kind: "vessel" | "ball" | "clock" | "card";
  shape?: Shape;
  w: number; // local width
  h: number; // local height
  liquid?: string; // the color of the contents (hex with alpha), undefined when empty
  level: number; // 0 to 1, how full
  body?: { fill: string; marks: "holes" | "seam" | "none"; size: number }; // a ball's look and real size in cm
  label: string; // the plain name, for notes and a fallback card
  why: string; // how the description was read, for the notes
};

const has = (d: string, re: RegExp) => re.test(d.toLowerCase());

// Color words to colors. "faint", "pale" or "light" mix toward clear; "dark" or "deep" mix toward black.
const COLORS: Record<string, string> = { pink: "#e8559a", red: "#d33a2c", blue: "#3b7dd8", green: "#3fa34d", yellow: "#f2cf3a", orange: "#ee8a2a", purple: "#8a4fc9", brown: "#8b5a2b", black: "#1d1f2b", white: "#f4f4f4", grey: "#9aa0a6", gray: "#9aa0a6", clear: "#cfe8f0" };
export function colorOf(words: string): { hex: string; alpha: number } | undefined {
  const w = words.toLowerCase();
  const name = Object.keys(COLORS).find((k) => new RegExp(`\\b${k}\\b`).test(w));
  if (!name) return undefined;
  // Faint means paler, not more see-through: on a dark page a see-through color reads darker, not fainter.
  let alpha = name === "clear" ? 0.35 : 0.82;
  let hex = COLORS[name]!;
  const toward = (c: string, t: number, k: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - k) + t * k).toString(16).padStart(2, "0")).join("")}`;
  if (/\b(faint|pale|light|slight)\b/.test(w)) (hex = toward(hex, 255, 0.55), (alpha = 0.7));
  if (/\b(dark|deep|strong)\b/.test(w)) (hex = toward(hex, 0, 0.35), (alpha = 0.95));
  return { hex, alpha };
}
export const withAlpha = (hex: string, a: number) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;

// Real sizes of common balls in cm, so two balls side by side keep their true proportion.
const BALLS: [RegExp, number, string, Prop["body"] extends infer B ? B extends { marks: infer M } ? M : never : never][] = [
  [/bowling/, 21.8, "#22263a", "holes"],
  [/basket/, 24, "#e07b2a", "seam"],
  [/soccer|football/, 22, "#f4f4f4", "seam"],
  [/tennis/, 6.7, "#d4e157", "seam"],
  [/baseball/, 7.4, "#f4f1e8", "seam"],
  [/golf/, 4.3, "#f7f7f7", "none"],
  [/ping.?pong|table tennis/, 4, "#fafafa", "none"],
  [/marble/, 1.6, "#5aa0d0", "none"],
];

export function resolve(desc: string): Prop {
  const d = desc.toLowerCase();
  const contents = colorOf(d.replace(/.*\b(of|holding|with|full of|filled with)\b/, "")) ?? (has(d, /\b(acid|water|liquid|solution|hydroxide|juice|oil|milk)\b/) ? { hex: COLORS.clear!, alpha: 0.35 } : undefined);
  const vessel = (shape: Shape, w: number, h: number, level: number): Prop => ({ kind: "vessel", shape, w, h, liquid: contents ? withAlpha(contents.hex, contents.alpha) : undefined, level: contents ? level : 0, label: shape, why: `"${desc}" reads as a ${shape}${contents ? " with liquid in it" : ""}` });
  if (has(d, /\bburett?e\b|\bpipette\b/)) return vessel("burette", 110, 1000, 0.96);
  if (has(d, /\b(flask|erlenmeyer|conical)\b/)) return vessel("flask", 620, 760, 0.42);
  if (has(d, /\bbeaker\b/)) return vessel("beaker", 560, 640, 0.5);
  if (has(d, /\b(glass|cup|jar|mug)\b/)) return vessel("glass", 440, 620, 0.6);
  if (has(d, /\b(bottle|vial)\b/)) return vessel("bottle", 360, 820, 0.6);
  if (has(d, /\b(tube|cylinder)\b/)) return vessel("tube", 160, 900, 0.5);
  if (has(d, /\b(stopwatch|timer|clock|watch)\b/)) return { kind: "clock", w: 600, h: 700, level: 0, label: "clock", why: `"${desc}" reads as a clock face with a hand` };
  if (has(d, /\b(ball|sphere|orb|marble)\b/)) {
    const hit = BALLS.find(([re]) => re.test(d));
    const c = colorOf(d);
    return { kind: "ball", w: 1000, h: 1000, level: 0, body: { fill: hit?.[2] ?? c?.hex ?? "#c9c2b0", marks: hit?.[3] ?? "none", size: hit?.[1] ?? 10 }, label: "ball", why: `"${desc}" reads as a ball${hit ? ` (${hit[1]} cm across, its true size)` : ""}` };
  }
  return { kind: "card", w: 800, h: 480, level: 0, label: desc.split(/[,.]/)[0]!.replace(/^(a|an|the)\s+/i, "").slice(0, 28), why: `"${desc}" is not a kind of thing the prototype can draw: a card stands in, and the pictures stage would be asked for it` };
}

type Add = (id: string, kind: "group" | "path" | "text", props: Record<string, unknown>, parent?: string) => void;
const r1 = (v: number) => Math.round(v * 10) / 10;

// The inside of a vessel at a level: a polygon (x, y pairs in local units) with a fixed number of points so levels morph.
export function liquidPoly(p: Prop, level: number): number[] {
  const L = Math.max(0, Math.min(1, level));
  if (p.shape === "flask") {
    const top = 520; // the cone's top; the neck stays empty
    const yl = -L * top;
    const hw = (y: number) => 300 - 16 - (225 - 16) * (-y / top);
    return [-hw(yl), yl, hw(yl), yl, 284, -24, 270, -14, -270, -14, -284, -24].map(r1);
  }
  if (p.shape === "burette") {
    const [y0, y1] = [-980, -170]; // inside of the tube, top and bottom
    const yl = y1 + (y0 - y1) * L;
    return [-40, yl, 40, yl, 40, y1, 40, y1, -40, y1, -40, y1].map(r1);
  }
  const hw = p.w / 2 - 18;
  const yl = -18 - L * (p.h - 60);
  return [-hw, yl, hw, yl, hw, -18, hw, -18, -hw, -18, -hw, -18].map(r1);
}
// Where a falling drop lands (the liquid's surface, local units) and where a drop leaves (the tip).
export const surfaceY = (p: Prop, level: number) => liquidPoly(p, level)[1]!;
export const tipOf = (p: Prop) => (p.shape === "burette" ? { x: 0, y: 0 } : { x: 0, y: -p.h });
export const mouthOf = (p: Prop) => ({ x: 0, y: p.shape === "flask" ? -760 : -p.h });
// A burette's scale: 0 mL at the top mark, 50 mL at the bottom mark. The reading at a level.
const BUR = { top: -960, bottom: -190, ml: 50 };
export const buretteReading = (level: number) => {
  const y = -170 + (-980 + 170) * level;
  return ((y - BUR.top) / (BUR.bottom - BUR.top)) * BUR.ml;
};
export const buretteYOfReading = (ml: number) => BUR.top + (ml / BUR.ml) * (BUR.bottom - BUR.top);
export const buretteLevelOf = (ml: number) => (buretteYOfReading(ml) + 170) / (-980 + 170);

// Draws the prop under a group `id` already made by the caller. `ink` is the style's line color, `paper` its page.
export function propNodes(id: string, p: Prop, add: Add, ink: string, paper: string, labelSize: number) {
  const line = { stroke: ink, strokeWidth: 10, lineJoin: "round", lineCap: "round", fill: "none" };
  if (p.kind === "vessel") {
    add(`${id}.liq`, "path", { points: liquidPoly(p, p.level), closed: 1, fill: p.liquid ?? withAlpha("#cfe8f0", 0), stroke: "none" }, id);
    add(`${id}.surf`, "path", { points: liquidPoly(p, p.level).slice(0, 4), stroke: ink, strokeWidth: 5, opacity: p.liquid ? 0.55 : 0 }, id);
    if (p.shape === "flask") {
      add(`${id}.body`, "path", { ...line, points: [-75, -760, -75, -520, -300, -40, -290, -8, -260, 0, 260, 0, 290, -8, 300, -40, 75, -520, 75, -760] }, id);
      add(`${id}.lip`, "path", { ...line, points: [-100, -760, 100, -760] }, id);
    } else if (p.shape === "burette") {
      add(`${id}.body`, "path", { ...line, strokeWidth: 8, points: [-50, -1000, -50, -170, -14, -120, -10, -10, 0, 0, 10, -10, 14, -120, 50, -170, 50, -1000] }, id);
      add(`${id}.tap`, "path", { ...line, strokeWidth: 9, points: [-95, -140, 95, -140] }, id);
      add(`${id}.knob`, "path", { points: [-110, -160, -80, -160, -80, -120, -110, -120], closed: 1, fill: ink, stroke: "none" }, id);
      for (let ml = 0; ml <= 50; ml += 1) {
        const y = r1(buretteYOfReading(ml));
        const big = ml % 5 === 0;
        add(`${id}.tick${ml}`, "path", { points: [-50, y, big ? -14 : -30, y], stroke: ink, strokeWidth: big ? 4 : 2.5, opacity: 0.8 }, id);
      }
      for (let ml = 0; ml <= 50; ml += 10) add(`${id}.num${ml}`, "text", { x: 92, y: r1(buretteYOfReading(ml)), text: String(ml), size: labelSize, role: "label", color: ink, opacity: 0 }, id);
    } else {
      const hw = p.w / 2;
      add(`${id}.body`, "path", { ...line, points: [-hw, -p.h, -hw, -20, -hw + 20, 0, hw - 20, 0, hw, -20, hw, -p.h] }, id);
    }
    return;
  }
  if (p.kind === "ball") {
    const b = p.body!;
    const circle = (r: number, cy: number, n = 40) => Array.from({ length: n }, (_, i) => [r1(r * Math.cos((i / n) * 2 * Math.PI)), r1(cy + r * Math.sin((i / n) * 2 * Math.PI))]).flat();
    add(`${id}.ball`, "path", { points: circle(500, -500), closed: 1, fill: b.fill, stroke: ink, strokeWidth: 14 }, id);
    add(`${id}.shine`, "path", { points: circle(110, -740, 20).map((v, i) => (i % 2 ? v : v - 170)), closed: 1, fill: "#ffffff", opacity: 0.22, stroke: "none" }, id);
    if (b.marks === "holes") for (const [x, y] of [[-90, -700], [70, -720], [-10, -580]] as const) add(`${id}.hole${x}`, "path", { points: circle(52, y, 16).map((v, i) => (i % 2 ? v : v + x)), closed: 1, fill: "#05060a", stroke: "none" }, id);
    if (b.marks === "seam") {
      const seam = (sx: number) => Array.from({ length: 21 }, (_, i) => { const t = (i / 20) * Math.PI - Math.PI / 2; return [r1(sx * (300 - 170 * Math.cos(t))), r1(-500 + 470 * Math.sin(t))]; }).flat();
      add(`${id}.seamL`, "path", { points: seam(-1), stroke: "#ffffff", strokeWidth: 22, opacity: 0.9 }, id);
      add(`${id}.seamR`, "path", { points: seam(1), stroke: "#ffffff", strokeWidth: 22, opacity: 0.9 }, id);
    }
    return;
  }
  if (p.kind === "clock") {
    const circle = (r: number, cy: number, n = 48) => Array.from({ length: n }, (_, i) => [r1(r * Math.cos((i / n) * 2 * Math.PI)), r1(cy + r * Math.sin((i / n) * 2 * Math.PI))]).flat();
    add(`${id}.face`, "path", { points: circle(290, -300), closed: 1, fill: paper, stroke: ink, strokeWidth: 16 }, id);
    add(`${id}.crown`, "path", { points: [-40, -600, 40, -600, 40, -650, -40, -650], closed: 1, fill: ink, stroke: "none" }, id);
    add(`${id}.sweep`, "path", { points: [0, -300, 0, -560], stroke: "#e8559a", strokeWidth: 26, lineCap: "round", opacity: 0, trimEnd: 0 }, id);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      add(`${id}.t${i}`, "path", { points: [r1(230 * Math.sin(a)), r1(-300 - 230 * Math.cos(a)), r1(265 * Math.sin(a)), r1(-300 - 265 * Math.cos(a))], stroke: ink, strokeWidth: i % 3 ? 6 : 12 }, id);
    }
    add(`${id}.hand`, "group", { y: -300 }, id);
    add(`${id}.handline`, "path", { points: [0, 30, 0, -235], stroke: ink, strokeWidth: 14, lineCap: "round" }, `${id}.hand`);
    add(`${id}.hub`, "path", { points: circle(22, 0, 12), closed: 1, fill: ink, stroke: "none" }, `${id}.hand`);
    return;
  }
  add(`${id}.card`, "path", { points: [-400, -480, 400, -480, 400, 0, -400, 0], closed: 1, fill: paper, stroke: ink, strokeWidth: 10 }, id);
  add(`${id}.name`, "text", { y: -240, text: p.label, size: 80, role: "title", color: ink }, id);
}
