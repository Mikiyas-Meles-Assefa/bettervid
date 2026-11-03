// Style values as suggestions (docs/DESIGN-BRAIN.md 2.5). Every number of taste the composer uses starts here, from the
// theme's design system (type scale, dim, motion feel) or from the viewing (frame shape, UI zones), each with its reason,
// and each can be overridden: per video in Design.overrides ({ key, value, why }), per moment with a key "key@N" where N
// is the moment's index in the plan, or by the MomentDesign fields themselves. Nothing here is a rule.
import { roleLook } from "../core/roles.ts";
import type { Theme } from "../core/types.ts";
import { idsOf } from "./intent/parse.ts";
import { actKinds, depictAll, type ActKind } from "./compose/acts.ts";
import type { PropSpec } from "./depict/index.ts";
import type { Box, CameraPlan, Decided, DemoPlan, Design, IntentPlan, Moment, MomentDesign, PartCard, Viewing, Word } from "./types.ts";
import { numOf } from "./abilities/types.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Viewing: built from a plain description; nothing is assumed (no phone, no captions, no UI) unless the caller says so.

export type ViewingDesc = {
  width: number;
  height: number;
  fps: number;
  screen: string;
  frameWidthMm: number;
  distanceMm: number;
  watch: string;
  uiZones?: { box: Box; what: string }[];
  captions?: { show: boolean; box?: Box; why: string };
  why: string;
};

export function viewingFrom(d: ViewingDesc): Viewing {
  if (!(d.width > 0 && d.height > 0 && d.fps > 0)) throw new Error("a viewing needs a frame size and a frame rate");
  const zones = [...(d.uiZones ?? [])];
  const captions = d.captions ?? { show: false, why: "no captions were asked for" };
  if (captions.show && captions.box && !zones.some((z) => z.box.join() === captions.box!.join())) zones.push({ box: captions.box, what: "captions" });
  return { width: d.width, height: d.height, fps: d.fps, screen: d.screen, frameWidthMm: d.frameWidthMm, distanceMm: d.distanceMm, watch: d.watch, uiZones: zones, captions, why: d.why };
}

/** A band along one edge of the frame, as a UI zone: `share` of the frame's height (top, bottom) or width (left, right). */
export function edgeBand(edge: "top" | "bottom" | "left" | "right", share: number, what: string): { box: Box; what: string } {
  const s = Math.max(0, Math.min(1, share));
  const box: Box = edge === "top" ? [0, 0, 1, s] : edge === "bottom" ? [0, 1 - s, 1, 1] : edge === "left" ? [0, 0, s, 1] : [1 - s, 0, 1, 1];
  return { box, what };
}

export type Shape = "tall" | "wide" | "square";
export const shapeOf = (v: Pick<Viewing, "width" | "height">): Shape => (v.height > v.width * 1.15 ? "tall" : v.width > v.height * 1.15 ? "wide" : "square");

// ---------------------------------------------------------------------------------------------------------------------
// Style values. Sizes are shares of the frame's shorter side; times are seconds; opacities 0 to 1.

export type StyleValue = { value: unknown; why: string };

export function styleValues(theme: Theme, viewing: Viewing): Record<string, StyleValue> {
  const d = theme.design;
  const base = d?.scale.base ?? 0.046;
  const ratio = d?.scale.ratio ?? 1.25;
  const step = (n: number) => Math.round(base * ratio ** n * 10000) / 10000;
  const scaleWhy = d ? `the style's type scale (base ${base}, ratio ${ratio})` : "a type scale of base 0.046 and ratio 1.25 (the theme has no design layer)";
  const muted = roleLook(theme, "muted").opacity;
  const dim = d?.elements.dim.amount;
  const fps = viewing.fps;
  const moveS = theme.moveFrames / 30;
  const feel = theme.style?.motion.feel;
  const v: Record<string, StyleValue> = {};
  const set = (key: string, value: unknown, why: string) => (v[key] = { value, why });
  // Frame
  set("frame.margin", 0.06, "a page margin of about 6% of the shorter side keeps things off the frame's edge");
  set("space.gaps", [0.09, 0.045, 0.022], "spacing steps from generous to tight; the packer takes the largest that fits");
  set("stage.steady", true, "things that persist keep one size and place across the moments they stay on screen, while words take turns");
  set("support.floor", 0.7, "support words may shrink to 70% of their size before the anchor gives up room");
  set("anchor.floor", 0.5, "the anchor may shrink to half its asked size to make room for what must stay");
  // Type
  set("type.subjectMax", step(7.4), `${scaleWhy}, step 7.4: the largest a subject's words are set`);
  set("type.support", step(1.5), `${scaleWhy}, step 1.5: support words`);
  set("type.question", step(2.2), `${scaleWhy}, step 2.2: a question to the viewer`);
  set("type.label", step(0.4), `${scaleWhy}, step 0.4: labels and arrow words`);
  set("type.min", theme.style?.read?.text ?? step(0), theme.style?.read?.text ? "the style's smallest readable text" : `${scaleWhy}, step 0: the smallest text the composer sets`);
  set("type.placeholder", step(3.9), `${scaleWhy}, step 3.9: a placeholder when something else is the subject`);
  set("type.lineHeight", 1.12, "line height for display type");
  set("type.twoLineGain", 1.2, "a subject goes onto two lines when that makes it at least 20% larger");
  set("type.wrong", 0.85, "a wrong idea is set a little smaller once marked");
  set("type.enterFrom", 0.9, "words arrive from 90% of their size");
  set("type.revealFrom", 0.6, "a revealed answer pops in from 60% of its size");
  // Support and focus
  set("support.opacity", muted !== undefined ? Math.min(0.8, Math.max(0.55, muted)) : 0.62, muted !== undefined ? "the style's muted role, kept between 0.55 and 0.8 so support stays readable" : "support steps back to about 60%");
  set("wrong.opacity", 0.85, "a wrong idea stays visible");
  // Many
  set("many.support", 0.22, "countable marks kept as support span about a fifth of the shorter side");
  set("many.paired", 0.3, "marks compared side by side span about a third each");
  set("many.labelGap", 0.022, "space between marks and their label");
  set("many.enter", 0.8, "marks appear one by one over at most 0.8 s");
  set("many.markStep", 0.05, "at most 0.05 s between marks appearing");
  set("many.markFrames", 0.27, "each mark grows in over 0.27 s");
  // Compare
  set("compare.columnHeight", 0.3, "compared columns are at most 30% of the usable height");
  set("compare.gap", 0.045, "space between compared things");
  set("compare.columnWidth", 0.62, "a column takes 62% of its half");
  set("compare.barMax", 0.9, "the larger magnitude bar spans 90% of the width");
  set("compare.barThick", 0.03, "magnitude bars are thin");
  set("compare.valueGap", 0.022, "space between a value and its column");
  // Marks
  set("arrow.gap", 0.09, "space for an arrow between two things");
  set("arrow.len", 0.065, "arrow length");
  set("arrow.head", 0.017, "arrow head");
  set("mark.width", 0.0074, "stroke of arrows, pointers and outlines");
  set("pointer.head", 0.022, "pointer head");
  set("pointer.gap", 0.011, "a pointer stops short of what it joins");
  set("level.width", 0.0065, "a level line's stroke");
  set("level.dash", [0.022, 0.015], "a level line's dash and gap");
  set("strike.width", 0.0093, "a strike line's stroke");
  set("strike.pad", 0.037, "a strike runs past the words");
  // Pictures
  set("picture.closeUnder", 0.35, "parts narrower than 35% of the picture are closed in on");
  set("picture.fill", [0.55, 0.95], "a part closed in on takes about half the window's width");
  set("picture.zoomMax", 3, "never closer than 3x: the picture's own pixels stay sharp enough");
  set("picture.zoomSupport", 1.5, "a part kept as support is closed in on at most 1.5x");
  set("picture.zoomMin", 1.08, "zooms under 1.08x are not worth the move");
  set("picture.dim", dim ?? 0.45, dim !== undefined ? "the style's dim amount, for the rest of a picture while a part is the subject" : "the rest of a picture dims to 45% while a part is the subject");
  set("picture.supportOutline", 0.55, "a part kept as support gets a quieter outline");
  set("picture.photoWidth", 1, "the user's original is shown at the full width of its place");
  // Charts with data
  set("chart.valueScale", 1.25, "values written at bars are a little larger than labels");
  set("chart.headBig", 0.11, "a chart's own words set large when they are the subject");
  set("chart.headShare", 0.62, "a large header row takes at most 62% of the chart's width");
  set("chart.rowLine", 1.4, "header and label rows");
  set("chart.gap", 0.015, "space inside a chart");
  set("chart.barFrac", 0.7, "a bar takes 70% of its slot in the redrawn chart");
  set("chart.photoBarFrac", 0.72, "a bar's share of its slot on the original, when the reading does not say");
  set("chart.dimBars", 0.22, "bars not in focus step far back while a part is held");
  set("chart.dimText", 0.45, "words not in focus step back");
  set("chart.labelOpacity", 0.8, "labels with nothing in focus");
  set("chart.levelPad", 0.011, "a level line runs a little past its bars");
  set("chart.holdOriginal", [0.73, 2.0], "the original shows for 0.7 to 2 s before it is redrawn, so it is recognised");
  set("chart.settle", 1.33, "the redraw finishes 1.3 s before the next moment");
  set("chart.minRoomBoth", 2.33, "with under 2.3 s, the original holds and the next moment redraws it");
  set("chart.minRoom", 1.0, "with under 1 s and nothing after, the bars just grow in");
  set("chart.fade", 0.33, "the original fades in or out over 0.33 s");
  set("chart.move", 0.8, "the redrawn bars move to their places over 0.8 s");
  set("chart.late", 0.73, "words and lines arrive 0.73 s into the redraw");
  set("chart.lateFrames", 0.47, "and take 0.47 s");
  set("chart.growStagger", 0.13, "bars growing in one after another");
  set("chart.grow", 0.53, "a bar grows in over 0.53 s");
  // Objects
  set("apparatus.sourceShare", 0.51, "a source takes about half an apparatus's height");
  set("apparatus.gapShare", 0.04, "a small gap between the tip and the mouth, where drops are seen falling");
  set("apparatus.sourceWidth", 0.5, "a source is at most half the width");
  set("apparatus.vesselWidth", 0.7, "a vessel is at most 70% of the width");
  set("apparatus.satelliteShare", 0.2, "other objects needed now stand small beside the vessel");
  set("apparatus.satelliteGap", 0.046, "space between the vessel and what stands beside it");
  set("fall.bigShare", 0.5, "the largest falling thing is half its composition's width; others keep their true relative size");
  set("fall.gapShare", 0.16, "space between things that fall together");
  set("fall.minShare", 0.15, "a small thing is never drawn narrower than 15% of the width");
  set("fall.roomShare", 0.5, "at least half the composition's height is room to fall");
  set("fall.floorGap", 0.026, "the floor line sits just under where things land");
  set("fall.heightM", 1, "when the drawing has no real scale, a fall is timed as from 1 m");
  set("fall.squash", 0.1, "a landing squashes by 10%");
  set("fall.squashTime", 0.1, "squash in 0.1 s");
  set("fall.settle", 0.27, "and springs back in 0.27 s");
  set("fall.trail", 3, "faint marks where things passed");
  set("fall.trailOpacity", 0.16, "the marks are faint");
  set("fall.levelOpacity", 0.85, "the level line joining their bottoms");
  set("fall.levelHold", 1.0, "the level line stays 1 s after landing");
  set("fall.replayPause", 0.4, "a pause before a replay");
  set("demo.slow", 0.3, "slow motion plays at 30% of real speed");
  set("demo.fast", 2, "fast plays at twice real speed");
  set("demo.wordsWait", true, "revealed words wait for the landing they describe");
  set("demo.neverCut", true, "the next moment waits for a demonstration to finish");
  set("flow.rate", [1.4, 6], "drop by drop: 1.4 drops a second; a quick run: 6 a second");
  set("flow.trueWidth", [0.5, 0.3], "a drop is about 5 mm across; a thin stream about 3 mm (sizes of the world, in cm)");
  set("flow.minWidth", 0.009, "what flows is never drawn thinner than 0.9% of the shorter side, so it is seen");
  set("flow.sourceCm", 30, "a source with no real size is timed as 30 cm tall");
  set("flow.perDrop", 0.05, "a drop is about 0.05 mL");
  set("flow.perSecond", 2.6, "a thin stream runs about 2.6 mL/s");
  set("flow.tap", 0.3, "a tap opens over 0.3 s");
  set("flow.stop", 0.3, "a stream runs out over 0.3 s once it stops");
  set("flow.replayPause", 0.4, "a pause before a flow is replayed");
  set("flow.bloom", [0.25, 0.011], "a bloom of color where a drop lands: width share of the surface, height");
  set("flow.bloomGrow", 0.33, "a bloom spreads in 0.33 s");
  set("flow.bloomFade", [1.33, 0.6], "and fades over 1.3 s (drops) or 0.6 s (stream)");
  set("flow.bloomSpread", 0.3, "landings spread across 30% of the surface");
  set("flow.bloomEvery", 0.17, "a stream blooms every 0.17 s where it lands");
  set("flow.stopBefore", 0.6, "a flow stops 0.6 s before what follows, so the result is seen at rest");
  set("focus.hidden", 0, "a withheld subject is not seen at all");
  set("flow.pool", 8, "blooms reused in turn");
  set("change.time", 0.87, "a thing changes state (a color, a level, a pose) over 0.87 s");
  set("reading.zoom", 2.4, "close enough that a scale's marks read");
  set("reading.size", 0.085, "the reading's size on screen after the zoom");
  set("reading.mark", 0.0056, "the mark on the surface");
  set("reading.move", 1.0, "the camera closes in over 1 s");
  set("reading.textAt", 0.8, "the value arrives as the camera settles");
  set("reading.gap", 0.037, "space between the thing and its value");
  // Motion
  set("motion.move", [Math.max(0.2, moveS * 0.7), 0.383, 0.93], `moves take ${Math.max(0.2, moveS * 0.7).toFixed(2)} s plus a little per distance, at most 0.93 s (the style's motion: ${feel ?? "default"})`);
  set("motion.stagger", 0.1, "things entering together start 0.1 s apart");
  set("motion.exitShare", 0.7, "exits are quicker than entrances");
  set("motion.reveal", 0.53, "a reveal pops in over 0.53 s");
  set("motion.pulse", [1.08, 0.47], "a thing that changes in place pulses once");
  set("motion.objectPulse", [1.05, 0.6], "a revealed object pulses once");
  set("motion.placeholderPulse", [1.06, 1.33], "a placeholder breathes while it waits");
  set("motion.placeholderDip", [0.94, 0.17], "and dips away as the answer arrives");
  set("becomes.lift", 0.34, "old words lift a third of their size as new words rise");
  set("becomes.out", 0.33, "old words leave in 0.33 s");
  set("becomes.in", 0.47, "new words arrive in 0.47 s");
  set("becomes.settle", [0.67, 0.67], "new words keep the accent 0.67 s, then settle over 0.67 s");
  set("pace.slow", 1.4, "slow pace: motion 40% longer");
  set("pace.fast", 0.7, "fast pace: motion 30% shorter");
  // Timing
  set("timing.maxDelay", 0.5, "a moment may start up to 0.5 s after its word so the one before can hold");
  set("timing.maxDelayPayoff", 0.9, "after a reveal or a question, up to 0.9 s");
  set("timing.carry", 3, "a moment too short to stand alone passes at most 3 things on as support");
  set("camera.rest", 0.47, "the camera returns to rest over 0.47 s");
  set("camera.still", [3, 1.02], "a moment still for 3 s drifts to 1.02 so the frame stays alive");
  set("camera.stress", 1.05, "a stressed moment pushes in to 1.05");
  void fps;
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// The starting design.

const dec = <T>(value: T, from: Decided<T>["from"], why: string): Decided<T> => ({ value, from, why });

/** The video's tempo from its feel, in the intent language's own vocabulary (calm, warm, bold, serious, playful). */
export function tempoOf(feel: string | undefined): Decided<number> {
  if (feel && /calm|serious/.test(feel)) return dec(1.15, "style", `feel ${feel}: motion about 15% slower`);
  if (feel && /bold|playful/.test(feel)) return dec(0.85, "style", `feel ${feel}: motion about 15% quicker`);
  return dec(1, "style", feel ? `feel ${feel}: the style's own pace` : "no feel given: the style's own pace");
}

type Stagey = { stage: boolean; kind: "stage" | "text" | "many" | "none" };
function anchorKind(plan: IntentPlan, m: Moment, cards: PartCard[]): Stagey {
  const things = new Map(plan.things.map((t) => [t.id, t]));
  const isStage = (id: string) => things.get(id)?.kind === "object" || cards.some((c) => c.name === id.split(".")[0]);
  const stage = idsOf(m).some(isStage);
  const subj = m.reveal ?? m.show;
  if (stage) return { stage, kind: "stage" };
  if (subj && things.get(subj)?.kind === "many") return { stage, kind: "many" };
  return { stage, kind: subj ? "text" : "none" };
}

/** The suggested design of one moment: every field from the style or the viewing, with its reason. */
/** `kinds`: what each of the moment's acts is (a flow, a fall, a reading ...), read off the depictions (compose/acts.ts). */
export function suggestMoment(plan: IntentPlan, k: number, viewing: Viewing, theme: Theme, cards: PartCard[], words?: Word[], kinds: ActKind[] = []): MomentDesign {
  const m = plan.moments[k]!;
  const S = styleValues(theme, viewing);
  const shape = shapeOf(viewing);
  const a = anchorKind(plan, m, cards);
  const scale = a.kind === "stage" ? (shape === "wide" ? 0.82 : 0.86) : a.kind === "many" ? 0.62 : 0.92;
  const at: [number, number] = shape === "tall" ? [0.5, 0.47] : [0.5, 0.5];
  const arrangement = shape === "wide" && a.stage ? "row" : "stack";
  const paceS = m.pace === "slow" ? 1.5 : m.pace === "fast" ? 0.7 : 1.0;
  const dwell = Math.max(paceS, m.reveal || m.ask || m.stress ? 1.4 : 0);
  const camera = cameraOf(m, k, plan, S, words, kinds);
  return {
    moment: k,
    importance: m.stress ? dec(0.8, "author", "the author marked this moment as stress") : m.reveal ? dec(0.7, "author", "a reveal: the payoff of a question") : dec(0.5, "style", "an ordinary moment"),
    focus: m.compare ? dec("two", "author", "the author compares two things") : m.show || m.reveal ? dec("one", "author", "the author names one subject") : dec("none", "author", "the moment names no subject"),
    subjectScale: dec(scale, "style", a.kind === "stage" ? `the stage (what persists: depicted objects, the user's material) takes ${Math.round(scale * 100)}% of the usable frame` : a.kind === "many" ? "countable marks take about 60% of the usable frame" : `words fill up to ${Math.round(scale * 100)}% of the usable width, capped at the type scale's largest step`),
    subjectAt: dec(at, "style", shape === "tall" ? "just above the middle of the usable frame, the optical center of a tall frame" : "the middle of the usable frame"),
    arrangement: dec(arrangement, "style", arrangement === "row" ? "a wide frame: support stands beside the stage" : `a ${shape} frame: support stacks above and below the anchor`),
    supportOpacity: dec(S["support.opacity"]!.value as number, "style", S["support.opacity"]!.why),
    typeScale: m.stress ? dec(1.15, "style", "a stressed moment's words one step larger") : dec(1, "style", "the style's type scale as it is"),
    lead: dec(0.3, "style", "gaze reaches a named thing 200 to 400 ms after its word (Allopenna et al. 1998); the change starts 0.3 s before so the eye lands as the word is said"),
    dwell: dec(dwell, "style", `pace ${m.pace}${m.reveal || m.ask || m.stress ? ", and a payoff, a question or a stress holds longer" : ""}: at least ${dwell} s before the next moment takes the eye`),
    camera,
    proposals: m.plain ? [] : proposalsOf(plan, k, cards),
  };
}

function cameraOf(m: Moment, k: number, plan: IntentPlan, S: Record<string, StyleValue>, words: Word[] | undefined, kinds: ActKind[]): Decided<CameraPlan> {
  const at: [number, number] = [0.5, 0.47];
  if (kinds.includes("read")) return dec({ zoom: 1, at, move: "hold" }, "style", "the reading brings the camera close itself");
  if (m.stress) return dec({ zoom: S["camera.stress"]!.value as number, at, move: "push" }, "style", "a stressed moment: a slow push in");
  const next = plan.moments[k + 1];
  const [after, z] = S["camera.still"]!.value as [number, number];
  if (words && next && !m.ask && !m.acts.length) {
    const t0 = words[Math.min(m.word, words.length - 1)]?.start ?? 0;
    const t1 = words[Math.min(next.word, words.length - 1)]?.start ?? t0;
    if (t1 - t0 > after) return dec({ zoom: z, at, move: "drift" }, "style", `still for ${(t1 - t0).toFixed(1)} s: a very slow drift keeps the frame alive`);
  }
  return dec({ zoom: 1, at, move: "hold" }, "style", "the camera holds");
}

/**
 * Proposals the style suggests for a moment, each removable: compare two quantities of one kind on one scale; a level
 * line on a chart for a value said while its part is on screen; a pointer from words to the one chart part held; a
 * placeholder in the slot of an answer a question waits for.
 */
export function proposalsOf(plan: IntentPlan, k: number, cards: PartCard[]): Decided<{ kind: string; ids: string[]; args?: Record<string, unknown> }>[] {
  const m = plan.moments[k]!;
  const out: Decided<{ kind: string; ids: string[]; args?: Record<string, unknown> }>[] = [];
  const things = new Map(plan.things.map((t) => [t.id, t]));
  const card = (id: string) => cards.find((c) => c.name === id.split(".")[0]);
  const named = [...new Set(idsOf(m))];
  const charts = named.filter((id) => card(id)?.data);
  // A placeholder for a coming answer.
  if (m.ask) {
    const r = plan.moments.slice(k + 1, k + 3).find((x) => x.reveal)?.reveal;
    if (r) out.push(dec({ kind: "placeholder", ids: [r] }, "style", `the question waits for ${r}: a "?" holds its slot`));
  }
  const quantities = named.filter((id) => things.get(id)?.kind === "thing").map((id) => ({ id, n: numOf(things.get(id)!.text ?? "") })).filter((x) => x.n && x.n.v > 0 && x.n.unit);
  if (!m.compare && !charts.length) {
    outer: for (let i = 0; i < quantities.length; i++)
      for (let j = i + 1; j < quantities.length; j++)
        if (quantities[i]!.n!.unit === quantities[j]!.n!.unit && quantities[i]!.n!.v !== quantities[j]!.n!.v) {
          out.push(dec({ kind: "compare-scale", ids: [quantities[i]!.id, quantities[j]!.id] }, "style", `${quantities[i]!.id} and ${quantities[j]!.id} are both in ${quantities[i]!.n!.unit} and on screen together: weighed on one scale`));
          break outer;
        }
  }
  if (m.compare && m.compare.every((x) => things.get(x)?.kind === "thing")) {
    const [a, b] = m.compare.map((x) => numOf(things.get(x)!.text ?? ""));
    if (a && b && a.unit === b.unit) out.push(dec({ kind: "compare-scale", ids: [...m.compare] }, "style", `the compared quantities share a unit (${a.unit}): columns on one scale`));
  }
  // Values said while a chart is on screen become level lines on the part they are about.
  for (const c of charts) {
    const cd = card(c)!;
    const data = cd.data!;
    const held = named.filter((x) => x.startsWith(`${cd.name}.`)).map((x) => x.split(".")[1]!);
    for (const q of quantities) {
      let best: { part: string; d: number } | undefined;
      for (const part of held) {
        const vs = barValues(cd, part);
        if (!vs.length) continue;
        const mean = vs.reduce((s, v) => s + v, 0) / vs.length;
        if (q.n!.v < Math.min(...vs) * 0.75 || q.n!.v > Math.max(...vs) * 1.25) continue;
        const dd = Math.abs(q.n!.v - mean) / mean;
        if (!best || dd < best.d) best = { part, d: dd };
      }
      if (best && !out.some((p) => p.value.kind === "level" && p.value.ids[0] === `${cd.name}.${best!.part}`)) out.push(dec({ kind: "level", ids: [`${cd.name}.${best.part}`, q.id], args: { value: q.n!.v } }, "style", `"${things.get(q.id)!.text}" is a level of ${cd.name}.${best.part}: a line at ${q.n!.v} on the chart's own scale`));
    }
    const subj = m.reveal ?? m.show;
    const sub = subj ? things.get(subj) : undefined;
    if (sub?.kind === "thing" && !numOf(sub.text ?? "") && held.length === 1 && !m.arrows.length && data) out.push(dec({ kind: "pointer", ids: [subj!, `${cd.name}.${held[0]}`] }, "style", `"${sub.text}" is shown while ${cd.name}.${held[0]} is held: a pointer joins them`));
    void data;
  }
  return out;
}

function barValues(c: PartCard, part: string): number[] {
  const d = c.data;
  const box = c.parts[part]?.box;
  if (!d || !box || !d.plot) return [];
  const n = d.values.length;
  const ymax = d.ymax ?? Math.max(...d.values);
  const [px0, py0, px1, py1] = d.plot;
  return d.values.filter((v, i) => {
    const [u, w] = d.orient === "h" ? [px0 + ((v / ymax) * (px1 - px0)) / 2, py0 + ((i + 0.5) * (py1 - py0)) / n] : [px0 + ((i + 0.5) * (px1 - px0)) / n, (py0 + py1) / 2];
    return u >= box[0] && u <= box[2] && (d.orient !== "h" || (w >= box[1] && w <= box[3]));
  });
}

/** Demonstrations: how each fall and flow plays. Falls at real speed, then a slow replay; flows as the author paced them. */
export function demosOf(plan: IntentPlan, kinds: ActKind[][] = []): DemoPlan[] {
  const out: DemoPlan[] = [];
  plan.moments.forEach((m, k) =>
    m.acts.forEach((a, i) => {
      const kind = kinds[k]?.[i];
      if (kind === "fall")
        out.push({ moment: k, act: i, speed: dec(a.speed === "slow" ? "slow" : "real", "style", a.speed === "slow" ? "the author asked for it slow" : "a fall from a height a viewer knows is short: shown at real speed first, so it looks like the world"), replay: a.speed === "slow" ? undefined : dec({ speed: "slow" as const }, "style", "then replayed slowly, so the eye can compare the things as they fall"), why: "a demonstration that must truly happen" });
      if (kind === "flow") out.push({ moment: k, act: i, speed: dec(a.speed === "slow" ? "slow" : "real", "style", a.speed === "slow" ? "one drop at a time, as the author paced it" : "a quick stream, as the author paced it"), why: "a flow plays as the author paced it" });
    }),
  );
  return out;
}

/** `props`: the depicter's specs of the plan's objects, so the suggestion knows what each act is (a fall, a flow ...). */
export function suggestDesign(plan: IntentPlan, viewing: Viewing, theme: Theme, cards: PartCard[] = [], words?: Word[], props: Record<string, PropSpec> = {}): Design {
  const kinds = actKinds(plan, depictAll(plan, props, theme).depictions).map((m) => m.map((c) => c.kind));
  return {
    viewing,
    tempo: tempoOf(plan.feel),
    moments: plan.moments.map((_, k) => suggestMoment(plan, k, viewing, theme, cards, words, kinds[k])),
    demos: demosOf(plan, kinds),
    overrides: [],
    goals: [],
    decisions: [],
    budget: { candidatesPerMoment: 3, rounds: 2, calls: 12 },
  };
}
