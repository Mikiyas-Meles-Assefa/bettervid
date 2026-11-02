// A style file becomes a theme. Plans and kits never name real colors or fonts, so one scene works in every style.
import { readdirSync, readFileSync } from "node:fs";
import type { Theme } from "../core/types.ts";
import { resolveStyle } from "../style/format.ts";

const dir = new URL("../../styles/", import.meta.url);

export function styleNames(): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

export function themeFrom(name: string): Theme {
  const s = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  const style = resolveStyle(s);
  return {
    colors: { ...s.palette, soft: `${s.palette.ink}` },
    fonts: { title: style.type.title, body: style.type.body, mono: style.type.mono },
    moveFrames: style.motion.frames,
    ease: style.motion.ease,
    enter: style.motion.enter,
    style,
  };
}
