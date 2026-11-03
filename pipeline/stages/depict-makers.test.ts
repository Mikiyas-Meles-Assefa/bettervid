// The depiction makers (pipeline/lib/depict-makers.ts) with fake image, SAM, reader and archive calls: a sprite made,
// cut, cached and drawn; a sprite SAM cannot read made again with what was wrong; a real picture read into parts with
// masks and drawn; a found picture kept with its credit. No network and no spend. Needs ffmpeg, as the pipeline does.
// Run: node --experimental-strip-types --test pipeline/stages/depict-makers.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Theme } from "../../engine/core/types.ts";
import { getSprite, pictureDepiction, spriteDepiction, spriteRequest, suggestLook, type PropSpec } from "../../engine/design/depict/index.ts";
import type { AgentTask, Reasoner } from "../../engine/design/types.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import type { Candidate } from "../lib/archives.ts";
import { encodePng, findPicture, joint, metaDepictMakers, metaSpriteMaker, pictureParts, placeMask, type SamMask, type Segmenter } from "../lib/depict-makers.ts";

const theme: Theme = themeFrom("flat");
const look = suggestLook(theme, 0.4);
type Rect = [number, number, number, number]; // x0, y0, x1, y1 in pixels, end exclusive
const inRect = ([x0, y0, x1, y1]: Rect, x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

/** A picture: a plain background with colored rectangles. */
function picture(w: number, h: number, rects: [Rect, [number, number, number]][]): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rects.find(([r]) => inRect(r, x, y))?.[1] ?? [245, 242, 235];
    px.set([...c, 255], (y * w + x) * 4);
  }
  return encodePng(w, h, 4, px);
}

/** What SAM would return for a set of rectangles: one mask over their box, at half resolution, as SAM's rasters are smaller. */
function sam(rects: Rect[], confidence = 0.9): SamMask {
  const [left, top, right, bottom] = [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
  const width = Math.ceil((right - left) / 2);
  const height = Math.ceil((bottom - top) / 2);
  const raster = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raster[y * width + x] = rects.some((r) => inRect(r, left + x * 2 + 1, top + y * 2 + 1)) ? 1 : 0;
  return { raster, width, height, bounds: { left, top, right, bottom }, confidence };
}

// A lamp in a 200 by 200 picture: a shade on a stem on a base.
const SHADE: Rect = [60, 30, 140, 70];
const STEM: Rect = [96, 70, 104, 140];
const BASE: Rect = [70, 140, 130, 160];
const LAMP = picture(200, 200, [[SHADE, [210, 60, 50]], [STEM, [60, 60, 60]], [BASE, [40, 40, 90]]]);
const spec: PropSpec = { kind: "sprite", label: "desk lamp", tier: 2, sprite: { parts: [{ name: "shade", phrase: "the lamp shade", changes: ["tint", "turn"] }, { name: "base", phrase: "the round base", changes: ["tint"] }] }, colors: { warm: "#ffcf66" }, colorSources: { warm: "known" }, why: "sample" };

test("placing a SAM mask scales its raster to its box, and a part's joint is where it meets the rest", () => {
  const m = placeMask(sam([[10, 10, 20, 30]]), 40, 40);
  assert.equal(m.on.reduce((n, v) => n + v, 0), 10 * 20);
  assert.equal(m.on[10 * 40 + 10], 1);
  assert.equal(m.on[9 * 40 + 10], 0);
  const whole = placeMask(sam([SHADE, STEM, BASE]), 200, 200);
  const shade = placeMask(sam([SHADE]), 200, 200);
  const [jx, jy] = joint(shade, whole, 2)!;
  assert.ok(Math.abs(jx - 0.5) < 0.01 && Math.abs(jy - 0.35) < 0.01, `the shade joins the stem at its bottom middle, got ${jx}, ${jy}`);
  assert.equal(joint(placeMask(sam([[0, 0, 5, 5]]), 200, 200), whole, 2), undefined, "a part touching nothing has no joint");
});

test("sprite: Muse Image draws it, SAM cuts the thing and its parts, the cache keeps it, and it becomes a depiction", async () => {
  const root = mkdtempSync(join(tmpdir(), "makers-"));
  try {
    const prompts: string[] = [];
    const phrases: string[] = [];
    const charged: [number, string][] = [];
    const segment: Segmenter = async (_file, phrase) => {
      phrases.push(phrase);
      const masks = phrase === "desk lamp" ? [sam([SHADE, STEM, BASE])] : phrase === "the lamp shade" ? [sam([[0, 0, 30, 30]], 0.99), sam([SHADE], 0.8)] : phrase === "the round base" ? [sam([BASE])] : [];
      return { masks, usd: 0.0025 };
    };
    const maker = metaSpriteMaker({ image: async (p) => (prompts.push(p), { png: LAMP, usd: 0.01 }), segment, charge: (usd, d) => charged.push([usd, d]) });
    const req = spriteRequest(spec, "a desk lamp with a cone shade", { name: "flat", art: "flat vector, bold outlines, two tones" });
    assert.equal(req.label, "desk lamp");
    const s1 = await getSprite(req, maker, { value: true, from: "designer", why: "the lamp carries the moment" }, root);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /flat vector/);
    assert.deepEqual(phrases.sort(), ["desk lamp", "the lamp shade", "the round base"]);
    assert.equal(charged.length, 4);
    assert.ok(Math.abs(charged.reduce((n, [u]) => n + u, 0) - 0.0175) < 1e-9);
    // Cropped to the lamp with a 2 px margin: x 58..141, y 28..161.
    assert.deepEqual(s1.size, [84, 134]);
    for (const n of ["shade", "base"]) assert.ok(existsSync(join(s1.dir, s1.parts[n]!.mask)), `the ${n} mask is saved`);
    assert.ok(existsSync(join(s1.dir, s1.src)));
    const [x0, y0, x1, y1] = s1.parts.shade!.box;
    assert.ok(Math.abs(x0 - 2 / 84) < 0.01 && Math.abs(y0 - 2 / 134) < 0.01 && Math.abs(x1 - 82 / 84) < 0.01 && Math.abs(y1 - 42 / 134) < 0.01, `the shade's box, not the background patch: ${s1.parts.shade!.box}`);
    assert.ok(s1.parts.shade!.anchor && Math.abs(s1.parts.shade!.anchor[1] - 42 / 134) < 0.02, "a turning part turns about where it meets the stem");
    assert.equal(s1.parts.base!.anchor, undefined, "a tint-only part needs no joint");
    const s2 = await getSprite(req, maker, { value: false, from: "designer" }, root);
    assert.equal(prompts.length, 1, "the second ask is a cache hit");
    assert.deepEqual(s2.parts, JSON.parse(JSON.stringify(s1.parts)));
    const d = spriteDepiction("lamp", s2, spec, theme, look);
    assert.equal(d.tier, 2);
    assert.ok(d.parts.shade && d.parts.base && d.parts.whole);
    const turned = d.apply({ "angle.shade": -20 }, { frames: 10 });
    assert.ok(turned.some((c) => c.id === "lamp.part.shade" && c.prop === "rotate"));
    const warm = d.act("turns", "warm");
    assert.ok(warm.known && warm.changes.some((c) => c.id === "lamp.tint.shade"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sprite: a picture SAM cannot read is made again with what was wrong, and a maker that keeps failing throws", async () => {
  const req = spriteRequest(spec, "a desk lamp", { name: "flat", art: "flat" });
  const prompts: string[] = [];
  let round = 0;
  const segment: Segmenter = async (_f, phrase) => ({ masks: phrase === "desk lamp" ? [sam([SHADE, STEM, BASE])] : phrase === "the lamp shade" ? [sam([SHADE])] : round > 1 ? [sam([BASE])] : [], usd: 0 });
  const maker = metaSpriteMaker({ image: async (p) => (round++, prompts.push(p), { png: LAMP, usd: 0 }), segment });
  const made = await maker.make(req);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /could not be used: SAM found no "the round base"/);
  assert.ok(made.masks.base && made.masks.shade);
  const never = metaSpriteMaker({ image: async () => ({ png: LAMP, usd: 0 }), segment: async (_f, phrase) => ({ masks: phrase === "desk lamp" ? [sam([SHADE, STEM, BASE])] : [sam([SHADE, STEM, BASE])], usd: 0 }), rounds: 2 });
  await assert.rejects(never.make(req), /could not cut it after 2 pictures: .*could not be told apart from the whole desk lamp/);
});

// A screenshot-like picture: a panel and a button.
const PANEL: Rect = [20, 20, 180, 120];
const BUTTON: Rect = [200, 140, 280, 180];

function reader(answers: unknown[]): Reasoner & { asked: AgentTask[] } {
  const asked: AgentTask[] = [];
  return { asked, ask: async <T,>(t: AgentTask) => (asked.push(t), { status: "answered" as const, value: answers[Math.min(asked.length - 1, answers.length - 1)] as T }) };
}

test("picture: the reader finds the named parts (repaired when one is unaccounted for), SAM masks them, and it draws", async () => {
  const root = mkdtempSync(join(tmpdir(), "makers-"));
  try {
    const file = join(root, "screen.png");
    writeFileSync(file, picture(300, 200, [[PANEL, [200, 220, 240]], [BUTTON, [30, 120, 60]]]));
    const parts = { panel: { box: [20 / 300, 0.1, 0.6, 0.6], about: "the settings panel" }, button: { box: [200 / 300, 0.7, 280 / 300, 0.9], about: "the save button", text: "Save" } };
    const r = reader([
      { kind: "screenshot", about: "a settings screen", parts: { panel: parts.panel }, words: ["Save"], missing: [] },
      { kind: "screenshot", about: "a settings screen", parts, words: ["Save"], missing: ["logo"] },
    ]);
    const segment: Segmenter = async (_f, phrase) => ({ masks: phrase === "save button" ? [sam([PANEL], 0.99), sam([BUTTON], 0.7)] : [], usd: 0.0025 });
    const charged: number[] = [];
    const asks = [{ name: "button", about: "the button that saves", phrase: "save button", mask: true }, { name: "panel" }, { name: "logo", about: "the company logo" }];
    const made = await pictureParts(file, asks, { reasoner: r, segment, root, charge: (u) => charged.push(u) });
    assert.equal(r.asked.length, 2);
    assert.match(r.asked[0]!.request, /- button: the button that saves/);
    assert.match(r.asked[1]!.request, /"button" was asked for but has no box/);
    assert.deepEqual(made.missing, ["logo"]);
    assert.equal(made.card.checked.ok, true);
    assert.deepEqual(made.card.size, [300, 200]);
    assert.ok(made.masks?.button && existsSync(made.masks.button), "the mask that matches the reader's box is kept");
    assert.equal(made.masks?.panel, undefined);
    assert.deepEqual(charged, [0.0025]);
    const again = await pictureParts(file, asks, { reasoner: r, segment, root });
    assert.equal(r.asked.length, 2, "the second ask is a cache hit");
    assert.deepEqual(again.card, made.card);
    const d = pictureDepiction("pic", made.card, made.src, theme, look, { tier: made.tier, masks: made.masks });
    assert.equal(d.tier, 3);
    assert.ok(d.parts.button && d.parts.panel);
    const zoom = d.act("zooms to", "button");
    assert.ok(zoom.known && zoom.changes.some((c) => c.id === "pic.img" && c.prop === "crop"));
    // A mask SAM cannot find where the reader boxed the part is an error, not a box standing in for it.
    await assert.rejects(pictureParts(file, [{ name: "button", mask: true }], { reasoner: r, segment: async () => ({ masks: [sam([PANEL])], usd: 0 }), root }), /SAM found no "button" where the reader boxed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("found picture: the archives are searched, the pick is kept with its credit, and it comes back as tier 4", async () => {
  const root = mkdtempSync(join(tmpdir(), "makers-"));
  try {
    const big = picture(1000, 1000, [[[300, 300, 700, 700], [90, 90, 90]]]);
    const cand = (n: number): Candidate => ({ source: "Commons", title: `candidate ${n}`, license: "CC0", credit: `maker ${n}`, page: `https://example.org/${n}`, thumb: `https://example.org/t${n}.png`, full: `https://example.org/f${n}.png` });
    const searched: string[] = [];
    const find = { root: join(root, "found"), search: async (q: string) => (searched.push(q), [cand(0), cand(1)]), download: async () => new Uint8Array(big), pick: async () => ({ pick: 1, reason: "it shows the thing whole", usd: 0.001 }) };
    const r = reader([{ kind: "photo", about: "a grey square", parts: { square: { box: [0.3, 0.3, 0.7, 0.7], about: "the square" } }, words: [], missing: [] }]);
    const makers = metaDepictMakers({ reasoner: r, pictureRoot: join(root, "pictures"), find });
    const made = await makers.picture!("a grey square block", undefined, [{ name: "square" }]);
    assert.equal(made.tier, 4);
    assert.equal(made.found?.title, "candidate 1");
    assert.equal(made.found?.credit, "maker 1");
    assert.ok(made.card.parts.square?.box);
    assert.match(r.asked[0]!.request, /candidate 1 \(Commons\); wanted as: a grey square block/);
    const again = await findPicture("a grey square block", { ...find, search: async () => assert.fail("cached") });
    assert.equal(again.path, made.found!.path);
    const small = { ...find, root: join(root, "small"), download: async () => new Uint8Array(picture(200, 200, [])) };
    await assert.rejects(findPicture("another thing", small), /too small/);
    await assert.rejects(findPicture("a third thing", { ...find, root: join(root, "none"), pick: async () => ({ pick: null, reason: "none is it", usd: 0 }) }), /no candidate shows it: none is it/);
    assert.ok(searched.includes("a grey square block"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
