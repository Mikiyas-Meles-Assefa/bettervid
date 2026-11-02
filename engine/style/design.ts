// The design layer of a style: what each role looks like, which words may sit on which surfaces, what panels, captions,
// tables, pointers, highlights and dimming look like, and how pictures are treated so real and generated ones match.
//
// A scene names a role ("this is the answer"); the style decides the look. Every pairing a style allows is checked
// against the surface as it is really drawn, texture and light included, so a style that could put unreadable words on
// screen is refused here, with a message that says exactly what to change.
import { ROLES, type Role, type RoleLook, type StyleSpec, type Theme } from "../core/types.ts";
import { blend, contrast } from "./color.ts";
import { paintSurface } from "./paint.ts";

export type RoleSpec = {
  color: string; // a color name from palette or design.colors
  back?: string; // the surface it brings with it, a color name listed in design.surfaces
  step?: number; // place on the type scale: size = scale.base * scale.ratio ^ step
  weight?: number;
  font?: "title" | "body" | "mono";
  case?: "asis" | "upper";
  glow?: number; // 0 to 1
  opacity?: number; // 0 to 1, for muted only, and kept high: a style steps back with color first
  stroke?: number; // line weight multiplier, for pointers and panel edges
};
// A surface words can sit on. `text` is the ink for anything placed on it; `roles` keep their own color there.
export type SurfaceRule = { text: string; roles: Role[] };
export type Elements = {
  panel: { radius: number; edge: string; edgeWidth: number; shadow: number; rotate: number; pad: number };
  caption: { rotate: number; pad: number; rule: string; ruleWidth: number; edge: string };
  label: { back: string; leader: string; leaderWidth: number }; // back: what a label sits on over a picture
  table: { lines: "none" | "header" | "rows" | "grid"; rule: string; ruleWidth: number; header: Role; zebra: string };
  pointer: { head: "open" | "solid" | "none"; ring: "hand" | "clean"; width: number };
  highlight: { kind: "marker" | "underline" | "ring" | "box" | "glow"; color: string; opacity: number };
  dim: { amount: number; keepHue: boolean; glow: number; stroke: number };
};
export type Picture = { saturation: number; contrast: number; brightness: number; tint: string; tintAmount: number; border: string; borderWidth: number; shadow: number; rotate: number };
export type Design = {
  colors: Record<string, string>;
  scale: { base: number; ratio: number };
  roles: Record<Role, RoleSpec>;
  surfaces: Record<string, SurfaceRule>;
  elements: Elements;
  picture: Picture;
};

export const TEXT_ROLES: Role[] = ROLES.filter((r) => r !== "panel" && r !== "pointer");
// Shares of the frame's shorter side. Large text may read at a lower contrast, as in WCAG (18 pt on a phone).
export const LARGE = 0.06;
const STEPS = [-2, 6] as const;
const HEX = /^#[0-9a-f]{6}$/i;

// The contrast a role needs. Muted is context that stays but steps back, and pointers are marks, not words (WCAG 1.4.11).
export function needOf(role: Role, size: number): number {
  if (role === "muted" || role === "pointer" || role === "wrong") return 3;
  return size >= LARGE ? 3 : 4.5;
}

export const sizeOf = (d: Pick<Design, "scale">, step: number) => Math.round(d.scale.base * d.scale.ratio ** step * 10000) / 10000;

type Palette = Record<string, string>;

// Fine texture counts by what it does inside a letter's stroke, about 7 px across at body size, not pixel by pixel:
// grain specks are a pixel or two, grid lines are hairlines. Checked against rendered surfaces averaged over 7 px
// (engine/style/proof.ts --surfaces): at worst, specks fill about half a stroke, and a word may sit where two grid
// lines (a minor and a major one) cross.
const STROKE = 7;
const GRAIN_COVER = 0.5;

export function pageSamples(style: StyleSpec, colors: Palette): string[] {
  const s = paintSurface(style, colors.paper!, { colors } as Theme);
  let out = [s.color];
  const add = (layer: { color: string; opacity: number } | undefined, cover = 1) => {
    if (layer) out = out.flatMap((c) => [c, blend(c, layer.color, Math.min(1, layer.opacity * cover))]);
  };
  add(s.light);
  add(s.smudge);
  if (s.grain) out = out.map((c) => blend(c, s.grain!.color, s.grain!.opacity * GRAIN_COVER));
  if (s.grid) {
    const g = s.grid;
    const union = (w: number) => (2 * w * STROKE - w * w) / (STROKE * STROKE); // a cross of two lines inside the window
    const crossing = Math.min(1, union(1.4) * g.opacity + (g.major ? union(3) * g.opacity * 1.5 : 0));
    out = out.flatMap((c) => [c, blend(c, g.color, crossing)]);
  }
  return [...new Set(out)];
}

// The colors inside a filled shape of this color as the style draws it on the page: the body under the texture
// (the fill's `base` lets the page through) and the hatch or scribble strokes in the full color.
export function fillSamples(color: string, style: StyleSpec, page: string[]): string[] {
  const out = page.map((p) => blend(color, p, 1 - style.fill.base));
  if (style.fill.kind !== "solid") out.push(color);
  return [...new Set(out)];
}

export function surfaceSamples(name: string, style: StyleSpec, colors: Palette): string[] {
  const page = pageSamples(style, colors);
  return name === "paper" ? page : fillSamples(colors[name]!, style, page);
}

// Chalk and dry ink drop specks from letters, which lets the surface through a little.
const textSamples = (color: string, style: StyleSpec, surface: string[]) => [color, ...surface.map((s) => blend(color, s, style.type.grain * 0.5))];

export const worst = (a: string[], b: string[]) => Math.min(...a.flatMap((x) => b.map((y) => contrast(x, y))));

// How dimmed things look in this style. `keepHue` steps a color back in perceived lightness only (OKLab), keeping its
// hue and as much of its chroma as the screen can show, so a neon tube stays the same
// hue at lower power; otherwise it fades toward the page, the way rubbed chalk or diluted ink does.
export function dimColor(color: string, d: Design, colors: Palette): string {
  const { amount, keepHue } = d.elements.dim;
  if (!keepHue) return blend(color, colors.paper!, amount);
  const [L, a, b] = oklab(color);
  const [Lp] = oklab(colors.paper!);
  return fromOklab(L + (Lp - L) * amount, a, b);
}

export type Pairing = { role: Role | "text" | "dimmed"; on: string; color: string; need: number; contrast: number };

// Every pairing the style allows, with its contrast against the surface as drawn.
export function pairings(d: Design, style: StyleSpec, palette: Palette): Pairing[] {
  const colors = { ...palette, ...d.colors };
  const out: Pairing[] = [];
  const size = (r: Role) => sizeOf(d, d.roles[r].step ?? 0);
  for (const [on, rule] of Object.entries(d.surfaces)) {
    const surface = surfaceSamples(on, style, colors);
    out.push({ role: "text", on, color: rule.text, need: 4.5, contrast: worst(textSamples(colors[rule.text]!, style, surface), surface) });
    for (const role of rule.roles) {
      const look = d.roles[role];
      out.push({ role, on, color: look.color, need: needOf(role, size(role)), contrast: worst(textSamples(colors[look.color]!, style, surface), surface) });
    }
  }
  // A role that brings its own back is always on it.
  for (const role of ROLES) {
    const look = d.roles[role];
    if (!look.back || d.surfaces[look.back]?.roles.includes(role)) continue;
    const surface = surfaceSamples(look.back, style, colors);
    out.push({ role, on: look.back, color: look.color, need: needOf(role, size(role)), contrast: worst(textSamples(colors[look.color]!, style, surface), surface) });
  }
  // Dimmed body words must still read on the page.
  const page = surfaceSamples("paper", style, colors);
  const dimmed = dimColor(colors[d.roles.body.color]!, d, colors);
  out.push({ role: "dimmed", on: "paper", color: dimmed, need: 3, contrast: worst([dimmed], page) });
  return out;
}

// --- reading and checking a design block ----------------------------------------------------------------------------

type Raw = Record<string, any>;
const FONTS = ["title", "body", "mono"];
const CASES = ["asis", "upper"];

function range(where: string, v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`style ${where}: ${String(v)} must be a number from ${lo} to ${hi}`);
  return v;
}
function pick<T extends string>(where: string, v: unknown, list: readonly T[]): T {
  if (!list.includes(v as T)) throw new Error(`style ${where}: "${String(v)}" is not one of ${list.join(", ")}`);
  return v as T;
}
function only(where: string, raw: Raw, keys: string[]) {
  for (const k of Object.keys(raw)) if (!keys.includes(k)) throw new Error(`style ${where}.${k}: unknown setting. Known: ${keys.join(", ")}`);
}

export const DESIGN_KEYS = ["colors", "scale", "roles", "surfaces", "elements", "picture"];

// Reads `design` from a style file and refuses it unless every role is complete and every allowed pairing reads.
export function resolveDesign(file: { palette?: Palette; design?: Raw }, style: StyleSpec): Design {
  const raw = file.design;
  if (!raw || typeof raw !== "object") throw new Error(`style design is missing. A style must say how every role looks (design.roles: ${ROLES.join(", ")}), what may sit on what (design.surfaces), its elements and its picture treatment`);
  only("design", raw, DESIGN_KEYS);
  const extra: Palette = raw.colors ?? {};
  for (const [k, c] of Object.entries(extra)) {
    if (typeof c !== "string" || !HEX.test(c)) throw new Error(`style design.colors.${k}: ${String(c)} must be a 6-digit hex color`);
    if (file.palette?.[k]) throw new Error(`style design.colors.${k}: already a palette color; give it another name`);
  }
  const colors: Palette = { ...file.palette, ...extra };
  const color = (where: string, v: unknown, none = false): string => {
    if (none && v === "none") return "none";
    if (typeof v !== "string" || !colors[v]) throw new Error(`style ${where}: "${String(v)}" is not a color name. Use one of: ${Object.keys(colors).join(", ")}${none ? ", none" : ""}`);
    return v;
  };

  const sc = raw.scale ?? {};
  if (!raw.scale) throw new Error("style design.scale is missing: give a type scale as { base, ratio }, base being the body size as a share of the frame's shorter side");
  only("design.scale", sc, ["base", "ratio"]);
  const scale = { base: range("design.scale.base", sc.base, 0.03, 0.07), ratio: range("design.scale.ratio", sc.ratio, 1.1, 1.62) };

  const rolesRaw: Raw = raw.roles ?? {};
  only("design.roles", rolesRaw, [...ROLES]);
  const missing = ROLES.filter((r) => !rolesRaw[r]);
  if (missing.length) throw new Error(`style design.roles is missing ${missing.join(", ")}. Every role needs a look`);
  const roles = {} as Record<Role, RoleSpec>;
  for (const role of ROLES) {
    const r: Raw = rolesRaw[role];
    const at = `design.roles.${role}`;
    only(at, r, ["color", "back", "step", "weight", "font", "case", "glow", "opacity", "stroke"]);
    const look: RoleSpec = { color: color(`${at}.color`, r.color) };
    if (r.back !== undefined) look.back = color(`${at}.back`, r.back);
    if (TEXT_ROLES.includes(role)) {
      for (const k of ["step", "weight", "font", "case", "glow"]) if (r[k] === undefined) throw new Error(`style ${at}.${k} is missing. A text role needs color, step, weight, font, case and glow`);
      look.step = range(`${at}.step`, r.step, STEPS[0], STEPS[1]);
      if (!Number.isInteger(look.step)) throw new Error(`style ${at}.step: ${r.step} must be a whole step on the type scale`);
      look.weight = range(`${at}.weight`, r.weight, 100, 900);
      look.font = pick(`${at}.font`, r.font, FONTS as ("title" | "body" | "mono")[]);
      look.case = pick(`${at}.case`, r.case, CASES as ("asis" | "upper")[]);
      const size = sizeOf({ scale }, look.step);
      const floor = style.read?.text ?? 0.03;
      if (size < floor - 1e-9) throw new Error(`style ${at}: step ${look.step} is ${size.toFixed(4)} of the frame, below the style's smallest readable text (read.text ${floor}). Raise the step or the scale`);
    }
    if (r.glow !== undefined) look.glow = range(`${at}.glow`, r.glow, 0, 1);
    if (r.stroke !== undefined) look.stroke = range(`${at}.stroke`, r.stroke, 0.3, 3);
    if (r.opacity !== undefined) {
      if (role !== "muted") throw new Error(`style ${at}.opacity: only muted may set opacity; other roles step back with color`);
      look.opacity = range(`${at}.opacity`, r.opacity, 0.6, 1);
    }
    roles[role] = look;
  }
  if (!roles.caption.back) throw new Error("style design.roles.caption needs a back: words over a picture always sit on something that keeps them readable");
  if (!roles.panel.back) throw new Error("style design.roles.panel needs a back: the surface a panel is made of");
  if (roles.pointer.stroke === undefined) throw new Error("style design.roles.pointer.stroke is missing: how heavy pointers are drawn");

  const surfRaw: Raw = raw.surfaces ?? {};
  if (!surfRaw.paper) throw new Error("style design.surfaces.paper is missing: say which roles may sit on the page itself");
  const surfaces: Record<string, SurfaceRule> = {};
  for (const [on, s] of Object.entries(surfRaw) as [string, Raw][]) {
    color(`design.surfaces key`, on);
    only(`design.surfaces.${on}`, s, ["text", "roles"]);
    const list = Array.isArray(s.roles) ? s.roles : [];
    if (!Array.isArray(s.roles)) throw new Error(`style design.surfaces.${on}.roles must be a list of roles`);
    surfaces[on] = { text: color(`design.surfaces.${on}.text`, s.text), roles: list.map((r: unknown) => pick(`design.surfaces.${on}.roles`, r, ROLES)) };
  }
  for (const role of ROLES) {
    const b = roles[role].back;
    if (b && !surfaces[b]) throw new Error(`style design.roles.${role}.back is "${b}", which design.surfaces does not list. Add it with the ink that sits on it`);
  }
  for (const role of TEXT_ROLES) {
    if (!roles[role].back && !surfaces.paper.roles.includes(role)) throw new Error(`style design.surfaces.paper.roles leaves out ${role}, which has no back of its own, so it could never be shown. List it, or give it a back`);
  }
  if (!surfaces.paper.roles.includes("pointer")) throw new Error("style design.surfaces.paper.roles must include pointer: marks are drawn on the page");

  const el: Raw = raw.elements ?? {};
  const need = ["panel", "caption", "label", "table", "pointer", "highlight", "dim"];
  only("design.elements", el, need);
  for (const k of need) if (!el[k]) throw new Error(`style design.elements.${k} is missing`);
  const e = (k: string, keys: string[]) => {
    only(`design.elements.${k}`, el[k], keys);
    for (const key of keys) if (el[k][key] === undefined) throw new Error(`style design.elements.${k}.${key} is missing`);
    return el[k] as Raw;
  };
  const p = e("panel", ["radius", "edge", "edgeWidth", "shadow", "rotate", "pad"]);
  const c = e("caption", ["rotate", "pad", "rule", "ruleWidth", "edge"]);
  const l = e("label", ["back", "leader", "leaderWidth"]);
  const t = e("table", ["lines", "rule", "ruleWidth", "header", "zebra"]);
  const po = e("pointer", ["head", "ring", "width"]);
  const h = e("highlight", ["kind", "color", "opacity"]);
  const dm = e("dim", ["amount", "keepHue", "glow", "stroke"]);
  if (typeof dm.keepHue !== "boolean") throw new Error("style design.elements.dim.keepHue must be true or false");
  const elements: Elements = {
    panel: { radius: range("design.elements.panel.radius", p.radius, 0, 0.5), edge: color("design.elements.panel.edge", p.edge, true), edgeWidth: range("design.elements.panel.edgeWidth", p.edgeWidth, 0, 12), shadow: range("design.elements.panel.shadow", p.shadow, 0, 1), rotate: range("design.elements.panel.rotate", p.rotate, -4, 4), pad: range("design.elements.panel.pad", p.pad, 0.3, 2) },
    caption: { rotate: range("design.elements.caption.rotate", c.rotate, -4, 4), pad: range("design.elements.caption.pad", c.pad, 0.2, 1.5), rule: color("design.elements.caption.rule", c.rule, true), ruleWidth: range("design.elements.caption.ruleWidth", c.ruleWidth, 0, 24), edge: color("design.elements.caption.edge", c.edge, true) },
    label: { back: color("design.elements.label.back", l.back), leader: color("design.elements.label.leader", l.leader, true), leaderWidth: range("design.elements.label.leaderWidth", l.leaderWidth, 0, 10) },
    table: { lines: pick("design.elements.table.lines", t.lines, ["none", "header", "rows", "grid"] as const), rule: color("design.elements.table.rule", t.rule), ruleWidth: range("design.elements.table.ruleWidth", t.ruleWidth, 0.5, 8), header: pick("design.elements.table.header", t.header, TEXT_ROLES), zebra: color("design.elements.table.zebra", t.zebra, true) },
    pointer: { head: pick("design.elements.pointer.head", po.head, ["open", "solid", "none"] as const), ring: pick("design.elements.pointer.ring", po.ring, ["hand", "clean"] as const), width: range("design.elements.pointer.width", po.width, 2, 16) },
    highlight: { kind: pick("design.elements.highlight.kind", h.kind, ["marker", "underline", "ring", "box", "glow"] as const), color: color("design.elements.highlight.color", h.color), opacity: range("design.elements.highlight.opacity", h.opacity, 0.2, 1) },
    dim: { amount: range("design.elements.dim.amount", dm.amount, 0.1, 0.8), keepHue: dm.keepHue, glow: range("design.elements.dim.glow", dm.glow, 0, 1), stroke: range("design.elements.dim.stroke", dm.stroke, 0.4, 1) },
  };

  const pic: Raw = raw.picture;
  if (!pic) throw new Error("style design.picture is missing: how pictures are treated so real and generated ones look like one piece");
  const pk = ["saturation", "contrast", "brightness", "tint", "tintAmount", "border", "borderWidth", "shadow", "rotate"];
  only("design.picture", pic, pk);
  for (const k of pk) if (pic[k] === undefined) throw new Error(`style design.picture.${k} is missing`);
  const picture: Picture = {
    saturation: range("design.picture.saturation", pic.saturation, 0, 1.6),
    contrast: range("design.picture.contrast", pic.contrast, 0.8, 1.3),
    brightness: range("design.picture.brightness", pic.brightness, 0.8, 1.2),
    tint: color("design.picture.tint", pic.tint),
    tintAmount: range("design.picture.tintAmount", pic.tintAmount, 0, 0.5),
    border: color("design.picture.border", pic.border, true),
    borderWidth: range("design.picture.borderWidth", pic.borderWidth, 0, 40),
    shadow: range("design.picture.shadow", pic.shadow, 0, 1),
    rotate: range("design.picture.rotate", pic.rotate, 0, 4),
  };

  const design: Design = { colors: extra, scale, roles, surfaces, elements, picture };

  // The table rule and the highlight are marks on the page; a highlight drawn behind words is a surface for them.
  const page = surfaceSamples("paper", style, colors);
  const markOk = (where: string, name: string) => {
    const v = worst([colors[name]!], page);
    if (v < 1.5) throw new Error(`style ${where}: ${name} on the page reads at ${v.toFixed(2)}, so it would not show. It needs 1.5`);
  };
  markOk("design.elements.table.rule", elements.table.rule);
  if (!surfaces[elements.label.back]) throw new Error(`style design.elements.label.back is "${elements.label.back}": labels on pictures sit on it, so design.surfaces must list it`);
  if (elements.highlight.kind === "marker" && !surfaces[elements.highlight.color]) throw new Error(`style design.elements.highlight: a marker highlight sits behind words, so ${elements.highlight.color} must be listed in design.surfaces`);
  const panelBack = roles.panel.back!;
  const apartFromPage = worst(surfaceSamples(panelBack, style, colors), [colors.paper!]);
  if (apartFromPage < 1.12 && (elements.panel.edge === "none" || worst([colors[elements.panel.edge]!], page) < 1.5)) throw new Error(`style design: a panel (${panelBack}) is too close to the page to be seen and has no edge that shows. Make its surface differ, or give it an edge`);

  const bad = pairings(design, style, colors).filter((x) => x.contrast < x.need);
  if (bad.length) {
    throw new Error(`style design: unreadable pairings, measured against the surface as drawn (texture and light included): ${bad.map((b) => `${b.role === "text" ? `the ink for words (${b.color})` : b.role === "dimmed" ? `dimmed body words (${b.color})` : `${b.role} (${b.color})`} on ${b.on} reads at ${b.contrast.toFixed(2)}, needs ${b.need}`).join("; ")}`);
  }
  return design;
}

// What the renderer asks: how this role looks here, sitting on `on` (a surface name; the page when left out).
// Colors stay theme names, as in RoleLook; sizes are shares of the frame's shorter side.
export function roleLook(d: Design, role: Role, on = "paper"): RoleLook {
  const r = d.roles[role];
  const look: RoleLook = { ...r, ...(r.step !== undefined ? { size: sizeOf(d, r.step) } : {}) };
  delete (look as Record<string, unknown>).step;
  const here = r.back ?? on;
  const rule = d.surfaces[here];
  if (rule && !rule.roles.includes(role) && here !== "paper" && TEXT_ROLES.includes(role)) look.color = rule.text;
  if (!rule && TEXT_ROLES.includes(role)) throw new Error(`nothing in this style may sit on ${on}: design.surfaces lists ${Object.keys(d.surfaces).join(", ")}`);
  return look;
}

export function rolesOf(d: Design): Record<Role, RoleLook> {
  return Object.fromEntries(ROLES.map((r) => [r, roleLook(d, r)])) as Record<Role, RoleLook>;
}

// --- color space helpers ---------------------------------------------------------------------------------------------
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
export function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const rgbOf = (L: number, a: number, b: number) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
// Back to hex, giving up chroma (never hue or lightness) until the color fits on screen.
export function fromOklab(L: number, a: number, b: number): string {
  let k = 1;
  let c = rgbOf(L, a, b);
  while (c.some((v) => v < -1e-4 || v > 1 + 1e-4) && k > 0) {
    k -= 0.02;
    c = rgbOf(L, a * k, b * k);
  }
  return `#${c.map((v) => Math.round(gam(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0")).join("")}`;
}
