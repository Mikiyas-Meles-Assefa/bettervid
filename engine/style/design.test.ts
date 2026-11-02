import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ROLES } from "../core/types.ts";
import { styleNames, themeFrom, themeOf } from "../render/theme.ts";
import { contrast } from "./color.ts";
import { dimColor, oklab, pageSamples, pairings, resolveDesign, roleLook, sizeOf, TEXT_ROLES } from "./design.ts";
import { resolveStyle } from "./format.ts";

const custom = readdirSync("styles/custom").filter((f) => f.endsWith(".json")).map((f) => `custom/${f.slice(0, -5)}`);
const names = [...styleNames(), ...custom];
const fileOf = (name: string) => JSON.parse(readFileSync(`styles/${name}.json`, "utf8"));
const chroma = (hex: string) => Math.hypot(oklab(hex)[1], oklab(hex)[2]);
const hue = (hex: string) => (Math.atan2(oklab(hex)[2], oklab(hex)[1]) * 180) / Math.PI;

test("all seven styles and every custom style have a complete design layer, exposed on the theme", () => {
  assert.ok(styleNames().length >= 7 && custom.length >= 3);
  for (const name of names) {
    const theme = themeFrom(name);
    for (const role of ROLES) assert.ok(theme.roles?.[role], `${name} has no look for ${role}`);
    for (const role of TEXT_ROLES) {
      const look = theme.roles![role]!;
      assert.ok(theme.colors[look.color!], `${name}.${role} names a color the theme has`);
      assert.ok(look.size! >= theme.style!.read!.text - 1e-9, `${name}.${role} is not below the readable floor`);
      assert.ok(["title", "body", "mono"].includes(look.font!) && look.weight! >= 100 && ["asis", "upper"].includes(look.case!));
      // sizes come from the type scale, not from anywhere
      const d = theme.design;
      assert.equal(look.size, sizeOf(d, d.roles[role].step!));
    }
    assert.ok(theme.roles!.caption!.back, `${name}: words over a picture always have a backing`);
    assert.ok(theme.roles!.panel!.back);
    assert.ok(theme.design.picture, `${name} treats pictures`);
  }
});

test("every pairing a style allows reads, against the surface as drawn, texture included", () => {
  for (const name of names) {
    const theme = themeFrom(name);
    const list = pairings(theme.design, theme.style!, theme.colors);
    assert.ok(list.length > 15, `${name} checks its pairings`);
    for (const p of list) assert.ok(p.contrast >= p.need, `${name}: ${p.role} (${p.color}) on ${p.on} reads at ${p.contrast.toFixed(2)}, needs ${p.need}`);
    // and the page samples really include the texture: a textured page is not measured as its flat base color
    if (theme.style!.surface.grain || theme.style!.surface.light || theme.style!.surface.grid) assert.ok(pageSamples(theme.style!, theme.colors).some((c) => c !== theme.colors.paper!.toLowerCase()), name);
  }
});

test("words on a colored fill take the fill's own ink: neon puts dark ink on a bright fill, with no glow", () => {
  const neon = themeFrom("neon");
  const look = roleLook(neon.design, "label", "highlight");
  assert.equal(look.color, "paper");
  assert.ok(contrast(neon.colors[look.color!]!, neon.colors.highlight!) >= 7);
  for (const name of names) {
    const t = themeFrom(name);
    for (const [on, rule] of Object.entries(t.design.surfaces)) {
      if (on === "paper") continue;
      for (const role of TEXT_ROLES) if (!rule.roles.includes(role) && !t.design.roles[role].back) assert.equal(roleLook(t.design, role, on).color, rule.text, `${name}: ${role} on ${on}`);
    }
  }
});

test("chalkboard panels are a darker board, never a cream card, and collage captions sit on a strip", () => {
  const chalk = themeFrom("chalkboard");
  const back = chalk.colors[chalk.roles!.panel!.back!]!;
  assert.ok(contrast(back, "#000000") < contrast(chalk.colors.paper!, "#000000"), "the panel is darker than the board");
  const collage = themeFrom("collage");
  const strip = collage.colors[collage.roles!.caption!.back!]!;
  assert.ok(contrast(strip, collage.colors[collage.roles!.caption!.color!]!) >= 7);
  assert.equal(fileOf("collage").vignette, 0, "no heavy vignette on the collage page");
});

test("muted steps back in the style's own way, never into plain grey", () => {
  for (const name of names) {
    const t = themeFrom(name);
    const muted = t.colors[t.roles!.muted!.color!]!;
    const ink = t.colors[t.roles!.body!.color!]!;
    if (chroma(ink) > 0.03) assert.ok(chroma(muted) > 0.01, `${name}: muted ${muted} keeps some color`);
    if (t.design.elements.dim.keepHue) {
      const dimmed = dimColor(ink, t.design, t.colors);
      assert.ok(Math.abs(hue(dimmed) - hue(ink)) < 8, `${name}: a dimmed ${ink} keeps its hue (${dimmed})`);
      assert.ok(chroma(dimmed) > chroma(ink) * 0.5, `${name}: and most of its color`);
    }
  }
  const neon = themeFrom("neon");
  assert.ok(neon.design.elements.dim.keepHue && neon.design.elements.dim.glow < 0.3, "neon fades its glow and keeps its hue");
  assert.ok(neon.roles!.muted!.glow! < neon.roles!.body!.glow!);
});

const base = () => structuredClone(fileOf("collage"));
const refusal = (file: Record<string, any>) => {
  try {
    themeOf(file);
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};

test("a style without a complete, readable design is refused with the exact problem", () => {
  const f1 = base();
  delete f1.design;
  assert.match(refusal(f1), /^style design is missing\. A style must say how every role looks/);

  const f2 = base();
  delete f2.design.roles.answer;
  delete f2.design.roles.pointer;
  assert.equal(refusal(f2), "style design.roles is missing answer, pointer. Every role needs a look");

  const f3 = base();
  f3.design.roles.muted.color = "kraft"; // kraft words on the page: nearly invisible
  assert.match(refusal(f3), /^style design: unreadable pairings, .*muted \(kraft\) on paper reads at 1\.\d\d, needs 3/);

  const f4 = base();
  delete f4.design.roles.caption.back;
  assert.equal(refusal(f4), "style design.roles.caption needs a back: words over a picture always sit on something that keeps them readable");

  const f5 = base();
  f5.design.roles.title.color = "gold";
  assert.match(refusal(f5), /^style design\.roles\.title\.color: "gold" is not a color name\. Use one of: paper, ink, accent, highlight, strip/);

  const f6 = base();
  f6.design.roles.note.step = -2;
  assert.match(refusal(f6), /^style design\.roles\.note: step -2 is 0\.02\d+ of the frame, below the style's smallest readable text/);

  const f7 = base();
  f7.design.surfaces.highlight.text = "cream"; // cream on marker yellow
  assert.match(refusal(f7), /the ink for words \(cream\) on highlight reads at 1\.\d\d, needs 4\.5/);

  const f8 = base();
  f8.design.roles.key.back = "accent";
  f8.design.surfaces.accent.roles = ["key"]; // ink-colored key on red, listed as allowed
  assert.match(refusal(f8), /key \(ink\) on accent reads at \d\.\d\d, needs/);

  const f9 = base();
  f9.design.roles.heading.weight = undefined;
  delete f9.design.roles.heading.weight;
  assert.equal(refusal(f9), "style design.roles.heading.weight is missing. A text role needs color, step, weight, font, case and glow");

  const f10 = base();
  delete f10.design.picture;
  assert.match(refusal(f10), /^style design\.picture is missing/);
});

test("the design check reads the same as the style's own render settings: more texture can make a pairing fail", () => {
  const f = base();
  const style = resolveStyle(f);
  assert.doesNotThrow(() => resolveDesign(f, style));
  const rough = resolveStyle({ ...f, render: { ...f.render, surface: { kind: "slate", grain: 1, smudge: 1, light: 1 } } });
  const before = Math.min(...pairings(resolveDesign(f, style), style, { ...f.palette, ...f.design.colors }).map((p) => p.contrast));
  const after = Math.min(...pairings(resolveDesign(f, style), rough, { ...f.palette, ...f.design.colors }).map((p) => p.contrast));
  assert.ok(after < before, "a rougher surface lowers the worst contrast");
});
