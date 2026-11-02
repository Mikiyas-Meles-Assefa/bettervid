// Layout and drawing that hold for any scene: the frame is filled, sizes stay steady, words read on what is behind them,
// nothing covers words, the camera keeps words whole, cards never hide their pictures, everything has a size a viewer
// can see, and roles let the style decide how things look.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene, Theme } from "../core/types.ts";
import { mathKit } from "../kits/math.ts";
import { build, formatProblems } from "./build.ts";
import { estimate, safeArea } from "./layout.ts";
import { roleProps } from "../core/roles.ts";

const words = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.5 }));
const theme: Theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "TitleFont", body: "b" }, moveFrames: 10, ease: "linear" };
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 900, words, theme };
const pics = { assets: { photo: "/a.jpg" } };
const ok = async (src: string, extra: Record<string, unknown> = {}, c = ctx) => {
  const r = await build(src, { ctx: c, ...extra });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r.scene!;
};
const bad = async (src: string, extra: Record<string, unknown> = {}) => {
  const r = await build(src, { ctx, ...extra });
  assert.ok(r.problems.length, "expected problems");
  return formatProblems(r.problems);
};
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => find(evaluate(s, f), id);
const num = (v: unknown) => Number(v ?? 0);
const safe = safeArea(1080, 1920);

test("a state that fits by its width spreads over the height of the frame", async () => {
  const s = await ok(`@0\ntext t "Title" size=big\nrow r\n  box a "1"\n  box b "2"\n  box c "3"\n  box d "4"\ntext u "under it" size=small\n`);
  const [top, bottom] = [num(at(s, 30, "t")!.props.y), num(at(s, 30, "u")!.props.y)];
  assert.ok(bottom - top > safe.h * 0.55, `spans ${bottom - top} of ${safe.h}`);
  assert.ok(top > safe.y - safe.h / 2 && bottom < safe.y + safe.h / 2);
});

test("adding rows in keep states never shrinks what is already there", async () => {
  const rows = Array.from({ length: 11 }, (_, i) => `@${i + 2} keep\ntext v${i + 2} "${i + 2}" size=big into=tb\n`).join("");
  const s = await ok(`@0\nstack tb gap=30\n  text v1 "1" size=big\n${rows}`);
  const first = num(at(s, 15, "v1.l1")!.props.size);
  const last = num(at(s, 400, "v1.l1")!.props.size);
  assert.equal(first, last);
  assert.ok(num(at(s, 400, "v12.l1")!.props.size) === last);
});

test("words read on what is behind them: a panel picks a readable color, and an unreadable one is reported", async () => {
  const s = await ok(`@0\nstack s back=ink\n  text a "on a dark card"\n`);
  assert.equal(at(s, 30, "a.l1")!.props.color, theme.colors.paper);
  assert.match(await bad(`@0\nstack s back=ink\n  text a "lost" color=ink\n`), /"lost" is ink on ink, a contrast of only 1\.0 to 1; words need 3 to 1/);
  assert.match(await bad(`@0\ntext a "pale" color=highlight\n`), /"pale" is highlight on paper/);
  assert.match(await bad(`@0\nimage p asset=photo w=1080 h=1920 frame=fill\ntext t "over a photo"\n`, pics), /"over a photo" sits straight on the picture p with nothing behind it/);
  await ok(`@0\nimage p asset=photo w=1080 h=1920 frame=fill\ntext t "over a photo" role=caption\n`, pics);
});

test("lighting a whole shape colors its lines and keeps its label readable", async () => {
  const s = await ok(`@0\nbox a "12" fill=ink\n@2 keep\nlight a color=ink\n`);
  assert.equal(at(s, 100, "a.label")!.props.color, theme.colors.paper);
  assert.equal(at(s, 100, "a.label")!.props.weight, 700);
});

test("words never sit on words or on pictures", async () => {
  assert.match(await bad(`@0\nfree f w=800 h=400\n  text a "hello there" at=50,50\n  text b "hello again" at=52,52\n`), /"hello there" and "hello again" overlap on screen/);
  assert.match(await bad(`@0\nfree f w=800 h=800\n  image p asset=photo w=600 h=600 at=50,50\n  text a "words" at=50,50\n`, pics), /"words" lies over the picture p/);
});

test("what leaves goes first when what arrives takes its place", async () => {
  const s = await ok(`@0\ntext a "old words"\n@2\ntext b "new words"\n`);
  assert.equal(num(at(s, 32, "b")?.props.opacity ?? 0), 0, "new words wait");
  assert.ok(num(at(s, 60, "b")!.props.opacity) > 0.9);
  assert.ok(num(at(s, 39, "a")?.props.opacity ?? 0) < 0.05, "old words are gone first");
});

test("the camera keeps words whole: it shifts to hold or clear them, and a drift stops before it cuts", async () => {
  const src = `@0\nimage p asset=photo w=1080 h=1920 frame=fill\nstack c role=panel\n  text t "words in the middle of things"\n@2 keep\ncamera p at=0.05,0.36,0.55,0.5 frames=10\n`;
  const s = await ok(src, pics);
  const cam = at(s, 100, "camera")!.props;
  const words = at(s, 100, "t.l1")!.props;
  const [w, h] = [estimate(String(words.text), num(words.size)), num(words.size) * 1.15];
  const [x, y] = [num(at(s, 100, "t")!.props.x) + num(words.x), num(at(s, 100, "t")!.props.y) + num(words.y)];
  const sx = (v: number) => (v - num(cam.panX)) * num(cam.zoom) + 540;
  const sy = (v: number) => (v - num(cam.panY)) * num(cam.zoom) + 960;
  const [l, r, t, d] = [sx(x - w / 2), sx(x + w / 2), sy(y - h / 2), sy(y + h / 2)];
  const out = r <= 0 || l >= 1080 || d <= 0 || t >= 1920;
  const whole = l >= 0 && r <= 1080 && t >= 0 && d <= safe.y + safe.h / 2;
  assert.ok(out || whole, `words at ${l},${t} to ${r},${d}`);
  const drift = await ok(`@0\nimage p asset=photo w=1080 h=1920 frame=fill\nstack c role=panel\n  text t "words"\n@2 keep\ncamera p at=0.2,0.3,0.8,0.5 frames=10 drift=2\n`, pics);
  const end = num(at(drift, 890, "camera")!.props.zoom);
  assert.ok(end < 1080 / (0.6 * 1080) * 0.95 * (1 + 2 * 28), "the drift was held back");
});

test("a picture once behind everything comes forward into the card that holds it", async () => {
  const s = await ok(`@0\nimage p asset=photo w=1080 h=1920 frame=fill\n@2\nstack c back=paper\n  image p asset=photo w=600 h=400\n  text cap "a card"\n`, pics);
  assert.equal(num(at(s, 100, "p")!.props.z), 0);
  assert.equal(num(at(s, 100, "c.back")!.props.z), -1);
});

test("everything placed has a size a viewer can see, and pointers are drawn, not emoji", async () => {
  assert.match(await bad(`@0\ndot d w=5\n`), /d comes out only \d+ by \d+ pixels, too small to see/);
  assert.match(await bad(`@0\nbox a "x"\ntag a "👇" side=top\n`), /"👇" is only emoji or symbols\. To point at something use mark pointer/);
  const s = await ok(`@0\nbox a "x"\nmark pointer a side=top\n`);
  const tip = at(s, 100, "mark.pointer.a.head")!;
  assert.ok(num(tip.props.y) < num(at(s, 100, "a")!.props.y), "the pointer sits above and points down");
  assert.ok(Math.abs(num(tip.props.rotate) - 90) < 1);
});

test("roles: the style decides the look, arrangements pass their role on, and dim takes the muted look", async () => {
  const s = await ok(`@0\ntext t "A title" role=title\nstack k role=key\n  text a "look here"\nstack p role=panel\n  text b "inside"\n`);
  const title = at(s, 30, "t.l1")!.props;
  assert.equal(title.font, "TitleFont");
  assert.equal(title.weight, 700);
  assert.equal(at(s, 30, "a.l1")!.props.color, theme.colors.accent);
  assert.equal(at(s, 30, "p.back")!.props.stroke, theme.colors.ink);
  assert.match(await bad(`@0\ntext a "x" role=boss\n`), /role=boss is not a role\..*Roles: title, heading/);
  const styled: CompileContext = { ...ctx, theme: { ...theme, roles: { muted: { color: "accent", opacity: 0.7 }, title: { color: "accent", size: 0.05, case: "upper" } } } };
  const m = await ok(`@0\ntext a "one"\ntext b "two" role=title\n@2 keep\ndim a\n`, {}, styled);
  assert.equal(at(m, 100, "a.l1")!.props.color, theme.colors.accent);
  assert.equal(num(at(m, 100, "a")!.props.opacity), 0.7);
  assert.equal(at(m, 30, "b.l1")!.props.text, "TWO");
  assert.ok(Math.abs(num(at(m, 30, "b.l1")!.props.size) / num(at(m, 30, "a.l1")!.props.size) - 54 / 70) < 0.01);
});

test("kit things move through the language: become reaches a kit in a slot, and math needs no doubled backslashes", async () => {
  const kits = { ...ctx, kits: [mathKit] };
  const s = await ok(`@0\nmath f states=["\\frac{a}{b}","\\frac{b}{a}"] size=90\n@2 keep\ndo become f state=1 frames=10\n`, {}, kits);
  assert.ok(s.tracks.some((t) => t.target.startsWith("f.") && t.prop === "x" && t.keys.some((k) => k.at >= 30)), "become moved the parts");
});

test("the renderer gives a part that names a role the style's look for what it left open", () => {
  const styled: Theme = { ...theme, roles: { pointer: { color: "accent", glow: 0.5 }, title: { case: "upper", weight: 800, font: "title" } } };
  assert.deepEqual(roleProps(styled, "pointer", "path", {}), { stroke: "#ff0000", glow: 6, glowColor: "#ff0000" });
  assert.deepEqual(roleProps(styled, "pointer", "path", { stroke: "#000000", glow: 0 }), {});
  assert.equal(roleProps(styled, "title", "text", { text: "hi" }).text, "HI");
  assert.equal(roleProps(styled, "title", "text", { text: "hi" }).font, "TitleFont");
  assert.deepEqual(roleProps(styled, "nonsense", "text", {}), {});
});
