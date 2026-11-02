// The style's design layer reaches the drawing: any scene in any style gets the designed look. Roles size and color
// words on the style's scale and take each surface's ink; panels, captions and labels are the style's elements; dim
// and focus step back the style's way; pictures, tables, highlights and pointers follow the style.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import { roleProps } from "../core/roles.ts";
import type { CompileContext, Resolved, Scene, Theme } from "../core/types.ts";
import { themeFrom, type DesignedTheme } from "../render/theme.ts";
import { contrast } from "../style/color.ts";
import { dimColor, roleLook, sizeOf } from "../style/design.ts";
import { build, formatProblems } from "./build.ts";

const words = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.5 }));
const ctxOf = (theme: Theme): CompileContext => ({ fps: 30, width: 1080, height: 1920, frames: 900, words, theme });
const pics = { assets: { photo: "/a.jpg", other: "/b.jpg" } };
const ok = async (style: string | DesignedTheme, src: string, extra: Record<string, unknown> = {}) => {
  const theme = typeof style === "string" ? themeFrom(style) : style;
  const r = await build(src, { ctx: ctxOf(theme), ...extra });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return { s: r.scene!, theme };
};
const problems = async (style: string, src: string) => formatProblems((await build(src, { ctx: ctxOf(themeFrom(style)) })).problems);
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => {
  const hit = find(evaluate(s, f), id);
  assert.ok(hit, `${id} is not drawn at frame ${f}`);
  return hit.props;
};
const hex = (t: Theme, name: unknown) => t.colors[String(name)] ?? String(name);

test("text roles: size on the style's scale, color, weight, font, capitals and glow level come from the design", async () => {
  const { s, theme } = await ok("neon", `@0\ntext t "Title" role=title\ntext h "step one" role=heading\ntext b "plain words"\n`);
  const d = theme.design;
  const title = at(s, 40, "t.l1");
  assert.equal(hex(theme, title.color), theme.colors[d.roles.title.color]);
  assert.equal(title.font, theme.fonts.title);
  assert.equal(title.glowLevel, d.roles.title.glow);
  const head = at(s, 40, "h.l1");
  assert.equal(head.text, "STEP ONE", "neon headings are in capitals");
  assert.equal(head.weight, d.roles.heading.weight);
  assert.equal(head.glowLevel, d.roles.heading.glow);
  // Words with no role are the style's body: its color and glow, not the full glow of the pen.
  const body = at(s, 40, "b.l1");
  assert.equal(hex(theme, body.color), theme.colors[d.roles.body.color]);
  assert.equal(body.glowLevel, d.roles.body.glow);
  // Two roles on one scale: the title is the body size times the ratio to the difference of their steps.
  const ratio = Number(title.size) / Number(at(s, 40, "h.l1").size);
  assert.ok(Math.abs(ratio - d.scale.ratio ** (d.roles.title.step! - d.roles.heading.step!)) < 0.05, `title to heading is ${ratio}`);
});

test("words on a panel or a filled shape take that surface's ink, so pale words never sit on a pale card", async () => {
  const { s, theme } = await ok("neon", `@0\nstack c role=panel\n  text a "inside"\nbox k "on pink" fill=accent\nbox y "on yellow" fill=highlight\n`);
  const d = theme.design;
  assert.equal(hex(theme, at(s, 40, "k.label").color), theme.colors[d.surfaces.accent!.text]);
  assert.equal(hex(theme, at(s, 40, "y.label").color), theme.colors[d.surfaces.highlight!.text]);
  assert.equal(hex(theme, at(s, 40, "a.l1").color), theme.colors[roleLook(d, "body", d.roles.panel.back).color!]);
  // A shape with no fill of its own is made of the style's panel.
  const plain = await ok("chalkboard", `@0\nbox p "plain"\n`);
  assert.equal(hex(plain.theme, at(plain.s, 40, "p.shape").fill), plain.theme.colors[plain.theme.design.roles.panel.back!]);
  // Every pairing reads, on every style.
  for (const style of ["chalkboard", "neon", "collage", "whiteboard"]) {
    const r = await ok(style, `@0\nrow r\n  box a "one" fill=accent\n  box b "two" fill=highlight\n  box c "three" fill=ink\n`);
    for (const id of ["a", "b", "c"]) {
      const fill = hex(r.theme, at(r.s, 40, `${id}.shape`).fill);
      const ink = hex(r.theme, at(r.s, 40, `${id}.label`).color);
      assert.ok(contrast(ink, fill) >= 3, `${style}: ${id} reads at ${contrast(ink, fill).toFixed(2)}`);
    }
  }
});

test("panels are the style's panel, never the page color, and back= keeps to the style's surfaces", async () => {
  const { s, theme } = await ok("collage", `@0\nstack c role=panel\n  text a "inside"\nstack p back=paper\n  text b "old style card"\n`);
  const p = theme.design.elements.panel;
  const back = at(s, 40, "c.back");
  assert.equal(hex(theme, back.fill), theme.colors[theme.design.roles.panel.back!]);
  assert.equal(back.rotate, p.rotate);
  assert.equal(back.shadowOpacity, p.shadow);
  assert.equal(back.shadowBlur, 0, "collage panels cast a hard paper shadow");
  assert.equal(hex(theme, at(s, 40, "p.back").fill), theme.colors[theme.design.roles.panel.back!], "back=paper is the style's panel");
  assert.match(await problems("collage", `@0\nstack p back=sepia\n  text b "card"\n`), /back=sepia is not a surface words sit on in this style\. Use role=panel/);
  // A listed surface is allowed.
  await ok("collage", `@0\nstack p back=kraft\n  text b "card"\n`);
});

test("captions are the style's strip with its rule and lean; labels on pictures sit on the label card", async () => {
  const { s, theme } = await ok("collage", `@0\nimage p asset=photo w=1080 h=1920 frame=fill\ntext t "over a photo" role=caption\n@2 keep\ntag p "wing" at=0.3,0.3 id=w\ntag p "a kite" at=0.5,0.7 role=caption id=k\n`, pics);
  const e = theme.design.elements.caption;
  const back = at(s, 40, "t.back");
  assert.equal(hex(theme, back.fill), theme.colors[theme.design.roles.caption.back!]);
  assert.equal(back.rotate, e.rotate);
  assert.equal(hex(theme, at(s, 40, "t.rule").fill), theme.colors[e.rule]);
  assert.equal(at(s, 40, "t").rotate, e.rotate, "the words lean with their strip");
  assert.equal(at(s, 40, "t.l1").text, "OVER A PHOTO");
  // Tags on the picture: a label on the style's label card, a caption on its strip, drawn over everything beside it.
  assert.equal(hex(theme, at(s, 120, "w.back").fill), theme.colors[theme.design.elements.label.back]);
  assert.equal(hex(theme, at(s, 120, "k.back").fill), theme.colors[theme.design.roles.caption.back!]);
  assert.equal(hex(theme, at(s, 120, "k.rule").fill), theme.colors[e.rule]);
  assert.equal(at(s, 120, "k").layer, 1);
});

test("dim and focus step back the style's way: recolored, with the style's glow and line weight, not faded", async () => {
  const { s, theme } = await ok("neon", `@0\ntext a "kept"\ntext b "stepped back"\nbox c "shape"\n@2 keep\ndim b c\n`);
  const d = theme.design;
  const b = at(s, 60, "b.l1");
  assert.equal(b.color, dimColor(theme.colors[d.roles.body.color]!, d, theme.colors));
  assert.equal(b.glowLevel, d.elements.dim.glow);
  assert.equal(Number(b.opacity ?? 1), 1);
  const shape = at(s, 60, "c.shape");
  assert.equal(shape.glowLevel, d.elements.dim.glow);
  assert.equal(Number(shape.strokeWidth), Math.round(Number(at(s, 30, "c.shape").strokeWidth) * d.elements.dim.stroke * 10) / 10);
  // A dim that would make words unreadable on what is behind them stops where they still read.
  const lit = await ok("neon", `@0\nbox k "27" fill=paper\n@2 keep\nset k color=accent\n@4 keep\ndim k\n`);
  const label = at(lit.s, 100, "k.label");
  assert.ok(contrast(String(label.color), lit.theme.colors.paper!) >= 3, `dimmed to ${label.color}`);
  // The dim ends with the state: color, glow and line come back.
  const back = await ok("chalkboard", `@0\ntext a "x"\n@2 keep\ndim a\n@4 keep\n`);
  assert.equal(at(back.s, 100, "a.l1").glowLevel, back.theme.design.roles.body.glow);
});

test("pictures take the style's treatment, and a picture laid on the page leans and has its border", async () => {
  const { s, theme } = await ok("collage", `@0\nrow r\n  image a asset=photo w=400 h=300\n  image b asset=other w=400 h=300\n`, pics);
  const p = theme.design.picture;
  const [a, b] = [at(s, 40, "a"), at(s, 40, "b")];
  for (const x of [a, b]) {
    assert.equal(x.saturation, p.saturation);
    assert.equal(x.brightness, p.brightness);
    assert.equal(x.borderWidth, p.borderWidth);
    assert.equal(hex(theme, x.tint), theme.colors[p.tint]);
    assert.equal(Math.abs(Number(x.rotate)), p.rotate);
  }
  const fill = await ok("collage", `@0\nimage f asset=photo w=1080 h=1920 frame=fill\n`, pics);
  const f = at(fill.s, 40, "f");
  assert.equal(f.saturation, p.saturation);
  assert.equal(f.border, undefined, "a picture filling the frame has no border");
  assert.equal(f.rotate ?? 0, 0);
  // A see-through picture (a cut-out) gets no mat, which would fill in around its shape.
  const cut = await ok("collage", `@0\nimage c asset=cut w=400 h=500\n`, { assets: { cut: "/x/cut.png" } });
  assert.equal(at(cut.s, 40, "c").border, undefined);
  assert.equal(at(cut.s, 40, "c").saturation, p.saturation);
  // A lean the scene gives wins.
  const own = await ok("collage", `@0\nimage a asset=photo w=400 h=300 rotate=5\n`, pics);
  assert.equal(at(own.s, 40, "a").rotate, 5);
});

test("every style has a backdrop look for a picture's blurred copy behind it", () => {
  for (const style of ["chalkboard", "neon", "collage", "whiteboard", "blueprint", "flat", "ink"]) {
    const b = themeFrom(style).design.elements.backdrop;
    assert.ok(b.blur > 0 && b.brightness > 0 && b.brightness <= 1.2, style);
    assert.ok(themeFrom(style).colors[b.tint], `${style}: backdrop tint ${b.tint}`);
  }
  // Darker on a dark page, paler on a light one.
  assert.ok(themeFrom("neon").design.elements.backdrop.brightness < themeFrom("collage").design.elements.backdrop.brightness);
});

test("a grid of words is a table: a header row in the style's header role, rules and stripes the style's way", async () => {
  const { s, theme } = await ok("collage", `@0\ngrid t cols=2 gap=50\n  text h1 "name"\n  text h2 "value"\n  text a1 "x"\n  text a2 "1"\n  text b1 "y"\n  text b2 "2"\n`);
  const t = theme.design.elements.table;
  const head = at(s, 40, "h1.l1");
  assert.equal(hex(theme, head.color), theme.colors[theme.design.roles[t.header].color]);
  assert.equal(head.text, "NAME", "collage's header is the label role, in capitals");
  assert.equal(hex(theme, at(s, 40, "t.rule0").stroke), theme.colors[t.rule]);
  assert.ok(at(s, 40, "t.rule1"), "collage rules every row");
  // A grid of shapes is not a table.
  const shapes = await ok("collage", `@0\ngrid g cols=2\n  box a "1"\n  box b "2"\n  box c "3"\n  box d "4"\n`);
  assert.equal(find(evaluate(shapes.s, 40), "g.rule0"), undefined);
});

test("highlights and pointers follow the style: marker or glow, open or no heads, hand or clean rings", async () => {
  // Collage: a marker band, and the words on it take the band's ink.
  const c = await ok("collage", `@0\ntext a "result" role=answer\n@2 keep\nmark highlight a\n`);
  const h = c.theme.design.elements.highlight;
  const band = at(c.s, 100, "mark.highlight.a");
  assert.equal(hex(c.theme, band.stroke), c.theme.colors[h.color]);
  assert.equal(band.strokeOpacity, h.opacity);
  assert.ok(contrast(hex(c.theme, at(c.s, 100, "a.l1").color), c.theme.colors[h.color]!) >= 3);
  // Neon: a glow highlight lights the words themselves.
  const n = await ok("neon", `@0\ntext a "result"\n@2 keep\nmark highlight a\nmark ring a\narrow a -> a\n`);
  assert.equal(at(n.s, 100, "a.l1").glowLevel, 1);
  assert.equal(hex(n.theme, at(n.s, 100, "a.l1").color), n.theme.colors[n.theme.design.elements.highlight.color]);
  assert.equal(at(n.s, 100, "mark.ring.a").closed, 1, "neon rings are clean");
  assert.equal(Number(at(n.s, 100, "mark.ring.a").strokeWidth), n.theme.design.elements.pointer.width * n.theme.design.roles.pointer.stroke!);
  // A style with no heads draws none; one with solid heads fills them.
  const base = themeFrom("chalkboard");
  const none: DesignedTheme = { ...base, design: { ...base.design, elements: { ...base.design.elements, pointer: { ...base.design.elements.pointer, head: "none" } } } };
  const nh = await ok(none, `@0\nrow r\n  box a "1"\n  box b "2"\n@2 keep\narrow a -> b\n`);
  assert.equal(find(evaluate(nh.s, 100), "arrow.a.b.head"), undefined);
  assert.ok(at(nh.s, 100, "arrow.a.b"));
  const solid: DesignedTheme = { ...base, design: { ...base.design, elements: { ...base.design.elements, pointer: { ...base.design.elements.pointer, head: "solid" } } } };
  const sh = await ok(solid, `@0\nrow r\n  box a "1"\n  box b "2"\n@2 keep\narrow a -> b\n`);
  assert.equal(at(sh.s, 100, "arrow.a.b.head").closed, 1);
});

test("the renderer gives a part that names a role the design's glow level and size", () => {
  const theme = themeFrom("neon");
  const p = roleProps(theme, "title", "text", { text: "hi" }, 1080);
  assert.equal(p.glowLevel, theme.design.roles.title.glow);
  assert.equal(p.size, Math.round(sizeOf(theme.design, theme.design.roles.title.step!) * 1080));
  assert.equal(p.glow, undefined, "with a design the light is the style's own, not a plain glow");
  assert.equal(roleProps(theme, "pointer", "path", {}).strokeWidth, theme.design.elements.pointer.width * theme.design.roles.pointer.stroke!);
});
