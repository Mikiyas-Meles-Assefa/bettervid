// A specimen page for judging a style: a titled table in a panel with a dimmed stretch and an emphasized answer, a
// diagram with labels, pointers and words inside filled shapes, and an archival photo beside a generated picture with
// words over them. Built from the four primitives with each role's look applied by hand, so the design layer can be
// seen before the scene language applies roles itself.
//
// `mode: "before"` draws the same page the way the engine and Spark drew it in the first videos (panels from the
// paper color, words straight on photos, dimming by opacity, colors picked freely), so the two can be compared.
import type { NodeSpec, Props, Role, SceneDoc, Step, Theme } from "../core/types.ts";
import { type Design, dimColor, roleLook } from "./design.ts";

const W = 1080;
export type Pictures = { photo: string; photoW: number; photoH: number; made: string; madeW: number; madeH: number };
type Mode = "before" | "after";

const r1 = (v: number) => Math.round(v * 10) / 10;
function roundRect(w: number, h: number, r: number): number[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1) return [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2];
  const pts: number[] = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 6; i++) {
      const t = ((from + i * 15) * Math.PI) / 180;
      pts.push(r1(cx + Math.cos(t) * rr), r1(cy + Math.sin(t) * rr));
    }
  };
  corner(w / 2 - rr, -h / 2 + rr, -90);
  corner(w / 2 - rr, h / 2 - rr, 0);
  corner(-w / 2 + rr, h / 2 - rr, 90);
  corner(-w / 2 + rr, -h / 2 + rr, 180);
  pts.push(pts[0]!, pts[1]!);
  return pts;
}
function ellipse(rx: number, ry: number, turns = 1, start = 0, grow = 0): number[] {
  const n = Math.round(48 * turns);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = start + (i / n) * turns * Math.PI * 2;
    const k = 1 + grow * (i / n);
    return [r1(Math.cos(t) * rx * k), r1(Math.sin(t) * ry * k)];
  }).flat();
}
// Rough width of a line of text, for sizing strips and panels. Wide enough for the widest fonts the styles use.
const widthOf = (text: string, size: number, upper: boolean) => text.length * size * (upper ? 0.64 : 0.54);

export function specimen(theme: Theme & { design?: Design }, mode: Mode, pics: Pictures, vignette = 0, stage = 0): SceneDoc {
  const d = theme.design;
  if (mode === "after" && !d) throw new Error("the after specimen needs a theme with a design layer");
  const c = theme.colors;
  const sections: NodeSpec[][] = [[]];
  const section = () => sections.push([]);
  const add = (n: NodeSpec) => sections.at(-1)!.push(n);
  let k = 0;
  const id = (p: string) => `${p}${k++}`;

  // One line of words in a role, sitting on `on`. Returns its size in pixels.
  const words = (role: Role, text: string, x: number, y: number, on = "paper", o: { anchor?: "start" | "middle" | "end"; dim?: boolean; parent?: string; before?: Props } = {}) => {
    const props: Props = { x, y, text, anchor: o.anchor ?? "middle" };
    let size: number;
    if (mode === "after") {
      const look = roleLook(d!, role, on);
      size = Math.round((look.size ?? 0.044) * W);
      const hex = c[look.color!]!;
      Object.assign(props, {
        text: look.case === "upper" ? text.toUpperCase() : text,
        size,
        font: look.font ?? "body",
        weight: look.weight ?? 400,
        color: o.dim ? dimColor(hex, d!, c) : hex,
        glowLevel: o.dim ? d!.elements.dim.glow : (look.glow ?? 0),
      });
      if (role === "muted" && look.opacity !== undefined) props.opacity = look.opacity;
    } else {
      size = o.before?.size as number ?? 48;
      Object.assign(props, { size, font: "body", weight: 400, color: "ink" }, o.before);
      if (o.dim) props.opacity = theme.style?.read?.dim ?? 0.5;
    }
    add({ id: id("t"), kind: "text", ...(o.parent ? { parent: o.parent } : {}), props });
    return size;
  };

  // A panel: the style's surface for grouping, or in "before" the paper-colored card the engine drew.
  const panel = (x: number, y: number, w: number, h: number) => {
    if (mode === "before") {
      add({ id: id("panel"), kind: "path", props: { x, y, points: roundRect(w, h, 26), closed: 1, fill: "paper", stroke: "none", shadowY: 6, shadowBlur: 18, shadowOpacity: 0.35, shadowColor: "#000000" } });
      return;
    }
    const p = d!.elements.panel;
    const look = roleLook(d!, "panel");
    const sh: Props = p.shadow ? { shadowX: r1(7 * p.shadow), shadowY: r1(9 * p.shadow), shadowBlur: 0, shadowOpacity: p.shadow, shadowColor: c.ink! } : {};
    add({ id: id("panel"), kind: "path", props: { x, y, rotate: p.rotate, points: roundRect(w, h, p.radius * Math.min(w, h)), closed: 1, fill: look.back!, stroke: p.edge === "none" ? "none" : p.edge, strokeWidth: p.edgeWidth * (look.stroke ?? 1), ...sh } });
  };

  // Words over a picture, on the style's designed backing.
  const caption = (text: string, x: number, y: number) => {
    if (mode === "before") {
      words("body", text, x, y, "paper", { before: { size: 64, font: "title", color: "ink" } });
      return;
    }
    const look = roleLook(d!, "caption");
    const e = d!.elements.caption;
    const size = (look.size ?? 0.044) * W;
    const shown = look.case === "upper" ? text.toUpperCase() : text;
    const w = widthOf(shown, size, look.case === "upper") + size * e.pad * 2 + e.ruleWidth;
    const h = size * (1 + e.pad * 2);
    const g = id("cap");
    add({ id: g, kind: "group", props: { x, y, rotate: e.rotate } });
    add({ id: id("capback"), kind: "path", parent: g, props: { points: roundRect(w, h, 0), closed: 1, fill: look.back!, stroke: e.edge === "none" ? "none" : e.edge, strokeWidth: 3 } });
    if (e.rule !== "none" && e.ruleWidth > 0) add({ id: id("caprule"), kind: "path", parent: g, props: { x: -w / 2 + e.ruleWidth / 2, points: roundRect(e.ruleWidth, h, 0), closed: 1, fill: e.rule, stroke: "none" } });
    words("caption", text, e.ruleWidth / 2, 0, look.back, { parent: g });
  };

  const arrow = (x1: number, y1: number, x2: number, y2: number, dim = false) => {
    const look = mode === "after" ? roleLook(d!, "pointer") : undefined;
    const color = look ? c[look.color!]! : c.ink!;
    const width = mode === "after" ? d!.elements.pointer.width * (look!.stroke ?? 1) : 6;
    const stroke = dim && mode === "after" ? dimColor(color, d!, c) : color;
    const glowLevel = mode === "after" ? (dim ? d!.elements.dim.glow : (look!.glow ?? 0)) : 1;
    add({ id: id("arrow"), kind: "path", props: { points: [x1, y1, x2, y2], stroke, strokeWidth: width, glowLevel } });
    const a = Math.atan2(y2 - y1, x2 - x1);
    const L = 26;
    const p1 = [x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5)];
    const p2 = [x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5)];
    const head = mode === "after" ? d!.elements.pointer.head : "open";
    if (head === "open") add({ id: id("head"), kind: "path", props: { points: [p1[0]!, p1[1]!, x2, y2, p2[0]!, p2[1]!].map(r1), stroke, strokeWidth: width, glowLevel } });
    if (head === "solid") add({ id: id("head"), kind: "path", props: { points: [p1[0]!, p1[1]!, x2, y2, p2[0]!, p2[1]!, p1[0]!, p1[1]!].map(r1), closed: 1, fill: stroke, stroke, strokeWidth: 2, glowLevel } });
  };
  const ring = (x: number, y: number, rx: number, ry: number) => {
    const look = mode === "after" ? roleLook(d!, "pointer") : undefined;
    const hand = mode === "after" ? d!.elements.pointer.ring === "hand" : true;
    add({ id: id("ring"), kind: "path", props: { x, y, rotate: -6, points: hand ? ellipse(rx, ry, 1.12, -2.2, 0.08) : ellipse(rx, ry), closed: hand ? 0 : 1, smooth: 1, stroke: look ? look.color! : "accent", strokeWidth: mode === "after" ? d!.elements.pointer.width * (look!.stroke ?? 1) : 6, glowLevel: look?.glow ?? 1 } });
  };

  // ---- 1. Kicker and title
  words("heading", "Chapter two", W / 2, 100, "paper", { before: { size: 40, color: "accent" } });
  const ts = words("title", "Measuring", W / 2, 190, "paper", { before: { size: 92, font: "title" } });
  words("title", "the spread", W / 2, 190 + ts * 1.08, "paper", { before: { size: 92, font: "title" } });

  section();
  // ---- 2. A table in a panel, two rows dimmed, one row and the answer emphasized
  const top = Math.round(190 + ts * 1.08 + ts * 0.6 + 30);
  const px = W / 2;
  const pw = 900;
  const ph = 500;
  const py = top + ph / 2;
  panel(px, py, pw, ph);
  const cols = [px - 300, px, px + 300];
  const header = mode === "after" ? d!.elements.table.header : "body";
  const rowH = 64;
  const y0 = top + 60;
  const onPanel = mode === "after" ? roleLook(d!, "panel").back! : "paper";
  ["x", "x − mean", "squared"].forEach((h, i) => words(header, h, cols[i]!, y0, onPanel, { before: { size: 40, color: "highlight" } }));
  const rows = [["1", "−2", "4"], ["2", "−1", "1"], ["4", "1", "1"], ["6", "3", "9"]];
  const lines = mode === "after" ? d!.elements.table.lines : "none";
  const rule = mode === "after" ? d!.elements.table.rule : "ink";
  const ruleW = mode === "after" ? d!.elements.table.ruleWidth : 2;
  if (lines !== "none") add({ id: id("rule"), kind: "path", props: { points: [px - 400, y0 + 40, px + 400, y0 + 40], stroke: rule, strokeWidth: ruleW * 1.5 } });
  if (mode === "after" && d!.elements.table.zebra !== "none") {
    for (const i of [1, 3]) add({ id: id("zebra"), kind: "path", props: { x: px, y: y0 + 40 + rowH * (i + 0.5), points: roundRect(820, rowH, 0), closed: 1, fill: d!.elements.table.zebra, stroke: "none" } });
  }
  rows.forEach((row, r) => {
    const y = y0 + 40 + rowH * (r + 0.5);
    const dim = r === 1 || r === 2;
    const key = r === 3;
    if (key && mode === "after") {
      const h = d!.elements.highlight;
      if (h.kind === "marker") add({ id: id("mark"), kind: "path", props: { x: cols[2]!, y, rotate: -2, opacity: h.opacity, points: roundRect(110, rowH * 0.8, 4), closed: 1, fill: h.color, stroke: "none" } });
    }
    row.forEach((v, i) => {
      const role: Role = key && i === 2 ? "key" : "body";
      const on = key && i === 2 && mode === "after" && d!.elements.highlight.kind === "marker" ? d!.elements.highlight.color : onPanel;
      words(role, v, cols[i]!, y, on, { dim, before: { size: 46, color: key && i === 2 ? "highlight" : "ink" } });
    });
    if (lines === "rows" || lines === "grid") add({ id: id("rule"), kind: "path", props: { points: [px - 400, y + rowH / 2, px + 400, y + rowH / 2], stroke: rule, strokeWidth: ruleW, ...(dim && mode === "after" ? { strokeOpacity: 1 } : {}) } });
  });
  if (lines === "grid") for (const x of [px - 150, px + 150]) add({ id: id("rule"), kind: "path", props: { points: [x, y0 - 30, x, y0 + 40 + rowH * 4], stroke: rule, strokeWidth: ruleW } });
  // The answer, with the wrong divisor struck out beside it
  const ay = top + ph - 62;
  const as = words("answer", "variance = 4", px - 70, ay, onPanel, { before: { size: 66, color: "highlight" } });
  if (mode === "after") {
    const h = d!.elements.highlight;
    const aw = widthOf("variance = 4", as, false) * 0.92;
    const hc = h.color;
    if (h.kind === "underline") add({ id: id("under"), kind: "path", props: { points: [px - 70 - aw / 2, ay + as * 0.62, px - 70 + aw / 2, ay + as * 0.6], stroke: hc, strokeWidth: 7 } });
    if (h.kind === "box") add({ id: id("box"), kind: "path", props: { x: px - 70, y: ay, points: roundRect(aw + 40, as * 1.35, 0), closed: 1, stroke: hc, strokeWidth: 4 } });
    if (h.kind === "ring") add({ id: id("ring"), kind: "path", props: { x: px - 70, y: ay, rotate: -3, points: ellipse(aw / 2 + 30, as * 0.85, 1.1, -2.4, 0.06), smooth: 1, stroke: hc, strokeWidth: 6 } });
  }
  const wx = px + 300;
  const ws = words("wrong", "÷ 5", wx, ay, onPanel, { before: { size: 46, color: "accent" } });
  if (mode === "after") add({ id: id("strike"), kind: "path", props: { points: [wx - ws * 1.1, ay + 4, wx + ws * 1.1, ay - 6], stroke: roleLook(d!, "wrong").color!, strokeWidth: 6 } });
  words("note", "a sample of five, so divide by n − 1", px, top + ph + 48, "paper", { before: { size: 34, color: "ink" } });

  section();
  // ---- 3. A diagram: words inside filled shapes, labels, pointers, one muted line
  const dy = top + ph + 215;
  const shapes = [
    { x: 230, fill: "accent", text: "data", round: true },
    { x: 540, fill: "highlight", text: "mean", round: false },
    { x: 850, fill: mode === "after" ? roleLook(d!, "panel").back! : "paper", text: "spread", round: false },
  ];
  for (const s of shapes) {
    const pts = s.round ? ellipse(105, 105) : roundRect(230, 150, mode === "after" ? d!.elements.panel.radius * 150 : 24);
    add({ id: id("shape"), kind: "path", props: { x: s.x, y: dy, points: pts, closed: 1, fill: s.fill, stroke: "ink", strokeWidth: 5 } });
    words("label", s.text, s.x, dy, s.fill, { before: { size: 44, color: s.fill === "highlight" ? "accent" : "ink" } });
  }
  arrow(345, dy, 415, dy);
  arrow(665, dy, 725, dy);
  ring(540, dy, 142, 100);
  words("label", "every value", 230, dy + 150, "paper", { before: { size: 34 } });
  words("muted", "since 1890", 850, dy + 150, "paper", { before: { size: 34 }, dim: mode === "before" });

  section();
  // ---- 4. Pictures: an archival photo and a generated one, with words over them
  const iy = dy + 440;
  const pic = (src: string, sw: number, sh: number, x: number, y: number, w: number, rot: number) => {
    const h = (w * sh) / sw;
    const g = id("pic");
    if (mode === "after") {
      const p = d!.picture;
      add({ id: g, kind: "group", props: { x, y, rotate: rot * p.rotate, ...(p.shadow ? { shadowY: 10 * p.shadow, shadowBlur: 24 * p.shadow, shadowOpacity: p.shadow, shadowColor: "#000000" } : {}) } });
      if (p.border !== "none" && p.borderWidth > 0) add({ id: id("border"), kind: "path", parent: g, props: { points: roundRect(w + p.borderWidth * 2, h + p.borderWidth * 2, 0), closed: 1, fill: p.border, stroke: "none" } });
      add({ id: id("img"), kind: "image", parent: g, props: { src, w, h, saturation: p.saturation, contrast: p.contrast, brightness: p.brightness, ...(p.tintAmount ? { tint: c[p.tint]!, tintAmount: p.tintAmount } : {}) } });
    } else {
      add({ id: g, kind: "group", props: { x, y } });
      add({ id: id("img"), kind: "image", parent: g, props: { src, w, h } });
    }
    return h;
  };
  const ph1 = pic(pics.photo, pics.photoW, pics.photoH, 380, iy, 640, -1);
  pic(pics.made, pics.madeW, pics.madeH, 860, iy + 30, 260, 1);
  caption("1900 glider, flown as a kite", 420, iy + ph1 / 2 - 10);
  if (mode === "after") {
    const tagBack = d!.elements.label.back;
    const look = roleLook(d!, "label", tagBack);
    const size = (look.size ?? 0.04) * W;
    const t = "wing";
    const w = widthOf(look.case === "upper" ? t.toUpperCase() : t, size, look.case === "upper") + size;
    add({ id: id("leader"), kind: "path", props: { points: [560, iy - ph1 / 2 + 70, 620, iy - ph1 / 2 + 150], stroke: d!.elements.label.leader === "none" ? "ink" : d!.elements.label.leader, strokeWidth: Math.max(2, d!.elements.label.leaderWidth) } });
    add({ id: id("tag"), kind: "path", props: { x: 520, y: iy - ph1 / 2 + 50, points: roundRect(w, size * 1.6, 0), closed: 1, fill: tagBack, stroke: "none" } });
    words("label", t, 520, iy - ph1 / 2 + 50, tagBack);
  } else {
    words("label", "wing", 560, iy - ph1 / 2 + 60, "paper", { before: { size: 40, color: "ink" } });
  }

  // The player lays the style file's vignette over the whole frame, so the specimen shows it too.
  if (vignette > 0) sections[0]!.push({ id: "vignette", kind: "path", props: { z: 100, points: [0, 0, W, 0, W, 1920, 0, 1920, 0, 0], closed: 1, stroke: "none", fill: `radial(0.5, 0.5, 0.72, #00000000 0.5, #000000${Math.round(vignette * 255).toString(16).padStart(2, "0")} 1)` } });
  // Staged, each part arrives in turn with the style's own entrance; otherwise everything is there at once.
  const steps: Step[] = stage ? sections.map((add, i) => ({ at: i * stage, add, enter: theme.enter ?? "fade" })) : [{ at: 0, add: sections.flat(), enter: "none" }];
  return { steps };
}

