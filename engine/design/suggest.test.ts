import assert from "node:assert/strict";
import { test } from "node:test";
import { themeFrom } from "../render/theme.ts";
import { parseIntent } from "./intent/parse.ts";
import { frameDegrees } from "./instruments/index.ts";
import { edgeBand, isDifference, lengthsIn, proposalsOf, styleValues, suggestDesign, suggestViewing, viewingFrom } from "./suggest.ts";
import type { PartCard } from "./types.ts";

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

test("the viewing's size comes from what the request and its context say: lengths as given, else the screen's kind", () => {
  // Lengths the words give are used as they are: 3 m from a 1.2 m wide screen; a 16:9 frame fills its width.
  const tv = suggestViewing({ screen: "TV", distance: "across a living room, about 3 m from a 1.2 m wide screen" }, 1920, 1080);
  assert.equal(tv.distanceMm, 3000);
  assert.ok(Math.abs(tv.frameWidthMm - 1200) <= 1, `${tv.frameWidthMm}`);
  assert.match(tv.why, /as the words say/);
  // A tall frame on the same screen fills its height, so it is narrower than the screen.
  const tallTv = suggestViewing({ screen: "TV", distance: "about 3 m from a 1.2 m wide screen" }, 1080, 1920);
  assert.ok(tallTv.frameWidthMm < 450 && tallTv.frameWidthMm > 300, `${tallTv.frameWidthMm}`);
  assert.match(tallTv.why, /fills the screen's height/);
  // A diagonal in inches.
  const inch = suggestViewing({ screen: "a 55 inch TV", distance: "2.5 m away" }, 1920, 1080);
  assert.ok(Math.abs(inch.frameWidthMm - 1218) < 5, `${inch.frameWidthMm}`);
  assert.equal(inch.distanceMm, 2500);
  // No numbers: the screen's kind gives a typical size and the words a typical distance, each said as such.
  const laptop = suggestViewing({ screen: "laptop", distance: "at a desk" }, 1920, 1080);
  assert.ok(laptop.frameWidthMm > 250 && laptop.distanceMm >= 500, JSON.stringify(laptop));
  assert.match(laptop.why, /laptop/);
  const room = suggestViewing({ screen: "classroom screen", distance: "across a classroom" }, 1080, 1920);
  assert.ok(room.distanceMm >= 3000 && room.frameWidthMm > 300, JSON.stringify(room));
  const phone = suggestViewing({ screen: "phone", distance: "arm's length" }, 1080, 1920);
  assert.ok(phone.frameWidthMm < 100 && phone.distanceMm <= 400, JSON.stringify(phone));
  // The pipeline has only the request: its words name the screen; a phone turns to suit a wide frame.
  assert.ok(suggestViewing({ request: "Make a lesson for our living room TV" }, 1920, 1080).distanceMm > 2000);
  assert.ok(suggestViewing({ request: "for my phone" }, 1920, 1080).frameWidthMm > 100, "a phone held sideways for a wide frame");
  // Nothing said: the frame's shape alone, and the reason says nothing was stated.
  assert.match(suggestViewing({}, 1080, 1920).why, /no screen is named/);
  // The physical size changes what the instruments measure: the TV frame is far wider in the eye than a phone's.
  assert.ok(frameDegrees(viewingFrom({ width: 1920, height: 1080, fps: 30, ...tv })) > frameDegrees(viewingFrom({ width: 1080, height: 1920, fps: 30, ...phone })));
});

test("lengths are read with their units, and a width or a diagonal is told apart from a distance", () => {
  const l = lengthsIn('about 3 m from a 1.2 m wide screen, or 10 feet from a 65" set, 40 cm across');
  assert.deepEqual(l.distance, [3000, 3048]);
  assert.deepEqual(l.width, [1200, 400]);
  assert.equal(Math.round(l.diagonal[0]!), 1651);
  assert.deepEqual(lengthsIn("24.30 mL at 30 s").distance, [], "millilitres and seconds are not lengths");
});

test("a quantity said that is the gap between two bars is not drawn as a level on the chart's scale", () => {
  const card = (values: number[]): PartCard => ({
    name: "chart",
    file: "chart.png",
    kind: "chart",
    about: "a bar chart",
    parts: { "bar-a": { box: [0, 0, 0.5, 1], about: "bar a" }, "bar-b": { box: [0.5, 0, 1, 1], about: "bar b" } },
    data: { kind: "bars", orient: "v", labels: ["a", "b"], values, ymax: 60, plot: [0, 0, 1, 1], parts: ["bar-a", "bar-b"] } as unknown as PartCard["data"],
    requirements: [],
    checked: { ok: true, notes: [] },
  });
  const p = (said: string) => parseIntent(`thing q "${said}"\n@0\n  show q\n  keep chart.bar-a chart.bar-b\n`);
  // 23 is 52 less 29: a gap, never a level.
  assert.deepEqual(proposalsOf(p("23 °C gap"), 0, [card([52, 29])]).filter((x) => x.value.kind === "level"), []);
  // A value that is on the chart is a level, as before.
  assert.equal(proposalsOf(p("29 °C"), 0, [card([52, 29])]).filter((x) => x.value.kind === "level").length, 1);
  assert.equal(isDifference(23, [52, 29]), true);
  assert.equal(isDifference(29, [52, 29, 23]), false, "a value on the chart is itself, even when it is also a difference");
  assert.equal(isDifference(23.4, [52, 29]), false, "a difference must match to the precision it is written with");
});
