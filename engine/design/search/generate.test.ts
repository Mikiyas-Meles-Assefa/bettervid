import assert from "node:assert/strict";
import { test } from "node:test";
import { themeFrom } from "../../render/theme.ts";
import { parseIntent } from "../intent/parse.ts";
import { suggestDesign, viewingFrom } from "../suggest.ts";
import { composeCached, newCache, withMoment } from "./evaluate.ts";
import { packerVariants, withFields } from "./generate.ts";

const theme = themeFrom("flat");
const words = Array.from({ length: 30 }, (_, i) => ({ text: `w${i}`, start: 0.2 + i * 0.4 }));
const frames = 13 * 30;
const plan = parseIntent(`thing a "a few words"
thing b "other words"

@0
  show a
@12
  show b
`);
const viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "phone", frameWidthMm: 65, distanceMm: 300, watch: "on purpose", why: "test" });

test("packer variants come from the composition: fill reaches the usable frame's limiting side, room variants use the empty height", () => {
  const design = suggestDesign(plan, viewing, theme, [], words);
  const ctx = { plan, compose: { theme, words, frames }, cache: newCache() };
  const c = composeCached(plan, design, ctx);
  const md = design.moments[0]!;
  const gen = { plan, design, words, theme, boxes: c.boxes };
  const vs = packerVariants(md, 0, gen);
  const fill = vs.find((v) => v.label === "fill");
  // A line of words in a tall frame is limited by the width: the fill scale is the width ratio, above 1.
  assert.ok(fill && (fill.set.subjectScale as number) > md.subjectScale.value, JSON.stringify(vs.map((v) => v.label)));
  const low = vs.find((v) => v.label === "low")!;
  assert.deepEqual(low.set.subjectAt, [md.subjectAt.value[0], 1]);
  assert.ok(vs.some((v) => v.label === "center") || Math.abs(md.subjectAt.value[1] - 0.5) < 0.05);
  // Each one composes into a different layout of the moment.
  const boxOf = (set: Record<string, unknown>) => composeCached(plan, withMoment(design, withFields(md, set, "test")), ctx).boxes.find((b) => b.moment === 0)!.boxes.a!;
  const now = c.boxes.find((b) => b.moment === 0)!.boxes.a!;
  assert.notDeepEqual(boxOf(low.set), now);
  assert.ok(boxOf(low.set)[3] > now[3], "the low variant moves the anchor into the room below");
  assert.notDeepEqual(boxOf(fill!.set), now);
  // Without boxes the variants still exist (subjectScale 1 when below it).
  assert.ok(packerVariants({ ...md, subjectScale: { value: 0.6, from: "style" } }).some((v) => v.label === "fill" && v.set.subjectScale === 1));
});
