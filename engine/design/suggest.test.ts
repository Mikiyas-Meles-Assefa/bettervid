import assert from "node:assert/strict";
import { test } from "node:test";
import { themeFrom } from "../render/theme.ts";
import { parseIntent } from "./intent/parse.ts";
import { edgeBand, styleValues, suggestDesign, viewingFrom } from "./suggest.ts";

const theme = themeFrom("flat");
const plan = parseIntent(`thing a "12 kg"\nthing b "30 kg"\nobject o "a small ball"\n@0\n  show a\n  keep b\n@3\n  ask "Which?"\n  show o\n@5\n  reveal b\n  o falls\n  stress`);
const v = (width: number, height: number) => viewingFrom({ width, height, fps: 30, screen: "a screen", frameWidthMm: 500, distanceMm: 2000, watch: "on purpose", why: "a test" });

test("a viewing assumes nothing it was not told", () => {
  const x = v(1920, 1080);
  assert.deepEqual(x.uiZones, []);
  assert.equal(x.captions.show, false);
  const y = viewingFrom({ ...x, captions: { show: true, box: [0, 0.9, 1, 1], why: "asked" } });
  assert.deepEqual(y.uiZones.map((z) => z.what), ["captions"]);
  assert.deepEqual(edgeBand("right", 0.2, "buttons").box, [0.8, 0, 1, 1]);
  assert.throws(() => viewingFrom({ ...x, fps: 0 }));
});

test("every suggested field says where it came from and why", () => {
  // The depicter's answer for the ball, so the suggestion knows its act is a fall (read off the depiction's verbs).
  const ball = { kind: "body", form: "sphere", label: "small ball", size: { w: 6.7, h: 6.7, unit: "cm" as const }, why: "a test" };
  const d = suggestDesign(plan, v(1080, 1920), theme, [], undefined, { o: ball });
  assert.equal(d.moments.length, 3);
  for (const m of d.moments)
    for (const k of ["importance", "focus", "subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"] as const) {
      const f = m[k];
      assert.ok(["style", "author"].includes(f.from), `${k} from ${f.from}`);
      assert.ok(f.why && f.why.length > 5, `${k} has a reason`);
    }
  // Proposals: one scale for the two same-unit quantities, a placeholder for the coming reveal.
  assert.deepEqual(d.moments[0]!.proposals.map((p) => p.value.kind), ["compare-scale"]);
  assert.deepEqual(d.moments[1]!.proposals.map((p) => [p.value.kind, p.value.ids]), [["placeholder", ["b"]]]);
  // The fall plays at real speed, then a slow replay.
  assert.equal(d.demos[0]!.speed.value, "real");
  assert.equal(d.demos[0]!.replay!.value.speed, "slow");
  for (const [k, s] of Object.entries(styleValues(theme, v(1080, 1920)))) assert.ok(s.why.length > 5, `${k} has a reason`);
});

test("the frame shape changes the suggestion; a plain moment gets no proposals", () => {
  const wide = suggestDesign(plan, v(1920, 1080), theme);
  assert.equal(wide.moments[1]!.arrangement.value, "row");
  assert.equal(suggestDesign(plan, v(1080, 1920), theme).moments[1]!.arrangement.value, "stack");
  const plain = parseIntent(`thing a "12 kg"\nthing b "30 kg"\n@0\n  show a\n  keep b\n  plain`);
  assert.deepEqual(suggestDesign(plain, v(1080, 1920), theme).moments[0]!.proposals, []);
});
