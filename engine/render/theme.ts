// A style file becomes a theme. Plans and kits never name real colors or fonts, so one scene works in every style.
// The theme carries the style's design layer: `roles` (what a title, an answer or a caption looks like here) and
// `design` (which words may sit on which surfaces, panels, captions, tables, pointers, highlights, dimming, pictures).
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import type { Theme } from "../core/types.ts";
import { type Design, resolveDesign, rolesOf } from "../style/design.ts";
import { resolveStyle, type StyleFileLike } from "../style/format.ts";

const dir = new URL("../../styles/", import.meta.url);

export type DesignedTheme = Theme & { design: Design };

export function styleNames(): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

// A parsed style file as a theme. Throws, with the exact problem, if the file's render block or design layer is
// incomplete or would put unreadable words on screen.
export function themeOf(s: StyleFileLike & { design?: Record<string, unknown> }): DesignedTheme {
  const style = resolveStyle(s);
  const design = resolveDesign(s, style);
  return {
    colors: { ...s.palette, ...design.colors, soft: `${s.palette!.ink}` },
    fonts: { title: style.type.title, body: style.type.body, mono: style.type.mono },
    moveFrames: style.motion.frames,
    ease: style.motion.ease,
    enter: style.motion.enter,
    style,
    roles: rolesOf(design),
    design,
  };
}

export function themeFrom(name: string): DesignedTheme {
  const s = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  try {
    return themeOf(s);
  } catch (e) {
    throw new Error(`${name}: ${(e as Error).message}`);
  }
}
