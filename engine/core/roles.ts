// What a role looks like in a theme. A style defines its roles in Theme.roles; until it does, each role gets a look
// worked out from the palette, so a scene that names roles always draws and always reads.
import { contrast } from "../style/color.ts";
import { ROLES, type Role, type RoleLook, type Theme } from "./types.ts";

export const isRole = (v: string | undefined): v is Role => !!v && (ROLES as readonly string[]).includes(v);

// The color a name stands for, or the name itself when it is already a color.
export const colorOf = (theme: Theme, name: string | undefined): string | undefined => (name === undefined ? undefined : theme.colors[name] ?? name);

// How well words in one color read on another, as a contrast ratio from 1 (none) to 21. Names are theme colors.
export function readability(theme: Theme, color: string, back: string): number {
  const [a, b] = [colorOf(theme, color)!, colorOf(theme, back)!];
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(a) || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(b)) return 21; // a gradient or unknown paint: not judged here
  return contrast(a, b);
}

// The theme color that reads best on a back, among the given names.
export function bestOn(theme: Theme, back: string, names = ["ink", "paper"]): string {
  const have = names.filter((n) => theme.colors[n]);
  if (!have.length) return "ink";
  return have.reduce((best, n) => (readability(theme, n, back) > readability(theme, best, back) ? n : best));
}

// Looks worked out from the palette alone. Sizes are shares of the frame's shorter side, before layout scales a state.
function fallback(theme: Theme): Record<Role, RoleLook> {
  const strong = bestOn(theme, "paper", ["accent", "highlight"]);
  return {
    title: { color: "ink", size: 0.085, weight: 700, font: "title" },
    heading: { color: "ink", size: 0.065, weight: 700, font: "title" },
    body: { color: "ink", size: 0.065, weight: 400, font: "body" },
    label: { color: "ink", size: 0.046, weight: 600, font: "body" },
    note: { color: "ink", size: 0.04, weight: 400, font: "body", opacity: 0.8 },
    key: { color: strong, size: 0.065, weight: 700, font: "body" },
    answer: { color: strong, size: 0.075, weight: 700, font: "title" },
    muted: { opacity: 0.5 },
    wrong: { color: "accent", weight: 400, opacity: 0.9 },
    code: { color: "ink", size: 0.04, font: "mono" },
    panel: { back: "paper", color: "ink", stroke: 1 },
    caption: { back: "paper", color: "ink", size: 0.046, weight: 700, font: "body" },
    pointer: { color: strong, stroke: 1 },
  };
}

// A role's look: the style's own where it has one, the palette's otherwise. Colors that name nothing in the theme are
// dropped, so a style written for another palette cannot break a scene.
export function roleLook(theme: Theme, role: Role): RoleLook {
  const look: RoleLook = { ...fallback(theme)[role], ...theme.roles?.[role] };
  for (const k of ["color", "back"] as const) if (look[k] !== undefined && !theme.colors[look[k]!]) delete look[k];
  return look;
}

// Whether the style itself says how this role looks (not the palette fallback).
export const styleHas = (theme: Theme, role: Role) => !!theme.roles?.[role];

// What a role adds to a drawn part that did not set these itself, for parts that carry a `role` prop (a kit or program
// can name a role and leave the look to the style). Colors come back as real colors, ready to draw.
export function roleProps(theme: Theme, role: string, kind: string, props: Record<string, unknown>): Record<string, string | number> {
  if (!isRole(role)) return {};
  const look = roleLook(theme, role);
  const out: Record<string, string | number> = {};
  const color = colorOf(theme, look.color);
  if (kind === "text") {
    if (props.color === undefined && color) out.color = color;
    if (props.weight === undefined && look.weight !== undefined) out.weight = look.weight;
    if (props.font === undefined && look.font) out.font = look.font === "mono" ? (theme.fonts.mono ?? "Menlo, monospace") : theme.fonts[look.font];
    if (look.case === "upper" && typeof props.text === "string") out.text = props.text.toUpperCase();
  }
  if (kind === "path" && props.stroke === undefined && color) out.stroke = color;
  if (props.glow === undefined && look.glow && color) Object.assign(out, { glow: look.glow * 12, glowColor: color });
  if (props.opacity === undefined && look.opacity !== undefined) out.opacity = look.opacity;
  return out;
}
