// Places things. A model says what is on the board and how it is arranged; this works out every position and size, so
// nothing is laid out blind. Everything is pure, so positions are known for every state and things can travel between them.
import type { Problem } from "./syntax.ts";
import type { Atom, Item } from "./syntax.ts";
import type { NodeSpec, Props, Role, RoleLook, Theme } from "../core/types.ts";
import { bestOn, colorOf, inkOn, isRole, readability, roleLook } from "../core/roles.ts";
import { circle } from "../kits/shapes.ts";
import { fitScene, solveScene, type SceneThing } from "../design/abilities/scene.ts";
import { boxPoint } from "../design/depict/points.ts";
import type { RelationKind } from "../design/types.ts";

export type Box = { x: number; y: number; w: number; h: number }; // x and y are the center
export type Part = NodeSpec & { props: Props; line: number };
export type Measure = (text: string, size: number, font?: string) => number;
export type Env = {
  W: number; // canvas
  H: number;
  safe: Box; // where content may go
  theme: Theme;
  measure: Measure;
  // Size of a kit, graph or program before scaling. `rest`: where the middle of what it shows at first sits, as a share
  // of its height from the middle of its box (a kit's box also holds room for what its later steps show).
  natural: (item: Item) => { w: number; h: number; rest?: number };
  minText: number; // the smallest readable text, in pixels
  // What a thing in a stage is beyond its box: its real size in centimetres, and its named points as fractions of its
  // box (x from the left, y from the top). A depicted thing has both; anything else has its box's points.
  thing?: (item: Item) => { realCm?: { w: number; h: number }; point?: (name: string) => [number, number] | undefined } | undefined;
};
export type Slot = { item: Item; box: Box; scale: number };
// Words as they land on screen: where, how big, and the color of the panel or shape they sit on (none: whatever is
// behind them, which build works out from pictures, fields and the surface).
export type Shown = { id: string; box: Box; line: number; text: string; size: number; item: string; back?: string };
// What lies behind the arrangement: pictures (placed or filling the frame) and fields of color.
export type Field = { id: string; box: Box; line: number; picture: boolean; frame: boolean; fill?: string };
export type Laid = { notes?: string[]; parts: Part[]; boxes: Map<string, Box>; members: Map<string, string[]>; slots: Slot[]; links: { from: string; to: string; line: number }[]; problems: Problem[]; scale: number; smallest: number; texts: Shown[]; fields: Field[]; held: Box[] };
// `held`: room kept for what a later state of the stretch shows, so tags and labels placed now leave it free.
// The least contrast words may have with what is behind them, as a ratio. Words are large in a video, so 3 to 1.
export const MIN_CONTRAST = 3;

// Where content may go: clear of the edges, with the bottom left for captions. The camera frames into this area too.
export function safeArea(W: number, H: number): Box {
  const margin = W * 0.065;
  const top = H * 0.047;
  const usable = H * 0.765;
  return { x: W / 2, y: top + usable / 2, w: W - margin * 2, h: usable };
}

export const CHAR = 0.56; // average character width, in em
// Capitals and digits are wider than the average letter and spaces narrower, so words in capitals are not underestimated.
const charWidth = (c: string) => (/[A-Z0-9MW]/.test(c) ? 0.68 : c === " " ? 0.3 : CHAR);
export const estimate: Measure = (text, size, font) => (font === "mono" ? Math.max(0.6, [...text].length) * size * 0.6 : Math.max(0.6 * CHAR, [...text].reduce((sum, c) => sum + charWidth(c), 0)) * size);
export const TEXT_SIZE: Record<string, number> = { huge: 136, big: 96, normal: 70, small: 50, note: 40 };
const CODE_SIZE = 40;
const MAX_SCALE = 1.6;
// Roles whose words carry a moment, so they keep a readable share of their size however full the state.
const CARRIERS = new Set(["title", "heading", "key", "answer"]);
const MIN_SCALE = 0.4;

const n = (v: string | undefined, d: number) => (v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const SHAPE_KINDS = ["box", "circle", "pill", "diamond", "dot", "tri"];
const CONTAINER_KINDS = ["row", "stack", "grid", "ring", "chain", "free", "stage", "board"];
const LEAF_KINDS = ["atoms", "text", "code", "space"];
// How far the gaps of the outer stack may open to spread a state over the frame, as a share of the safe height.
const SPREAD = 0.22;
// The subject of a state (a kit, graph, program or picture in the main column) grows to use the frame, up to this many
// times its natural size, leaving this share of the safe height for the room around things. Words around it may then
// grow up to TEXT_GROW, which keeps them sized by role: the subject carries the idea, the words support it.
const SUBJECT_MAX = 3;
const BREATHE = 0.12;
const TEXT_GROW = 1.25;
const round = (v: number) => Math.round(v * 10) / 10;
const NUMERIC = new Set(["weight", "opacity", "rotate", "strokeWidth"]);
const look = (item: Item, keys: string[]): Props => Object.fromEntries(keys.filter((k) => item.attrs[k] !== undefined).map((k) => [k, NUMERIC.has(k) ? n(item.attrs[k], 0) : item.attrs[k]!]));

// Greedy line breaking, done at natural size so the breaks stay the same when the whole board scales.
export function wrap(text: string, size: number, width: number, measure: Measure, font?: string): string[] {
  const out: string[] = [];
  for (const para of text.split("\\n")) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && measure(next, size, font) > width) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

export function roundedBox(w: number, h: number, r: number): number[] {
  const out: number[] = [];
  const [x, y] = [w / 2 - r, h / 2 - r];
  const corners = [[x, y, 0], [-x, y, 1], [-x, -y, 2], [x, -y, 3]] as const;
  for (const [cx, cy, q] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = (q + i / 6) * (Math.PI / 2);
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }
  out.push(out[0]!, out[1]!);
  return out;
}
const ellipse = (w: number, h: number) => circle(0, 0, 1).map((v, i) => (i % 2 ? v * h / 2 : v * w / 2));

function shapePoints(kind: string, w: number, h: number): number[] {
  if (kind === "circle" || kind === "dot") return ellipse(w, h);
  if (kind === "pill") return roundedBox(w, h, Math.min(w, h) / 2 - 0.1);
  if (kind === "diamond") return [0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0, 0, -h / 2];
  if (kind === "tri") return [0, -h / 2, w / 2, h / 2, -w / 2, h / 2, 0, -h / 2];
  return roundedBox(w, h, Math.min(w, h) * 0.1);
}

// The ink for words on a fill, so a label never disappears into its own shape: the style's ink for that surface where
// its design names one, else whichever of ink and paper reads best.
export function readableOn(fill: string, theme: Theme): string {
  if (!theme.colors.ink || !theme.colors.paper) return "ink";
  if (theme.design) return inkOn(theme, fill);
  return bestOn(theme, theme.colors[fill] ? fill : "paper");
}

// A rectangle's outline, centered on 0,0.
export const rect = (w: number, h: number, x = 0): number[] => [x - w / 2, -h / 2, x + w / 2, -h / 2, x + w / 2, h / 2, x - w / 2, h / 2, x - w / 2, -h / 2].map(round);

// A stable turn of -1 or 1 for a thing, so pictures laid side by side lean alternately and keep their lean in every state.
export const leanOf = (id: string) => ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) & 1 ? 1 : -1);

// The style's picture treatment, so real and generated pictures look like one piece: color, and for a picture placed
// on the page (not filling the frame) its border, shadow and an alternating lean. A lean or fade the scene gave wins.
export function pictureLook(theme: Theme, id: string, placed: "page" | "fit" | "fill", own: Props = {}): Props {
  const d = theme.design;
  if (!d) return {};
  const p = d.picture;
  const out: Props = { saturation: p.saturation, contrast: p.contrast, brightness: p.brightness };
  if (p.tintAmount > 0) Object.assign(out, { tint: colorOf(theme, p.tint)!, tintAmount: p.tintAmount });
  if (placed === "fill") return out;
  if (p.border !== "none" && p.borderWidth > 0) Object.assign(out, { border: colorOf(theme, p.border)!, borderWidth: p.borderWidth });
  if (p.shadow > 0) Object.assign(out, { shadowY: round(10 * p.shadow), shadowBlur: round(24 * p.shadow), shadowOpacity: p.shadow, shadowColor: "#000000" });
  if (placed === "page" && p.rotate > 0 && own.rotate === undefined) out.rotate = leanOf(id) * p.rotate;
  return out;
}

// `stretch` is the board of every state in this state's stretch (a plain state and the keep states after it), this one
// included. The state is laid out over all of them: whatever any of them shows has its room in every one, so a thing
// that stays keeps its place and size while others come and go around it. `spare` is height, in pixels, to leave free
// for words attached to things (tags and labels), which are placed after the layout: neither the subject's growth nor
// the spreading of the frame takes it.
export function layout(items: Item[], env: Env, cap = MAX_SCALE, stretch?: Item[][], spare = 0): Laid {
  const { measure, theme } = env;
  const short = Math.min(env.W, env.H);
  const atomWidth = (a: Atom, size: number, font?: string) => measure(a.text, size, font);
  const list = (a: Atom[], size: number, font?: string) => a.reduce((sum, x) => sum + atomWidth(x, size, font), 0) + size * 0.16 * Math.max(0, a.length - 1);
  const columns = (rows: Atom[][], size: number, font?: string) => rows[0]!.map((_, c) => Math.max(...rows.map((r) => atomWidth(r[c]!, size, font))) + size * 0.5);

  // Roles: the scene says what a thing is for, and the style decides how it looks. An arrangement's role is the role
  // of everything inside it that does not name its own, except a panel, which is only the surface itself.
  const lookOf = (item: Item): RoleLook | undefined => (isRole(item.attrs.role) ? roleLook(theme, item.attrs.role) : undefined);
  const design = theme.design;
  // The role a thing's words are drawn in. A panel or pointer role is a surface or a mark, so its words are body; words
  // in a shape name it, so they are a label. With a design layer, words that name no role are body, the style's
  // ordinary words; without one they keep the plain defaults.
  const wordRole = (item: Item): Role | undefined => {
    const r = item.attrs.role;
    if (isRole(r) && r !== "panel" && r !== "pointer") return r;
    if (!design) return undefined;
    return SHAPE_KINDS.includes(item.kind) ? "label" : "body";
  };
  const wordLook = (item: Item, on?: string): RoleLook | undefined => {
    const r = wordRole(item);
    return r ? roleLook(theme, r, on) : undefined;
  };
  // A size from the role only when the scene named the role; otherwise the size words or the defaults.
  const fontSize = (item: Item, fallback: number) => {
    if (item.attrs.size !== undefined) return TEXT_SIZE[item.attrs.size] ?? n(item.attrs.size, fallback);
    const size = isRole(item.attrs.role) ? wordLook(item)?.size : undefined;
    return size ? size * short : fallback;
  };
  const fontOf = (item: Item) => item.attrs.font ?? wordLook(item)?.font;
  const mono = (item: Item) => (fontOf(item) === "mono" ? "mono" : undefined);
  // Which of the style's fonts a thing's words are measured in.
  const fontKey = (item: Item) => mono(item) ?? (fontOf(item) === "title" ? "title" : undefined);
  const textLines = (item: Item) => wrap(item.text ?? "", fontSize(item, TEXT_SIZE.normal!), n(item.attrs.w, env.safe.w), measure, fontKey(item));
  const textSize = (item: Item) => (item.kind === "atoms" ? TEXT_SIZE[item.size!]! : fontSize(item, TEXT_SIZE.normal!));
  // The surface a thing brings with it: a panel's back, or the back of a role such as caption.
  // With a design layer a panel is the style's panel: back=paper (a card the color of the page) is the panel, and a
  // panel never falls back to the page color. build reports a back= the style does not list as a surface.
  const panelBack = design ? roleLook(theme, "panel").back : undefined;
  const backOf = (item: Item): string | undefined => {
    if (item.attrs.back === "none") return undefined;
    if (item.attrs.back) return item.attrs.back === "paper" && panelBack ? panelBack : item.attrs.back;
    const look = lookOf(item);
    if (item.attrs.role === "panel" && (CONTAINER_KINDS.includes(item.kind) || item.kind === "text" || item.kind === "atoms")) return look?.back ?? "paper";
    if (look?.back && (item.kind === "text" || item.kind === "atoms")) return look.back;
    return undefined;
  };
  // Words over a picture that carry the caption look: a strip with the style's rule, rotation and padding.
  const isCaption = (item: Item) => !!design && item.attrs.role === "caption" && (item.kind === "text" || item.kind === "atoms") && item.attrs.back !== "none" && !item.attrs.back;
  // How words look: their own color if they give one, else their role's on what they sit on (the style's ink for that
  // surface), else ink. An explicit color that does not read is reported by build. With a design layer a role's glow
  // is its `glowLevel`, the share of the style's own light it carries; without one it is a plain glow.
  const textLook = (item: Item, back: string | undefined, fs: number): Props => {
    const look = wordLook(item, back);
    const out: Props = {};
    const explicit = item.attrs.color;
    let color = explicit ?? look?.color;
    if (!explicit && back && (!color || readability(theme, color, back) < MIN_CONTRAST)) color = readableOn(back, theme);
    if (color) out.color = color;
    const weight = item.attrs.weight !== undefined ? n(item.attrs.weight, 400) : look?.weight;
    if (weight !== undefined) out.weight = weight;
    const font = fontOf(item);
    if (font === "title") out.font = theme.fonts.title;
    if (font === "mono") out.font = theme.fonts.mono ?? "Menlo, monospace";
    const opacity = item.attrs.opacity !== undefined ? n(item.attrs.opacity, 1) : look?.opacity;
    if (opacity !== undefined) out.opacity = opacity;
    if (design) out.glowLevel = look?.glow ?? 0;
    else if (look?.glow) Object.assign(out, { glow: round(look.glow * fs * 0.3), glowColor: color ?? "ink" });
    return out;
  };

  const shapeSize = (item: Item, s: number) => {
    const size = fontSize(item, TEXT_SIZE.small!) * s;
    const label = item.text ? wrap(item.text, size, 460 * s, measure) : [];
    const tw = Math.max(0, ...label.map((l) => measure(l, size, fontKey(item))));
    const th = label.length * size * 1.2;
    if (item.kind === "dot") return { w: n(item.attrs.w, 36) * s, h: n(item.attrs.h, n(item.attrs.w, 36)) * s, label, size };
    const round = item.kind === "circle" || item.kind === "diamond";
    const inner = round ? Math.max(tw * (item.kind === "diamond" ? 1.7 : 1.25), th * (item.kind === "diamond" ? 1.9 : 1.3)) : 0;
    const w = n(item.attrs.w, 0) * s || Math.max(round ? Math.max(inner, 150 * s) : tw + size * 1.4, 150 * s);
    const h = n(item.attrs.h, 0) * s || (round ? w : Math.max(th + size * 1, 110 * s));
    return { w, h, label, size };
  };

  // A thing with a back sits on a panel of that color, with room around its contents: across and down. A caption's
  // room is the style's caption padding plus its rule; a panel's is scaled by the style's panel padding.
  const panelPad = design ? design.elements.panel.pad / 0.8 : 1;
  const padOf = (item: Item, s: number): [number, number] => {
    if (!backOf(item)) return [0, 0];
    if (isCaption(item)) {
      const e = design!.elements.caption;
      const fs = textSize(item) * s;
      return [fs * e.pad + (e.rule !== "none" ? e.ruleWidth / 2 : 0), fs * e.pad];
    }
    const p = (item.kind === "text" || item.kind === "atoms" ? textSize(item) * 0.4 * s : 48 * s) * panelPad;
    return [p, p];
  };
  // A thing's own size, and the room it holds: the largest of every version of it, or of what shares its place, in the
  // stretch. Sizes are kept while nothing changes them, since containers ask for their children's sizes many times.
  const ownSize = (item: Item, s: number): { w: number; h: number } => {
    const inner = innerSize(item, s);
    const [px, py] = padOf(item, s);
    return px || py ? { w: inner.w + px * 2, h: inner.h + py * 2 } : inner;
  };
  const memo = new Map<Item, { s: number; k: number; b: { w: number; h: number } }>();
  const sizeOf = (item: Item, s: number): { w: number; h: number } => {
    const m = memo.get(item);
    if (m && m.s === s && m.k === grow) return m.b;
    let b = ownSize(item, s);
    for (const o of alts.get(item) ?? []) {
      const a = ownSize(o, s);
      b = { w: Math.max(b.w, a.w), h: Math.max(b.h, a.h) };
    }
    memo.set(item, { s, k: grow, b });
    return b;
  };
  // Pictures and programs come at the size they are given, but never larger than the safe width on either side, so a
  // photo given at its pixel size does not shrink everything around it. Kits are fitted the same way by `natural`.
  const sized = (w: number, h: number) => {
    const f = Math.min(1, env.safe.w / Math.max(1, w), env.safe.w / Math.max(1, h));
    return { w: w * f, h: h * f };
  };
  const overlay = (item: Item) => item.kind === "run" && !!item.attrs.on && !item.attrs.w && !item.attrs.h;
  const isSubject = (item: Item) => !overlay(item) && (item.kind === "image" || (!SHAPE_KINDS.includes(item.kind) && !CONTAINER_KINDS.includes(item.kind) && !LEAF_KINDS.includes(item.kind)));
  // The subjects' own scale once they have grown (0 until then: they follow the board's scale).
  let grow = 0;
  const grown = new Set<string>();
  const scaleOf = (item: Item, s: number) => (grow && grown.has(item.id) ? grow : s);
  const innerSize = (item: Item, s: number): { w: number; h: number } => {
    const gap = n(item.attrs.gap, 44) * s;
    switch (item.kind) {
      case "atoms": {
        const size = TEXT_SIZE[item.size!]! * s;
        const space = n(item.attrs.gap, 0.26) * size;
        let w = 0;
        let h = size * 1.2;
        for (const p of item.parts!) {
          if (p.type === "text") w += atomWidth(p.atom, size, fontKey(item));
          if (p.type === "frac") {
            w += Math.max(list(p.num, size, fontKey(item)), list(p.den, size, fontKey(item))) + size * 0.3;
            h = Math.max(h, size * 2.5);
          }
          if (p.type === "matrix") {
            w += columns(p.rows, size, fontKey(item)).reduce((a, b) => a + b, 0) + size * 0.5;
            h = Math.max(h, p.rows.length * size * 1.3 + size * 0.3);
          }
        }
        return { w: w + space * Math.max(0, item.parts!.length - 1), h };
      }
      case "text": {
        const size = fontSize(item, TEXT_SIZE.normal!) * s;
        const lines = textLines(item);
        return { w: Math.max(...lines.map((l) => measure(l, size, fontKey(item)))), h: lines.length * size * 1.25 };
      }
      case "code": {
        const size = fontSize(item, CODE_SIZE) * s;
        return { w: Math.max(1, ...item.lines!.map((l) => measure(l, size, "mono"))), h: Math.max(1, item.lines!.length) * size * 1.45 };
      }
      case "image": {
        const b = sized(n(item.attrs.w, 700), n(item.attrs.h, 700));
        return { w: b.w * scaleOf(item, s), h: b.h * scaleOf(item, s) };
      }
      case "space":
        return { w: 1, h: n(item.attrs.h, 60) * s };
      case "row": {
        const c = item.children.map((x) => sizeOf(x, s));
        return { w: c.reduce((a, b) => a + b.w, 0) + gap * Math.max(0, c.length - 1), h: Math.max(0, ...c.map((x) => x.h)) };
      }
      case "stack": {
        const c = item.children.map((x) => sizeOf(x, s));
        return { w: Math.max(0, ...c.map((x) => x.w)), h: c.reduce((a, b) => a + b.h, 0) + gap * Math.max(0, c.length - 1) };
      }
      case "chain": {
        const c = item.children.map((x) => sizeOf(x, s));
        const across = item.attrs.dir === "right" || item.attrs.dir === "left";
        const step = n(item.attrs.gap, 86) * s;
        return across
          ? { w: c.reduce((a, b) => a + b.w, 0) + step * Math.max(0, c.length - 1), h: Math.max(0, ...c.map((x) => x.h)) }
          : { w: Math.max(0, ...c.map((x) => x.w)), h: c.reduce((a, b) => a + b.h, 0) + step * Math.max(0, c.length - 1) };
      }
      case "grid": {
        const { widths, heights } = gridSizes(item, s);
        return { w: widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1), h: heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, heights.length - 1) };
      }
      case "ring": {
        const cell = Math.max(0, ...item.children.map((x) => { const b = sizeOf(x, s); return Math.max(b.w, b.h); }));
        const d = ringRadius(item, cell, s) * 2 + cell;
        return { w: d, h: d };
      }
      case "free":
        return { w: n(item.attrs.w, 900) * s, h: n(item.attrs.h, 900) * s };
      case "stage":
        return { w: n(item.attrs.w, 900) * s, h: n(item.attrs.h, 1100) * s };
      case "board":
        return boardSize(item);
      case "run":
        if (overlay(item)) return { w: 0, h: 0 };
      // falls through
      default: {
        if (SHAPE_KINDS.includes(item.kind)) return shapeSize(item, s);
        const raw = env.natural(item);
        const b = item.kind === "run" ? sized(raw.w, raw.h) : raw;
        return { w: b.w * scaleOf(item, s), h: b.h * scaleOf(item, s) };
      }
    }
  };
  // A board is measured in screens (the safe area at rest), not scaled: it is larger than the frame on purpose.
  const boardSize = (item: Item) => ({ w: Math.max(0.1, n(item.attrs.w, 1)) * env.safe.w, h: Math.max(0.1, n(item.attrs.h, 1)) * env.safe.h });
  const ringRadius = (item: Item, cell: number, s: number) => {
    const count = Math.max(1, item.children.length);
    return item.attrs.size ? (n(item.attrs.size, 700) * s) / 2 : Math.max(cell * 0.85, (cell * 1.25) / (2 * Math.sin(Math.PI / Math.max(3, count))));
  };
  const gridSizes = (item: Item, s: number) => {
    const cols = Math.max(1, n(item.attrs.cols, 2));
    const sizes = item.children.map((x) => sizeOf(x, s));
    const widths = Array.from({ length: Math.min(cols, Math.max(1, sizes.length)) }, () => 0);
    const heights = Array.from({ length: Math.ceil(sizes.length / cols) }, () => 0);
    sizes.forEach((b, i) => {
      widths[i % cols] = Math.max(widths[i % cols]!, b.w);
      heights[Math.floor(i / cols)] = Math.max(heights[Math.floor(i / cols)]!, b.h);
    });
    return { widths, heights };
  };

  // Things that fill the frame take no room in the arrangement. They sit behind it, centered on the frame. Roles pass
  // down here, and a role that writes in capitals changes the words before anything is measured.
  const framed: Item[] = [];
  const problemsEarly: Problem[] = [];
  // A grid of words is a table, and with a design layer it is drawn the style's way: a header row, rules, stripes.
  const cols = (item: Item) => Math.max(1, n(item.attrs.cols, 2));
  const isTable = (item: Item, kids = item.children) => !!design && item.kind === "grid" && kids.length > cols(item) && kids.every((c) => (c.kind === "text" || c.kind === "atoms") && !c.attrs.back);
  // Inside a grid, a line that holds exactly as many values as the grid has columns is one row of it: an atom line
  // puts each atom in its own cell, and a row of words puts each word in its own cell. So a table is written a row per
  // line and its columns still line up. The line's id still names the whole row.
  const rowsOf = new Map<string, string[]>();
  const spread = (grid: Item): Item[] =>
    grid.children.flatMap((c) => {
      const n = cols(grid);
      if (n < 2) return [c];
      if (c.kind === "atoms" && c.parts!.length === n && c.parts!.every((p) => p.type === "text")) {
        rowsOf.set(c.id, c.parts!.map((p) => (p as { atom: Atom }).atom.id));
        return c.parts!.map((p) => ({ ...c, id: (p as { atom: Atom }).atom.id, parts: [p], children: [] }));
      }
      if (c.kind === "row" && c.children.length === n && c.children.every((x) => x.kind === "text" || x.kind === "atoms")) {
        rowsOf.set(c.id, c.children.map((x) => x.id));
        return c.children.map((x) => ({ ...x, attrs: { ...(c.attrs.role && !x.attrs.role ? { role: c.attrs.role } : {}), ...x.attrs } }));
      }
      return [c];
    });
  const upper = (a: Atom): Atom => ({ ...a, text: a.text.toUpperCase() });
  const pull = (list: Item[], role?: string): Item[] =>
    list.flatMap((i) => {
      const attrs = { ...i.attrs };
      if (!attrs.role && role) attrs.role = role;
      const pass = attrs.role && attrs.role !== "panel" ? attrs.role : undefined;
      // A table's first row is its header, in the style's header role, unless a cell names its own.
      const cells = i.kind === "grid" ? spread(i) : i.children;
      const kids = isTable(i, cells) ? cells.map((c, k) => (k < cols(i) && !c.attrs.role ? { ...c, attrs: { ...c.attrs, role: design!.elements.table.header } } : c)) : cells;
      const copy: Item = { ...i, attrs, children: pull(kids, pass) };
      const wr = wordRole(copy);
      if (wr && roleLook(theme, wr).case === "upper") {
        if (copy.text !== undefined) copy.text = copy.text.toUpperCase();
        if (copy.parts) copy.parts = copy.parts.map((p) => (p.type === "text" ? { type: "text", atom: upper(p.atom) } : p.type === "frac" ? { ...p, num: p.num.map(upper), den: p.den.map(upper) } : { ...p, rows: p.rows.map((r) => r.map(upper)) }));
      }
      if (attrs.frame === undefined) return [copy];
      framed.push(copy);
      return [];
    });
  items = pull(items);
  // The board of this state, when there is one. It is the whole frame, so it stands alone at the top of the state.
  const boardOf = (list: Item[]): Item | undefined => {
    const top = list.find((c) => c.kind === "board");
    const deep = (c: Item): Item | undefined => c.children.find((x) => x.kind === "board") ?? c.children.map(deep).find(Boolean);
    const nested = list.map(deep).find(Boolean);
    if (nested || (top && list.length > 1)) problemsEarly.push({ line: (nested ?? top)!.line, message: `A board is the whole frame: write it at the top of the state with nothing beside it, and put everything else inside it.` });
    return top && list.length === 1 && !nested ? top : undefined;
  };
  // The stretch, united: every thing any of its states shows, in order, each holding the room of its largest version.
  // Things that are never on the board together may share a place (one replaces the other); what this state does not
  // show is only room. A container whose things come in a different order in some state is laid out as it is.
  const ghost = new Set<Item>();
  const alts = new Map<Item, Item[]>();
  const slotsOf = (lists: Item[][]): string[][] | undefined => {
    const together = new Map<string, Set<string>>();
    for (const l of lists) for (const a of l) for (const b of l) if (a.id !== b.id) together.set(a.id, (together.get(a.id) ?? new Set()).add(b.id));
    const slots: string[][] = [];
    for (const l of lists) {
      const here = new Set(l.map((c) => c.id));
      let prev = -1;
      for (const c of l) {
        let at = slots.findIndex((x) => x.includes(c.id));
        if (at < 0) {
          const next = slots[prev + 1];
          at = prev + 1;
          if (next && !next.some((id) => here.has(id) || together.get(c.id)?.has(id))) next.push(c.id);
          else slots.splice(at, 0, [c.id]);
        }
        if (at <= prev) return undefined;
        prev = at;
      }
    }
    return slots;
  };
  const unite = (now: Item[] | undefined, lists: Item[][]): Item[] => {
    const slots = slotsOf(lists);
    if (!slots) return now ?? [];
    return slots.map((ids) => {
      const here = now?.find((c) => ids.includes(c.id));
      const all = lists.flatMap((l) => l.filter((c) => ids.includes(c.id)));
      const node: Item = { ...(here ?? all.at(-1)!) };
      if (!here) ghost.add(node);
      if (CONTAINER_KINDS.includes(node.kind)) node.children = unite(here?.children, all.filter((c) => c.id === node.id).map((c) => c.children));
      // A stage is solved with every relation its stretch states, so what stays keeps its place while things join it.
      if (node.kind === "stage") {
        const seen = new Set<string>();
        node.relations = all.filter((c) => c.id === node.id).flatMap((c) => c.relations ?? []).filter((r) => {
          const k = `${r.a} ${r.kind} ${r.b} ${r.at ?? ""} ${r.gapCm ?? ""}`;
          return !seen.has(k) && !!seen.add(k);
        });
      }
      alts.set(node, all);
      return node;
    });
  };
  const kept = framed.length;
  const versions = stretch && stretch.length > 1 ? stretch.map((b) => pull(b)) : undefined;
  framed.length = kept;
  const root: Item = { kind: "stack", id: "board", line: 0, attrs: {}, children: versions ? unite(items, versions) : items };
  const sheet = boardOf(root.children);
  let s = sheet ? Math.min(1, cap) : cap;
  let box = sizeOf(root, s);
  while (!sheet && (box.w > env.safe.w || box.h > env.safe.h) && s > MIN_SCALE) box = sizeOf(root, (s = Math.round((s - 0.02) * 100) / 100));

  // The subject grows: kits, graphs, programs and pictures down the main column take the room the words leave, as far
  // as the width allows, and then the words may grow a little, so a phone frame is used by what carries the idea.
  let members = 0;
  const subjects: Item[] = [];
  const along = (item: Item) => {
    for (const c of item.children) {
      if (c.kind === "stack" && !backOf(c)) along(c);
      else {
        members++;
        if (isSubject(c)) {
          grown.add(c.id);
          subjects.push(c);
        }
      }
    }
  };
  along(root);
  if (!sheet && grown.size && box.w <= env.safe.w && box.h <= env.safe.h) {
    const reserve = Math.max(members > 1 ? env.safe.h * BREATHE : 0, spare);
    const fits = (b: { w: number; h: number }) => b.w <= env.safe.w && b.h <= env.safe.h - reserve;
    // The largest value in steps of 0.01 from lo to hi that still fits, or lo when even lo does not.
    const most = (lo: number, hi: number, at: (v: number) => { w: number; h: number }) => {
      let [a, b] = [Math.round(lo * 100), Math.floor(hi * 100)];
      if (!fits(at(a / 100))) return lo;
      while (a < b) {
        const m = Math.ceil((a + b) / 2);
        if (fits(at(m / 100))) a = m;
        else b = m - 1;
      }
      return a / 100;
    };
    const text = Math.min(s, TEXT_GROW);
    grow = s;
    grow = most(s, SUBJECT_MAX, (v) => ((grow = v), sizeOf(root, text)));
    s = text < TEXT_GROW ? most(text, Math.min(cap, TEXT_GROW), (v) => sizeOf(root, v)) : text;
    box = sizeOf(root, s);
  }

  const out: Laid = { parts: [], boxes: new Map(), members: new Map(), slots: [], links: [], problems: [...problemsEarly], scale: s, smallest: Infinity, texts: [], fields: [], held: [] };
  if (!sheet && (box.w > env.safe.w || box.h > env.safe.h)) {
    const at = items[0]?.line ?? 0;
    out.problems.push({ line: at, message: `This state does not fit even at ${Math.round(MIN_SCALE * 100)}% size: it needs ${Math.round(box.w)} by ${Math.round(box.h)} of ${Math.round(env.safe.w)} by ${Math.round(env.safe.h)}. Remove something or split it.` });
  }

  // Fill the frame: a state that fits by its width leaves the height empty. The outer stack (or the one stack it holds)
  // opens its gaps so the state spreads over the safe area, up to a limit, so its parts still read as one picture.
  // Every stack down the main column (stacks inside stacks, not panels) shares the room, so things inside a group get
  // room around them too, for the tags and marks that come later.
  const column: Item[] = [];
  const down = (item: Item) => {
    if (item.kind !== "stack" || (item !== root && backOf(item))) return;
    if (item.children.length > 1) column.push(item);
    item.children.forEach(down);
  };
  down(root);
  const gaps = column.reduce((sum, x) => sum + x.children.length - 1, 0);
  const room = env.safe.h - box.h - spare;
  if (!sheet && gaps && room > 1) {
    // Outer gaps open more than inner ones, so groups still read as groups.
    const weight = (x: Item) => (x === root || (root.children.length === 1 && root.children[0] === x) ? 2 : 1);
    const total = column.reduce((sum, x) => sum + (x.children.length - 1) * weight(x), 0);
    // With a subject the gaps share one limit, since the subject already fills the frame; without one each may open.
    const unit = Math.min((room * 0.6) / total, (env.safe.h * SPREAD) / (subjects.length ? total : 2));
    for (const x of column) x.attrs = { ...x.attrs, gap: String(n(x.attrs.gap, 44) + (unit * weight(x)) / s) };
    memo.clear();
    box = sizeOf(root, s);
  }

  // The words that carry a moment (its title, a step's name, what to look at now, the result) must read at arm's
  // length on a phone, and words the scene asked to be big must not come out small: a state that only fits by shrinking
  // them is refused, so small text cannot happen by leaving the size to the layout.
  const told = new Set<string>();
  const seen = (size: number, line: number, item?: Item, content = "") => {
    if (size < out.smallest) out.smallest = size;
    if (size < env.minText - 0.5) {
      out.problems.push({ line, message: `Text here comes out only ${Math.round(size)} pixels tall; the smallest readable is ${Math.round(env.minText)}. This state holds too much to fit at a readable size: put less on screen at once, use shorter lines, or use a bigger size for this text.` });
      return;
    }
    if (!item || told.has(item.id)) return;
    const role = wordRole(item);
    const carrier = role && CARRIERS.has(role) ? (wordLook(item)?.size ?? 0) * short * 0.5 : 0;
    const asked = item.attrs.size !== undefined && (TEXT_SIZE[item.attrs.size] ?? 0) >= TEXT_SIZE.big! ? TEXT_SIZE[item.attrs.size]! * 0.5 : 0;
    const floor = Math.max(carrier, asked);
    if (size >= floor - 0.5) return;
    told.add(item.id);
    out.problems.push({ line, message: `"${content.slice(0, 40)}"${role ? ` (${role})` : ""} comes out only ${Math.round(size)} pixels tall, because this state is shrunk to fit; ${carrier >= asked ? `a ${role} carries the moment and needs` : "it was asked to be big and needs"} at least ${Math.round(floor)} to read at arm's length on a phone. Put fewer things side by side (a stack instead of a row), shorten the lines, or give the rest of the state its own moment.` });
  };
  const text = (id: string, item: Item, content: string, x: number, y: number, size: number, extra: Props = {}, parent?: string, origin = { x: 0, y: 0 }, back?: string) => {
    seen(size, item.line, item, content);
    const props: Props = { x: round(x), y: round(y), text: content, size: round(size), color: "ink", weight: 400, ...extra };
    out.parts.push({ id, kind: "text", line: item.line, ...(parent ? { parent } : {}), props });
    const w = measure(content, size, typeof props.font === "string" && /mono|menlo|courier/i.test(props.font) ? "mono" : props.font === theme.fonts.title ? "title" : undefined);
    const ax = origin.x + x;
    const mid = props.anchor === "start" ? ax + w / 2 : props.anchor === "end" ? ax - w / 2 : ax;
    out.texts.push({ id, box: { x: mid, y: origin.y + y, w, h: size * 1.15 }, line: item.line, text: content, size, item: item.id, ...(back ? { back } : {}) });
  };
  const rule = (id: string, points: number[], line: number, color: string) => out.parts.push({ id, kind: "path", line, props: { points: points.map(round), stroke: color, strokeWidth: 6 } });

  // A board: each child at at=X,Y (percent of the board from its top left, its center there, as in free), and the
  // others written down it in reading order, top to bottom like a stack, each at the size it has on a frame. Writing
  // that runs past the board's edges is reported, since a board never shrinks or reshuffles to make room.
  const placeBoard = (item: Item, cx: number, cy: number, size: { w: number; h: number }, s: number, back?: string) => {
    const [l, t] = [cx - size.w / 2, cy - size.h / 2];
    const gap = n(item.attrs.gap, 44) * s;
    let y = t;
    const spills: string[] = [];
    const inside = (c: Item, x: number, y: number) => {
      const b = ownSize(c, s);
      if (x - b.w / 2 < l - 1 || x + b.w / 2 > l + size.w + 1 || y - b.h / 2 < t - 1 || y + b.h / 2 > t + size.h + 1) spills.push(c.id);
    };
    for (const c of item.children) {
      const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(c.attrs.at ?? "");
      if (c.attrs.at !== undefined && !m) out.problems.push({ line: c.line, message: `On a board, at= is X,Y in percent of the board from its top left, as in at=30,70, not ${c.attrs.at}.` });
      if (m) {
        const [x, yy] = [l + (Number(m[1]) / 100) * size.w, t + (Number(m[2]) / 100) * size.h];
        if (!ghost.has(c)) inside(c, x, yy);
        place(c, x, yy, s, back);
        continue;
      }
      const b = sizeOf(c, s);
      const own = ownSize(c, s);
      const x = item.attrs.align === "left" ? l + own.w / 2 : item.attrs.align === "right" ? l + size.w - own.w / 2 : cx;
      const at = y + Math.min(b.h, own.h) / 2;
      if (!ghost.has(c)) inside(c, x, at);
      place(c, x, at, s, back);
      y += b.h + gap;
    }
    if (spills.length) out.problems.push({ line: item.line, message: `On the board ${item.id}, ${spills.slice(0, 3).join(", ")} ${spills.length > 1 ? "run" : "runs"} past its edge. A board keeps everything at the size it has on a frame and never reshuffles: make it larger (w= and h= are in screens), put the writing at another at=, or put less on it.` });
  };
  const place = (item: Item, cx: number, cy: number, s: number, behind?: string) => {
    // What this state does not show only holds its room. What it shows is drawn at its own size in the room it holds.
    if (ghost.has(item)) {
      out.held.push({ x: cx, y: cy, ...ownSize(item, s) });
      return;
    }
    const outer = ownSize(item, s);
    out.boxes.set(item.id, { x: cx, y: cy, w: outer.w, h: outer.h });
    const [padX, padY] = padOf(item, s);
    const pad = padX || padY;
    const own = backOf(item);
    // How far a caption's words sit right of center, clear of its rule, and how far it leans.
    let shiftX = 0;
    let lean: number | undefined;
    if (pad && own && design && isCaption(item)) {
      const e = design.elements.caption;
      const ruled = e.rule !== "none" && e.ruleWidth > 0;
      lean = e.rotate || undefined;
      const turn: Props = lean ? { rotate: lean } : {};
      out.parts.push({ id: `${item.id}.back`, kind: "path", line: item.line, props: { x: round(cx), y: round(cy), ...turn, points: rect(outer.w, outer.h), closed: 1, fill: own, stroke: e.edge === "none" ? "none" : e.edge, strokeWidth: 3, glowLevel: 0, z: -1 } });
      if (ruled) out.parts.push({ id: `${item.id}.rule`, kind: "path", line: item.line, props: { x: round(cx), y: round(cy), ...turn, points: rect(e.ruleWidth, outer.h, -outer.w / 2 + e.ruleWidth / 2), closed: 1, fill: e.rule, stroke: "none", z: -1 } });
      shiftX = ruled ? e.ruleWidth / 2 : 0;
    } else if (pad && own && design) {
      // The style's panel: its surface, corner, edge, shadow and lean.
      const p = design.elements.panel;
      const look = roleLook(theme, "panel");
      const edge: Props = p.edge === "none" || p.edgeWidth <= 0 ? { stroke: "none" } : { stroke: p.edge, strokeWidth: round(p.edgeWidth * (look.stroke ?? 1)) };
      const shadow: Props = p.shadow ? { shadowX: round(7 * p.shadow), shadowY: round(9 * p.shadow), shadowBlur: 0, shadowOpacity: p.shadow, shadowColor: colorOf(theme, "ink")! } : {};
      out.parts.push({ id: `${item.id}.back`, kind: "path", line: item.line, props: { x: round(cx), y: round(cy), ...(p.rotate ? { rotate: p.rotate } : {}), points: roundedBox(outer.w, outer.h, Math.max(0.5, Math.min(outer.w, outer.h) * p.radius)).map(round), closed: 1, fill: own, ...edge, glowLevel: look.glow ?? 0, z: -1, ...shadow } });
    } else if (pad && own) {
      const look = lookOf(item);
      const outline: Props = item.attrs.role === "panel" && look?.stroke ? { stroke: look.color ?? "ink", strokeWidth: round(4 * look.stroke * s) } : { stroke: "none" };
      out.parts.push({ id: `${item.id}.back`, kind: "path", line: item.line, props: { x: round(cx), y: round(cy), points: roundedBox(outer.w, outer.h, Math.min(outer.w, outer.h) * (item.kind === "text" || item.kind === "atoms" ? 0.18 : 0.06)).map(round), closed: 1, fill: own, ...outline, z: -1, shadowY: round(14 * s), shadowBlur: round(36 * s), shadowOpacity: 0.3, shadowColor: "#000000" } });
    }
    const back = own ?? behind;
    const size = pad ? { w: outer.w - padX * 2, h: outer.h - padY * 2 } : outer;
    const gap = n(item.attrs.gap, 44) * s;
    const members = (ids: string[]) => out.members.set(item.id, ids);
    switch (item.kind) {
      case "atoms": {
        const fs = TEXT_SIZE[item.size!]! * s;
        const extra: Props = { ...(item.size === "note" ? { opacity: 0.75 } : {}), ...textLook(item, back, fs), ...look(item, ["rotate"]) };
        const ink = String(extra.color ?? "ink");
        const ids: string[] = [];
        const put = (a: Atom, x: number, y: number) => {
          const w = atomWidth(a, fs, fontKey(item));
          ids.push(a.id);
          text(a.id, item, a.text, x + w / 2, y, fs, extra, undefined, undefined, back);
          out.boxes.set(a.id, { x: x + w / 2, y, w, h: fs * 1.15 });
        };
        const space = n(item.attrs.gap, 0.26) * fs;
        let x = cx - size.w / 2 + shiftX;
        for (const p of item.parts!) {
          if (p.type === "text") {
            put(p.atom, x, cy);
            x += atomWidth(p.atom, fs, fontKey(item));
          }
          if (p.type === "frac") {
            const fw = Math.max(list(p.num, fs, fontKey(item)), list(p.den, fs, fontKey(item))) + fs * 0.3;
            const row = (a: Atom[], y: number) => {
              let ax = x + (fw - list(a, fs, fontKey(item))) / 2;
              for (const t of a) {
                put(t, ax, y);
                ax += atomWidth(t, fs, fontKey(item)) + fs * 0.16;
              }
            };
            row(p.num, cy - fs * 0.68);
            row(p.den, cy + fs * 0.68);
            const bar = `bar.${p.num[0]!.id}`;
            rule(bar, [x, cy, x + fw, cy], item.line, ink);
            ids.push(bar);
            x += fw;
          }
          if (p.type === "matrix") {
            const cols = columns(p.rows, fs, fontKey(item));
            const tw = cols.reduce((a, b) => a + b, 0) + fs * 0.5;
            const th = p.rows.length * fs * 1.3;
            const top = cy - th / 2;
            const key = p.rows[0]![0]!.id;
            const hook = p.bars ? 0 : fs * 0.2;
            rule(`lb.${key}`, p.bars ? [x, top, x, top + th] : [x + hook, top, x, top, x, top + th, x + hook, top + th], item.line, ink);
            rule(`rb.${key}`, p.bars ? [x + tw, top, x + tw, top + th] : [x + tw - hook, top, x + tw, top, x + tw, top + th, x + tw - hook, top + th], item.line, ink);
            ids.push(`lb.${key}`, `rb.${key}`);
            p.rows.forEach((r, ri) => {
              let c = x + fs * 0.25;
              r.forEach((a, ci) => {
                const w = atomWidth(a, fs, fontKey(item));
                put(a, c + (cols[ci]! - w) / 2, top + (ri + 0.5) * fs * 1.3);
                c += cols[ci]!;
              });
            });
            x += tw;
          }
          x += space;
        }
        members(ids);
        return;
      }
      case "text": {
        const fs = fontSize(item, TEXT_SIZE.normal!) * s;
        const lines = textLines(item);
        const left = item.attrs.align === "left";
        const extra: Props = { ...textLook(item, back, fs), ...(left ? { anchor: "start" } : {}) };
        const dx = (left ? -size.w / 2 : 0) + shiftX;
        // Always a group with one part per line, so a text can grow or shrink a line without changing what it is.
        out.parts.push({ id: item.id, kind: "group", line: item.line, props: { x: round(cx), y: round(cy), ...(lean ? { rotate: lean } : {}), ...look(item, ["rotate"]) } });
        lines.forEach((l, i) => text(`${item.id}.l${i + 1}`, item, l, dx, (i - (lines.length - 1) / 2) * fs * 1.25, fs, extra, item.id, { x: cx, y: cy }, back));
        return;
      }
      case "code": {
        const fs = fontSize(item, CODE_SIZE) * s;
        const font = env.theme.fonts.mono ?? "Menlo, monospace";
        const tone = textLook(item, back, fs);
        out.parts.push({ id: item.id, kind: "group", line: item.line, props: { x: round(cx), y: round(cy) } });
        item.lines!.forEach((l, i) => {
          const pad = l.length - l.trimStart().length;
          const id = `${item.id}.${i + 1}`;
          const y = (i - (item.lines!.length - 1) / 2) * fs * 1.45;
          text(id, item, l.trim() || " ", -size.w / 2 + pad * fs * 0.6, y, fs, { ...tone, anchor: "start", font }, item.id, { x: cx, y: cy }, back);
          out.boxes.set(id, { x: cx, y: cy + y, w: size.w, h: fs * 1.3 });
        });
        return;
      }
      case "image":
        // Always in front of the panel it sits on, whatever it was before, so a card never covers its own picture.
        out.parts.push({ id: item.id, kind: "image", line: item.line, props: { x: round(cx), y: round(cy), w: round(size.w), h: round(size.h), src: item.attrs.asset ?? "", z: 0, ...pictureLook(theme, item.id, "page", look(item, ["rotate"])), ...look(item, ["opacity", "rotate"]) } });
        out.fields.push({ id: item.id, box: { x: cx, y: cy, w: size.w, h: size.h }, line: item.line, picture: true, frame: false });
        return;
      case "space":
        return;
      case "row": {
        let x = cx - size.w / 2;
        for (const c of item.children) {
          const b = sizeOf(c, s);
          const own = ownSize(c, s);
          const y = item.attrs.align === "top" ? cy - size.h / 2 + own.h / 2 : item.attrs.align === "bottom" ? cy + size.h / 2 - own.h / 2 : cy;
          place(c, x + b.w / 2, y, s, back);
          x += b.w + gap;
        }
        return;
      }
      case "stack": {
        let y = cy - size.h / 2;
        // Each thing sits at the top of the room it holds, so words that grow by a line grow downward.
        for (const c of item.children) {
          const b = sizeOf(c, s);
          const own = ownSize(c, s);
          const x = item.attrs.align === "left" ? cx - size.w / 2 + own.w / 2 : item.attrs.align === "right" ? cx + size.w / 2 - own.w / 2 : cx;
          place(c, x, y + Math.min(b.h, own.h) / 2, s, back);
          y += b.h + gap;
        }
        return;
      }
      case "chain": {
        const dir = item.attrs.dir ?? "down";
        const across = dir === "right" || dir === "left";
        const step = n(item.attrs.gap, 86) * s;
        const ordered = dir === "left" || dir === "up" ? [...item.children].reverse() : item.children;
        let p = across ? cx - size.w / 2 : cy - size.h / 2;
        for (const c of ordered) {
          const b = sizeOf(c, s);
          if (across) place(c, p + b.w / 2, cy, s, back);
          else place(c, cx, p + b.h / 2, s, back);
          p += (across ? b.w : b.h) + step;
        }
        const shown = item.children.filter((c) => !ghost.has(c));
        shown.slice(1).forEach((c, i) => out.links.push({ from: shown[i]!.id, to: c.id, line: item.line }));
        return;
      }
      case "grid": {
        const { widths, heights } = gridSizes(item, s);
        item.children.forEach((c, i) => {
          const col = i % Math.max(1, n(item.attrs.cols, 2));
          const row = Math.floor(i / Math.max(1, n(item.attrs.cols, 2)));
          const x = cx - size.w / 2 + widths.slice(0, col).reduce((a, b) => a + b + gap, 0) + widths[col]! / 2;
          const y = cy - size.h / 2 + heights.slice(0, row).reduce((a, b) => a + b + gap, 0) + heights[row]! / 2;
          place(c, x, y, s, back);
        });
        if (isTable(item)) {
          // The style's table: a rule under the header, under every row, or between every cell, and stripes on
          // alternate rows, all behind the words.
          const t = design!.elements.table;
          // Rules and stripes only as far as the rows this state shows; the rest of the table is room for rows to come.
          const last = Math.floor(item.children.reduce((m, c, i) => (ghost.has(c) ? m : i), -1) / cols(item));
          const [l, r, top] = [cx - size.w / 2 - gap / 2, cx + size.w / 2 + gap / 2, cy - size.h / 2];
          const below = (row: number) => top + heights.slice(0, row + 1).reduce((a, b) => a + b + gap, 0) - gap / 2;
          const line = (id: string, pts: number[], w: number) => out.parts.push({ id, kind: "path", line: item.line, props: { points: pts.map(round), stroke: t.rule, strokeWidth: round(w), glowLevel: 0.3, z: -1 } });
          if (t.zebra !== "none") for (let row = 2; row <= last; row += 2) out.parts.push({ id: `${item.id}.zebra${row}`, kind: "path", line: item.line, props: { x: round(cx), y: round(below(row) - (heights[row]! + gap) / 2), points: rect(r - l, heights[row]! + gap), closed: 1, fill: t.zebra, stroke: "none", z: -1 } });
          if (t.lines !== "none") line(`${item.id}.rule0`, [l, below(0), r, below(0)], t.ruleWidth * 1.5);
          if (t.lines === "rows" || t.lines === "grid") for (let row = 1; row < last; row++) line(`${item.id}.rule${row}`, [l, below(row), r, below(row)], t.ruleWidth);
          if (t.lines === "grid") for (let col = 1; col < widths.length; col++) {
            const x = cx - size.w / 2 + widths.slice(0, col).reduce((a, b) => a + b + gap, 0) - gap / 2;
            line(`${item.id}.col${col}`, [x, top - gap / 2, x, below(last) + gap / 2], t.ruleWidth);
          }
        }
        return;
      }
      case "ring": {
        const cell = Math.max(0, ...item.children.map((x) => { const b = sizeOf(x, s); return Math.max(b.w, b.h); }));
        const r = ringRadius(item, cell, s);
        item.children.forEach((c, i) => {
          const a = -Math.PI / 2 + (i / item.children.length) * Math.PI * 2;
          place(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, s, back);
        });
        const shown = item.children.filter((c) => !ghost.has(c));
        if (item.attrs.arrows) shown.forEach((c, i) => out.links.push({ from: c.id, to: shown[(i + 1) % shown.length]!.id, line: item.line }));
        return;
      }
      case "board":
        placeBoard(item, cx, cy, size, s, back);
        return;
      case "free": {
        for (const c of item.children) {
          const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(c.attrs.at ?? "");
          if (!m) {
            out.problems.push({ line: c.line, message: `Inside free, ${c.id} needs at=X,Y, in percent of the free area from its top left, as in at=30,70.` });
            continue;
          }
          place(c, cx - size.w / 2 + (Number(m[1]) / 100) * size.w, cy - size.h / 2 + (Number(m[2]) / 100) * size.h, s, back);
        }
        return;
      }
      case "stage": {
        // One scene, solved by its relations at one real scale (engine/design/abilities/scene.ts), then fitted to the
        // stage's box. Each thing is drawn at the scale the scene gives it, so a lake stays wider than a dock.
        const kids = item.children;
        const nat = kids.map((c) => sizeOf(c, s));
        const ids = new Set(kids.map((c) => c.id));
        const things: SceneThing[] = kids.map((c, i) => {
          const t = env.thing?.(c);
          const { w, h } = nat[i]!;
          const cm = /^([\d.]+)(?:,([\d.]+))?$/.exec(c.attrs.cm ?? "");
          const realCm = t?.realCm ?? (cm ? { w: Number(cm[1]), h: Number(cm[2] ?? (Number(cm[1]) * h) / Math.max(1, w)) } : undefined);
          return { id: c.id, w: Math.max(1, w), h: Math.max(1, h), ...(realCm ? { realCm } : {}), point: (name: string) => {
            const f = t?.point?.(name);
            return f ? [(f[0] - 0.5) * w, (f[1] - 1) * h] : boxPoint(w, h, name);
          } };
        });
        const rels = (item.relations ?? []).filter((r) => {
          const missing = [r.a, r.b].filter((x) => !ids.has(x));
          if (missing.length) out.problems.push({ line: r.line, message: `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not in the stage ${item.id}. A relation joins two things of the same stage; its things are ${[...ids].join(", ") || "none yet"}.` });
          return !missing.length;
        });
        const lay = solveScene(things, rels.map((r) => ({ a: r.a, b: r.b, kind: r.kind as RelationKind, words: r.words, ...(r.at ? { at: r.at } : {}), ...(r.gapCm !== undefined ? { gapCm: r.gapCm } : {}) })), { gap: n(item.attrs.gap, 0.15) });
        const focus = item.attrs.focus && ids.has(item.attrs.focus) ? { id: item.attrs.focus, share: n(item.attrs.share, 0.5) } : undefined;
        const fit = fitScene(lay, things, size, { bleed: item.attrs.bleed !== "no", margin: n(item.attrs.margin, 0.15), ...(focus ? { focus } : {}) });
        for (const c of lay.checks) if (!c.held) out.problems.push({ line: c.rel.words ? rels.find((r) => r.a === c.rel.a && r.b === c.rel.b)?.line ?? item.line : item.line, message: `${c.rel.a} ${c.rel.words} ${c.rel.b} cannot hold: it is ${Math.round(c.offCm)} cm off, because another relation already places ${c.rel.a} and ${c.rel.b} differently. Keep the relations that say where each thing really is, and drop or change the one that disagrees.` });
        for (const x of lay.notes.filter((x) => !/cm off/.test(x))) (out.notes ??= []).push(`stage ${item.id}: ${x}`);
        const top = cy - fit.h / 2;
        for (const m of fit.members) {
          const i = kids.findIndex((c) => c.id === m.id);
          const c = kids[i]!;
          const k = m.w / Math.max(1, nat[i]!.w);
          place(c, cx + m.dx, top + m.dy - m.h / 2, s * k, back);
        }
        return;
      }
      default: {
        if (SHAPE_KINDS.includes(item.kind)) {
          const b = shapeSize(item, s);
          // With a design layer a shape that names no look is made of the style's panel: its surface and its edge.
          const role = lookOf(item) ?? (design && item.kind !== "dot" ? roleLook(theme, "panel") : undefined);
          const fill = item.attrs.fill ?? role?.back ?? (item.kind === "dot" ? "ink" : "paper");
          // Everything placed has a size a viewer can see, like words have a size they can read.
          const least = env.minText * 0.75;
          if (Math.max(b.w, b.h) < least) out.problems.push({ line: item.line, message: `${item.id} comes out only ${Math.round(b.w)} by ${Math.round(b.h)} pixels, too small to see; a shape or mark needs at least ${Math.round(least)} pixels across. Give it a bigger w and h, or put less on screen at once.` });
          const opacity: Props = item.attrs.opacity === undefined && role?.opacity !== undefined ? { opacity: role.opacity } : {};
          out.parts.push({ id: item.id, kind: "group", line: item.line, props: { x: round(cx), y: round(cy), ...look(item, ["opacity", "rotate"]), ...opacity } });
          out.parts.push({ id: `${item.id}.shape`, kind: "path", parent: item.id, line: item.line, props: { points: shapePoints(item.kind, b.w, b.h).map(round), closed: 1, fill, stroke: item.attrs.stroke ?? (item.kind === "dot" ? "none" : role?.color ?? "ink"), strokeWidth: round(n(item.attrs.strokeWidth, 6) * (role?.stroke ?? 1)), ...(design ? { glowLevel: role?.glow ?? 0.6 } : {}) } });
          const { opacity: _, glow: __, glowColor: ___, ...tone } = textLook(item, fill, b.size);
          b.label.forEach((l, i) => text(i ? `${item.id}.label${i + 1}` : `${item.id}.label`, item, l, 0, (i - (b.label.length - 1) / 2) * b.size * 1.2, b.size, { ...tone, ...look(item, ["weight"]) }, item.id, { x: cx, y: cy }, fill));
          return;
        }
        out.slots.push({ item, box: { x: cx, y: cy, w: size.w, h: size.h }, scale: scaleOf(item, s) });
      }
    }
  };
  for (const f of framed) {
    const mode = f.attrs.frame;
    if (mode !== "fill" && mode !== "fit") {
      out.problems.push({ line: f.line, message: `frame is fill (cover the whole frame, cropping what spills over) or fit (show all of it as large as it goes), not ${mode}.` });
      continue;
    }
    const isShape = SHAPE_KINDS.includes(f.kind);
    if (f.kind !== "image" && !isShape) {
      out.problems.push({ line: f.line, message: `Only images and shapes can fill the frame; ${f.id} is a ${f.kind}.` });
      continue;
    }
    const [w0, h0] = [n(f.attrs.w, env.W), n(f.attrs.h, env.H)];
    const k = mode === "fill" ? Math.max(env.W / w0, env.H / h0) : Math.min(env.W / w0, env.H / h0);
    const [w, h] = isShape && mode === "fill" ? [env.W, env.H] : [w0 * k, h0 * k];
    const [cx, cy] = [env.W / 2, env.H / 2];
    out.boxes.set(f.id, { x: cx, y: cy, w, h });
    if (f.kind === "image") {
      out.parts.push({ id: f.id, kind: "image", line: f.line, props: { x: cx, y: cy, w: round(w), h: round(h), src: f.attrs.asset ?? "", z: -2, ...pictureLook(theme, f.id, mode === "fill" ? "fill" : "fit"), ...look(f, ["opacity", "rotate"]) } });
      out.fields.push({ id: f.id, box: { x: cx, y: cy, w, h }, line: f.line, picture: true, frame: true });
    } else {
      const fill = f.attrs.fill ?? lookOf(f)?.back ?? "paper";
      out.parts.push({ id: f.id, kind: "group", line: f.line, props: { x: cx, y: cy, z: -2, ...look(f, ["opacity"]) } });
      out.parts.push({ id: `${f.id}.shape`, kind: "path", parent: f.id, line: f.line, props: { points: (f.kind === "box" ? [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2] : shapePoints(f.kind, w, h)).map(round), closed: 1, fill, stroke: f.attrs.stroke ?? "none", strokeWidth: n(f.attrs.strokeWidth, 6) } });
      out.fields.push({ id: f.id, box: { x: cx, y: cy, w, h }, line: f.line, picture: false, frame: true, fill });
      if (f.text) text(`${f.id}.label`, f, f.text, 0, 0, fontSize(f, TEXT_SIZE.big!), textLook(f, fill, fontSize(f, TEXT_SIZE.big!)), f.id, { x: cx, y: cy }, fill);
    }
  }
  // Content sits a little above the middle, with the free space shared around it. With a subject, what the subject shows
  // sits there (just above the middle of the safe area) and the rest arranges around it, as far as the frame allows: a
  // title goes up and what comes under it goes down, rather than everything floating high.
  const { safe } = env;
  let cy = safe.y - Math.max(0, safe.h - box.h) * 0.08;
  const main = subjects.reduce<Item | undefined>((best, x) => (!best || sizeOf(x, s).w * sizeOf(x, s).h > sizeOf(best, s).w * sizeOf(best, s).h ? x : best), undefined);
  const spot = (item: Item, at: number): number | undefined => {
    if (item === main) return at + (main.kind !== "image" && main.kind !== "run" ? (env.natural(main).rest ?? 0) * ownSize(main, s).h : 0);
    if (item.kind !== "stack" || (item !== root && backOf(item))) return undefined;
    let y = at - ownSize(item, s).h / 2;
    for (const c of item.children) {
      const b = sizeOf(c, s);
      const found = spot(c, y + Math.min(b.h, ownSize(c, s).h) / 2);
      if (found !== undefined) return found;
      y += b.h + n(item.attrs.gap, 44) * s;
    }
  };
  const anchor = () => {
    const offset = main && box.h < safe.h ? spot(root, 0) : undefined;
    if (offset !== undefined) cy = Math.min(safe.y + (safe.h - box.h) / 2, Math.max(safe.y - (safe.h - box.h) / 2, safe.y - safe.h * 0.02 - offset));
    return offset !== undefined;
  };
  // Then the room left above and below goes between the subject and what is above and below it, so the words move out
  // toward the edges of the frame (never onto them) and the subject keeps the middle.
  const holds = (item: Item): boolean => item === main || item.children.some(holds);
  const holder = root.children.findIndex(holds);
  if (!sheet && anchor() && holder >= 0) {
    const [free0, free1] = [cy - box.h / 2 - (safe.y - safe.h / 2), safe.y + safe.h / 2 - (cy + box.h / 2)];
    const keep = Math.min(1, spare / Math.max(1, free0 + free1));
    const [above, below] = [free0 * (1 - keep), free1 * (1 - keep)];
    const gap = n(root.attrs.gap, 44) * s;
    const spacer = (room: number, at: number): Item => ({ kind: "space", id: `board.space${at}`, line: 0, attrs: { h: String(Math.max(0, Math.min(room * 0.6, safe.h * 0.15) - gap) / s) }, children: [] });
    const list = [...root.children];
    if (holder < list.length - 1 && below > gap) list.splice(holder + 1, 0, spacer(below, 1));
    if (holder > 0 && above > gap) list.splice(holder, 0, spacer(above, 0));
    if (list.length !== root.children.length) {
      root.children = list;
      memo.clear();
      box = sizeOf(root, s);
      anchor();
    }
  }
  // A board's top left screen is the frame at rest: the camera finds the rest of it.
  if (sheet) place(root, safe.x - safe.w / 2 + box.w / 2, safe.y - safe.h / 2 + box.h / 2, s);
  else place(root, safe.x, cy, s);
  for (const id of ["board", "board.space0", "board.space1"]) if (id !== sheet?.id) out.boxes.delete(id);
  const leaves = (item: Item): string[] => (item.kind === "atoms" ? out.members.get(item.id) ?? [] : item.children.length ? item.children.flatMap(leaves) : [item.id]);
  const walk = (item: Item) => {
    if (item.children.length) out.members.set(item.id, leaves(item));
    item.children.forEach(walk);
  };
  items.forEach(walk);
  // A row spread over a grid's cells is still one thing: its id names all of its cells and the box around them.
  for (const [row, cells] of rowsOf) {
    const boxes = cells.map((c) => out.boxes.get(c)).filter((b): b is Box => !!b);
    if (!boxes.length) continue;
    out.members.set(row, cells.flatMap((c) => out.members.get(c) ?? [c]));
    const [l, r] = [Math.min(...boxes.map((b) => b.x - b.w / 2)), Math.max(...boxes.map((b) => b.x + b.w / 2))];
    const [t, d] = [Math.min(...boxes.map((b) => b.y - b.h / 2)), Math.max(...boxes.map((b) => b.y + b.h / 2))];
    out.boxes.set(row, { x: (l + r) / 2, y: (t + d) / 2, w: r - l, h: d - t });
  }
  return out;
}

// A deterministic layout for a graph, in a 1000 by 1000 box: start on a circle, then let edges pull and nodes push.
export function graphPositions(ids: string[], edges: { from: string; to: string }[], size = 1000, radius = 62): Map<string, { x: number; y: number }> {
  const p = ids.map((_, i) => {
    const a = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
    return { x: Math.cos(a) * 300, y: Math.sin(a) * 300 };
  });
  const at = new Map(ids.map((id, i) => [id, i]));
  const k = Math.sqrt((size * size) / Math.max(1, ids.length)) * 0.75;
  for (let step = 0; step < 300; step++) {
    const force = p.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < p.length; i++) {
      for (let j = 0; j < p.length; j++) {
        if (i === j) continue;
        const [dx, dy] = [p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y];
        const d = Math.max(1, Math.hypot(dx, dy));
        force[i]!.x += (dx / d) * (k * k) / d;
        force[i]!.y += (dy / d) * (k * k) / d;
      }
    }
    for (const e of edges) {
      const [a, b] = [at.get(e.from)!, at.get(e.to)!];
      const [dx, dy] = [p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y];
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d * d) / k;
      force[a]!.x -= (dx / d) * f;
      force[a]!.y -= (dy / d) * f;
      force[b]!.x += (dx / d) * f;
      force[b]!.y += (dy / d) * f;
    }
    const cool = 40 * (1 - step / 300) + 1;
    p.forEach((q, i) => {
      const m = Math.max(1, Math.hypot(force[i]!.x, force[i]!.y));
      q.x += (force[i]!.x / m) * Math.min(m, cool);
      q.y += (force[i]!.y / m) * Math.min(m, cool);
    });
  }
  const [minX, maxX] = [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x))];
  const [minY, maxY] = [Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y))];
  const scale = (size - radius * 2) / Math.max(1, maxX - minX, maxY - minY);
  return new Map(ids.map((id, i) => [id, { x: Math.round((p[i]!.x - (minX + maxX) / 2) * scale), y: Math.round((p[i]!.y - (minY + maxY) / 2) * scale) }]));
}
