// A style file becomes a theme. Plans and kits never name real colors or fonts, so one scene works in every style.
import { readFileSync } from "node:fs";
import type { Theme } from "../core/types.ts";

export function themeFrom(name: string): Theme {
  const s = JSON.parse(readFileSync(`styles/${name}.json`, "utf8"));
  return { colors: { ...s.palette, soft: `${s.palette.ink}` }, fonts: { title: s.fonts.title, body: s.fonts.body }, moveFrames: 16, ease: "smooth" };
}
