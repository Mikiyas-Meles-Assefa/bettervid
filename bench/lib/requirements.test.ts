import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scene } from "../../engine/core/types.ts";
import type { PartCard, Requirement } from "../../engine/design/types.ts";
import { frameOf } from "./case.ts";
import { checkRequirementsOnScene, partOnFrame } from "./requirements.ts";
import { DEFAULTS } from "./settings.ts";
import { tile } from "./steps.ts";

// A 1000 by 500 picture with a heading (40 px tall words) and a figure in its right half.
const card: PartCard = {
  name: "pic",
  file: "pic.png",
  size: [1000, 500],
  kind: "slide",
  about: "a slide",
  parts: { heading: { box: [0.05, 0.05, 0.5, 0.13], about: "heading", text: "Heading" }, figure: { box: [0.5, 0.2, 1, 1], about: "the figure" }, label: { box: [0.6, 0.9, 0.9, 0.96], about: "the figure's label", text: "Label" } },
  requirements: [],
  checked: { ok: true, notes: [] },
};
const req = (over: Partial<Requirement>): Requirement => ({ id: "r", source: { file: "brief", where: "sentence.1" }, kind: "show exactly", detail: "", why: "", ...over });

// 2 s at 30 fps on a 1080 by 1920 frame: the picture full width for the first second, then gone; a green title throughout.
function scene(w = 1080): Scene {
  const h = w / 2;
  return {
    fps: 30, width: 1080, height: 1920, frames: 60, background: "#ffffff", events: [],
    nodes: [
      { id: "p", kind: "image", props: { x: 540, y: 960, w, h, src: "SRC" } },
      { id: "t", kind: "text", props: { x: 540, y: 200, text: "A green title", size: 80, color: "#1f5c46" } },
      { id: "u", kind: "text", props: { x: 540, y: 1700, text: "red words", size: 80, color: "#cc0000" } },
    ],
    tracks: [{ target: "p", prop: "opacity", keys: [{ at: 0, value: 1 }, { at: 29, value: 1 }, { at: 30, value: 0 }] }],
  } as unknown as Scene;
}

test("a part of a picture is placed on the frame through the image's box, fit and crop", () => {
  const box = { x0: 0, y0: 710, x1: 1080, y1: 1250 };
  assert.deepEqual(partOnFrame([0.5, 0, 1, 1], box, { w: 1080, h: 540 }, [1000, 500]), { x0: 540, y0: 710, x1: 1080, y1: 1250 });
  // A square box shows a 2:1 picture letterboxed (contain): its height is half the box's.
  const sq = partOnFrame([0, 0, 1, 1], { x0: 0, y0: 0, x1: 1000, y1: 1000 }, { w: 1000, h: 1000 }, [1000, 500]);
  assert.deepEqual(sq, { x0: 0, y0: 250, x1: 1000, y1: 750 });
  // A crop of the right half fills the box: the right half's left edge is at the box's left edge.
  const crop = partOnFrame([0.5, 0, 1, 1], { x0: 0, y0: 0, x1: 500, y1: 500 }, { w: 500, h: 500, crop: [0.5, 0, 0.5, 1], srcW: 1000, srcH: 500 }, [1000, 500]);
  assert.deepEqual(crop, { x0: 0, y0: 0, x1: 500, y1: 500 });
});

test("a required figure is reported on screen, legible and for how long", () => {
  const [r] = checkRequirementsOnScene([req({ applies: "pic.figure" })], [card], scene(), { pic: "SRC" }, DEFAULTS.read);
  assert.equal(r!.measured, "picture");
  assert.ok(Math.abs(r!.seconds! - 1) < 0.15); // within one sample (a quarter second)
  assert.equal(r!.firstAt, 0);
  // The label is 6% of 540 px tall = 32 px of words, about 40 px of type: 3.75% of the width, just over "cannot read".
  assert.ok(r!.textShare! > 0.035 && r!.textShare! < 0.04);
  assert.equal(r!.legibleSeconds, 0);
  assert.equal(r!.met, false);
  // Half again as large it reads (the picture is cut by the frame's sides, most of the label stays in).
  const [big] = checkRequirementsOnScene([req({ applies: "pic.label" })], [card], scene(1620), { pic: "SRC" }, DEFAULTS.read);
  assert.equal(big!.met, true);
  assert.ok(Math.abs(big!.legibleSeconds! - 1) < 0.15);
  // Long enough is the case's setting.
  const [long] = checkRequirementsOnScene([req({ applies: "pic.label" })], [card], scene(1620), { pic: "SRC" }, DEFAULTS.read, { seconds: 3 });
  assert.equal(long!.met, false);
  assert.ok(long!.notes.some((n) => n.includes("of the 3 s asked")));
});

test("a picture never shown is not met; a requirement geometry cannot see is not measured", () => {
  const out = checkRequirementsOnScene([req({ id: "a", applies: "pic" }), req({ id: "b", applies: "pic" }), req({ id: "c", detail: "never say cheap" })], [card], scene(), { pic: "OTHER" }, DEFAULTS.read);
  assert.equal(out[0]!.met, false);
  assert.ok(out[0]!.notes[0]!.includes("never on screen"));
  assert.equal(out[2]!.measured, "no");
  assert.equal(out[2]!.met, undefined);
});

test("named colors are checked against what is painted", () => {
  const [c] = checkRequirementsOnScene([req({ detail: "headings in #1F5C46, text in #2B2B2B" })], [card], scene(), { pic: "SRC" }, DEFAULTS.read);
  assert.equal(c!.measured, "colors");
  assert.ok(c!.paletteShare! > 0.4 && c!.paletteShare! < 0.7); // the green title, not the red words
  assert.equal(c!.met, false);
  assert.ok(c!.notes.some((n) => n.includes("#cc0000")));
});

test("a case's frame shape sets the frame and the watch sheets' tiles", () => {
  assert.deepEqual(frameOf({}), [1080, 1920]);
  assert.deepEqual(frameOf({ measure: { context: { frame: "16:9" } } }), [1920, 1080]);
  assert.deepEqual(frameOf({ measure: { context: { frame: "4:5" } } }), [1080, 1350]);
  assert.deepEqual(frameOf({ measure: { context: { frame: "1:1" } } }), [1080, 1080]);
  assert.throws(() => frameOf({ measure: { context: { frame: "wide" } } }));
  assert.deepEqual(tile({ width: 1080, height: 1920 }), [270, 480]);
  assert.deepEqual(tile({ width: 1920, height: 1080 }), [480, 270]);
  assert.deepEqual(tile({ width: 1080, height: 1350 }), [384, 480]);
});
