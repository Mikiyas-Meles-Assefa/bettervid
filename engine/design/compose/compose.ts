// The composer: a pure function of (intent plan, design, context) to a compiled scene. It decides nothing of taste by
// itself: every size, place, opacity, duration and choice of ability comes from the Design and its MomentDesigns (which
// agents and the search vary), from Design.overrides, or from the style's suggestions (engine/design/suggest.ts). It
// writes a DecisionRecord for what it decided and notes for what it could not do.
//
// Output is a SceneDoc of group, path, text and image nodes with theme color names and roles, compiled by the engine's
// own compile(). `ids` maps every plan name (and part of the user's material) to the scene ids that draw it.
import { compile, when } from "../../core/compile.ts";
import { roleLook } from "../../core/roles.ts";
import type { CompileContext, Ease, Kit, Scene, SceneDoc, Step, Theme, Value } from "../../core/types.ts";
import { DRAWING_KITS } from "../../kits/index.ts";
import { argValue, expandKitItem, type KitExpansion } from "../../language/build.ts";
import { estimate, TEXT_SIZE } from "../../language/layout.ts";
import { fontMeasure } from "../../language/measure.ts";
import { parse as parseScene, type Item as SceneItem } from "../../language/syntax.ts";
import { depictionFrom, pointOf, sizeCm, suggestLook, type Depiction, type PropSpec } from "../depict/index.ts";
import * as A from "../abilities/index.ts";
import type { Cls, St, Triple } from "../abilities/types.ts";
import { computedOf, idLine, idsOf } from "../intent/parse.ts";
import { suggestMoment } from "../suggest.ts";
import type { Act, Box, CameraPlan, DecisionRecord, Design, From, IntentPlan, Moment, MomentDesign, PartCard, Relation, RelationKind, Viewing, Word } from "../types.ts";
import { classify, depictAll, type ActKind, type Classified } from "./acts.ts";
import { anchorRect, overlap, pack, rh, rw, sideWidths, splitHalves, usableRect, type Rect } from "./pack.ts";
import { Values } from "./values.ts";

export type ComposeCtx = {
  theme: Theme;
  words: Word[];
  frames: number;
  cards?: PartCard[];
  /** The user's pictures by card name, as data URLs (or any URL the renderer can load). */
  assets?: Record<string, string>;
  /** The depicter's spec of each object thing, by the plan's id (the orchestrator asks the depicter; tests write them). */
  props?: Record<string, PropSpec>;
  measure?: A.Measure;
  /** The kits that draw what a pinned line computes (a sort, a graph, a formula) and play its steps; all of them by default. */
  kits?: Kit[];
};

/** Something the composition cannot do until an agent repairs it: who should (the depicter, the author) and what. */
export type BuildProblem = { thing: string; who: "depicter" | "author"; task?: string; problem: string };

export type Composition = { doc: SceneDoc; scene: Scene; ids: Record<string, string[]>; notes: string[]; decisions: DecisionRecord[]; problems: BuildProblem[]; boxes: { moment: number; boxes: Record<string, [number, number, number, number]> }[] };

/**
 * The viewing the composer keeps clear: the platform's UI zones, and the captions' box only while the captions show (a
 * designer who turns captions off frees their box; a zone the platform itself covers stays).
 */
export function keptClear(v: Viewing): Viewing {
  const cap = v.captions;
  const zones = v.uiZones.filter((z) => cap.show || !cap.box || z.box.join() !== cap.box.join());
  if (cap.show && cap.box && !zones.some((z) => z.box.join() === cap.box!.join())) zones.push({ box: cap.box as Box, what: "captions" });
  return { ...v, uiZones: zones };
}

/** Relations that place a thing on another (on, over, in, attached to, at): the other stays while it is shown. */
const HELD_BY = new Set<RelationKind>(["on", "over", "in", "to", "at"]);

type Def = { id: string; text: string; many?: { n: number; unit: string }; obj?: Depiction; spec?: PropSpec; missing?: boolean; desc?: string };
type FM = { m: Moment; i: number; md: MomentDesign; onset: number; carry: string[]; becomes: Moment["becomes"]; wrong: string[]; acts: Act[]; merged: number[] };
type Slot = { id: string; cls: Cls; wrong: boolean; reveal: boolean; born?: string; part?: string; parts?: string[] };
type PArrow = { t: string; pic: string; part: string; to: boolean };
type Plan = { slots: Slot[]; pair?: [string, string]; scaled?: boolean; partPair?: { pic: string; parts: [string, string] }; arrows: { a: string; b: string; label: string }[]; parrows: PArrow[]; subject?: string; question?: string; phFor?: string; levels: { part: string; thing: string; v: number }[] };
type Ent = { id: string; type: "text" | "many" | "ph" | "pic" | "obj" | "kit"; text?: A.TextEnt; many?: A.ManyEnt };
type ItemType = "text" | "ph" | "many" | "strike" | "bar" | "arrow" | "pic" | "parrow" | "vbar" | "obj" | "floor" | "kit";
type Item = { id: string; type: ItemType; st: St; born?: string };
type Placed = { id: string; dx: number; dy: number; w: number; h: number; st: Partial<St> };
type Dec = { type: "bar" | "arrow" | "vbar" | "floor"; id: string; dx: number; dy: number; len: number; color: string; w?: number; op?: number };
type Block = { key: string; rank: number; w: number; h: number; items: Placed[]; decor: Dec[]; subject: boolean; stage: boolean };

export function compose(plan: IntentPlan, design: Design, ctx: ComposeCtx): Composition {
  const notes: string[] = [];
  const decisions: DecisionRecord[] = [];
  const decide = (area: string, moment: number | undefined, choice: string, from: From, why: string, readings?: Record<string, number>) => decisions.push({ area, moment, choice, goals: [], from, why, ...(readings ? { readings } : {}) });
  const viewing = design.viewing;
  const theme = ctx.theme;
  const V = new Values(design, theme);
  const W = viewing.width;
  const H = viewing.height;
  const FPS = viewing.fps;
  const FRAMES = ctx.frames;
  const SHORT = Math.min(W, H);
  const cards = ctx.cards ?? [];
  const words = ctx.words;
  if (!words.length) throw new Error("compose needs the narration's words");
  let measure: A.Measure;
  try {
    measure = ctx.measure ?? fontMeasure(theme);
  } catch (e) {
    measure = estimate;
    notes.push(`fonts could not be measured (${(e as Error).message.slice(0, 60)}): the built-in estimate is used`);
  }
  const nm = (role: Parameters<typeof roleLook>[1]) => roleLook(theme, role).color ?? "ink";
  const FONT = roleLook(theme, "title").font ?? "title";
  const C = { subject: nm("title"), answer: nm("answer"), key: nm("key"), wrong: nm("wrong"), heading: nm("heading"), muted: roleLook(theme, "muted").color ?? nm("title"), pointer: nm("pointer") };
  const emCache = new Map<string, number>();
  const em = (t: string) => emCache.get(t) ?? emCache.set(t, measure(t, 100, FONT) / 100).get(t)!;
  const LH = V.n("type.lineHeight");
  const MIN_FS = V.px("type.min");
  const tempo = design.tempo.value;

  // ---------------------------------------------------------------------------------------------------------------
  // 1. The plan's things, the user's material, and every name resolved.
  const defs = new Map<string, Def>();
  const specs = ctx.props ?? {};
  const problems: BuildProblem[] = [];
  const depicted = depictAll(plan, specs, theme);
  for (const p of depicted.problems) problems.push({ thing: p.id, who: "depicter", task: `depict.${p.id}`, problem: p.problem });
  for (const t of plan.things) {
    if (t.kind === "object") {
      const d = depicted.depictions.get(t.id);
      // Until the depicter answers, the thing stands as its own words, so the frame still says what it is.
      if (d) defs.set(t.id, { id: t.id, text: t.id, obj: d, spec: specs[t.id], desc: t.desc });
      else defs.set(t.id, { id: t.id, text: t.desc ?? t.id, missing: true, desc: t.desc });
    }
    else if (t.kind === "many") defs.set(t.id, { id: t.id, text: t.id, many: t.many ?? { n: 1, unit: t.id } });
    else defs.set(t.id, { id: t.id, text: t.text ?? t.id });
  }
  const pics = new Map<string, A.Pic | A.Chart>();
  for (const c of cards) {
    const src = ctx.assets?.[c.name] ?? c.file;
    const size = c.size ?? [1000, 750];
    const parts = new Map(Object.entries(c.parts).filter(([, p]) => p.box).map(([k, p]) => [k, p.box!] as const));
    const base: A.Pic = { name: c.name, src, w: size[0], h: size[1], about: c.about, parts };
    if (c.data && (c.data.kind === "bars" || !c.data.kind)) {
      // The redrawn chart's scale reaches every level a moment asks of it (a share of its total may lie past its longest bar).
      const asked = design.moments.flatMap((md) => md.proposals.map((p) => p.value)).filter((p) => p.kind === "level" && p.ids[0]?.split(".")[0] === c.name).map((p) => Number(p.args?.value)).filter((v) => Number.isFinite(v));
      const ymax = c.data.ymax ?? A.niceCeil(Math.max(...c.data.values));
      const data = { ...c.data, ymax, ...(asked.length && Math.max(...asked) > ymax ? { reach: Math.max(...asked) } : {}) };
      const chart: A.Chart = { ...base, data, barsOf: A.barsOfParts(data, parts) };
      pics.set(c.name, chart);
      notes.push(`material ${c.name} is a chart with its data (${data.values.length} bars): it can be redrawn on its own bars${data.plot ? "" : "; its reading gives no plot box, so the redraw cannot start on the original's bars"}`);
    } else pics.set(c.name, base);
  }
  const isChart = (p: A.Pic | A.Chart | undefined): p is A.Chart => !!p && "data" in p;
  const pr = (id: string | undefined): { name: string; part?: string } | undefined => {
    if (!id) return undefined;
    const [a, b] = id.split(".");
    return pics.has(a!) ? { name: a!, part: b } : undefined;
  };
  // Things a pinned line computes with a kit (a sort, a graph, a formula): made by the very code that draws them in the
  // scene language, from the pinned line itself, once, as one more thing of the composition. Its parts keep the kit's own
  // names under the thing's scene id, so the steps the kit computes play on them, and every part is addressable.
  const kits = ctx.kits ?? DRAWING_KITS;
  const kitKinds: NonNullable<Kit["kinds"]> = Object.assign({}, ...kits.map((k) => k.kinds));
  const kitCtx: CompileContext = { fps: FPS, width: W, height: H, frames: FRAMES, theme, words, kits };
  type Made = KitExpansion & { id: string; sid: string; kind: string; line: number; text: string; parts: Set<string> };
  const computed = new Map<string, Made>();
  for (const c of computedOf(plan, Object.keys(kitKinds)).values()) {
    if (pics.has(c.id) || defs.has(c.id)) continue; // the author's check names the clash
    const read = parseScene(`@0\n${c.text}`, Object.keys(kitKinds).filter((k) => k !== "graph"));
    const item: SceneItem | undefined = read.doc.states[0]?.items[0];
    if (read.problems.length || !item) {
      problems.push({ thing: c.id, who: "author", problem: `line ${c.line}: ${read.problems.map((p) => p.message).join("; ") || `"${c.text}" makes nothing`}` });
      continue;
    }
    const sidOf = `k.${c.id}`;
    const x = expandKitItem({ ...item, id: sidOf, line: c.line }, { kinds: kitKinds, ctx: kitCtx });
    if (x.errors.length) {
      problems.push({ thing: c.id, who: "author", problem: x.errors.map((e) => `line ${c.line}: ${e.message}`).join("; ") });
      continue;
    }
    computed.set(c.id, { ...x, id: c.id, sid: sidOf, kind: c.kind, line: c.line, text: c.text, parts: new Set(x.nodes.filter((n) => n.id !== sidOf).map((n) => n.id.slice(sidOf.length + 1))) });
    decide("depiction", c.moment, `${c.id}: a ${c.kind} the ${c.kind} kit computes and draws, ${x.nodes.length} parts`, "author", "a pinned line of the scene language");
  }
  for (const m of plan.moments)
    for (const p of m.pinned) {
      const [head, id] = idLine(p.text);
      const first = id ? computed.get(id) : undefined;
      if (head && kitKinds[head] && first && first.line !== p.line && p.text.replace(/\s+/g, " ") !== first.text.replace(/\s+/g, " "))
        problems.push({ thing: id!, who: "author", problem: `line ${p.line}: ${id} is made at line ${first.line} already; one id is one thing with one input, made once (later moments name it, or play its steps)` });
    }
  /** A computed thing, or one of its parts, by the plan's name. */
  const kr = (id: string | undefined): { name: string; part?: string } | undefined => {
    if (!id) return undefined;
    const [a, ...rest] = id.split(".");
    return computed.has(a!) ? { name: a!, part: rest.length ? rest.join(".") : undefined } : undefined;
  };
  const canon = (id: string | undefined, where: string): string | undefined => {
    if (!id) return id;
    const kp = kr(id);
    if (kp) {
      const c = computed.get(kp.name)!;
      if (kp.part === undefined || c.parts.has(kp.part)) return id;
      const all = [...c.parts].sort((a, b) => a.split(".").length - b.split(".").length);
      const shown = all.filter((x) => x.split(".").length === all[0]!.split(".").length).slice(0, 12);
      notes.push(`${where} ${kp.name} has no part "${kp.part}": the whole ${c.kind} is used`);
      problems.push({ thing: kp.name, who: "author", problem: `${where} ${kp.name} has no part "${kp.part}". Its parts include: ${shown.join(", ")}${c.parts.size > shown.length ? ", and the parts under them" : ""}` });
      return kp.name;
    }
    const r = pr(id);
    if (!r) return id.includes(".") ? (notes.push(`${where} "${id}" is not a part of the user's material: read as "${id.replace(/\./g, "_")}"`), id.replace(/\./g, "_")) : id;
    const pic = pics.get(r.name)!;
    if (r.part === undefined || pic.parts.has(r.part) || (isChart(pic) && pic.data.texts?.[r.part])) return id;
    notes.push(`${where} ${r.name} has no part "${r.part}": the whole picture is used`);
    return r.name;
  };
  // The plan as composed: names resolved, moments in word order, word numbers inside the narration.
  const moments: { m: Moment; i: number }[] = plan.moments.map((m0, i) => {
    const w = `@${m0.word}`;
    const m: Moment = {
      ...m0,
      show: canon(m0.show, w),
      keep: m0.keep.map((x) => canon(x, w)!),
      reveal: canon(m0.reveal, w),
      wrong: m0.wrong.map((x) => canon(x, w)!),
      from: m0.from.map((x) => ({ a: canon(x.a, w)!, b: canon(x.b, w)! })),
      arrows: m0.arrows.map((x) => ({ ...x, a: canon(x.a, w)!, b: canon(x.b, w)! })),
      compare: m0.compare ? [canon(m0.compare[0], w)!, canon(m0.compare[1], w)!] : undefined,
      acts: m0.acts.map((a) => ({ ...a, ids: a.ids.map((x) => canon(x, w)!), to: a.to ? canon(a.to, w) : undefined })),
      becomes: m0.becomes.filter((b) => (!pics.has(b.id.split(".")[0]!) || (notes.push(`${w} the user's material cannot become something else: ignored`), false)) && (!kr(b.id) || (notes.push(`${w} ${b.id} is computed: it changes by its own steps, not by becomes; ignored`), false))),
    };
    if (m.word >= words.length || m.word < 0) notes.push(`@${m.word} is not a word of the narration (0 to ${words.length - 1}): moved to the nearest word`);
    return { m, i };
  });
  // Pinned lines of today's scene language: the strongest precedence. What the composer understands is applied; the rest is reported.
  const pins = moments.map(({ m, i }) => readPins(m, i));
  for (const { m } of moments) for (const id of idsOf(m)) if (!pr(id) && !kr(id) && !defs.has(id)) (defs.set(id, { id, text: id }), notes.push(`@${m.word} "${id}" was never declared: made a thing whose text is "${id}"`));
  const sortedM = [...moments].sort((a, b) => Math.min(Math.max(a.m.word, 0), words.length - 1) - Math.min(Math.max(b.m.word, 0), words.length - 1) || a.i - b.i);
  if (sortedM.some((x, j) => x !== moments[j])) notes.push("moments were not in word order: sorted by word");
  const wordStart = (n: number) => words[Math.min(Math.max(0, n), words.length - 1)]!.start;
  const mdOf = (i: number): MomentDesign => {
    const md = design.moments.find((x) => x.moment === i);
    if (md) return md;
    notes.push(`@${plan.moments[i]!.word} has no MomentDesign: the style's suggestion is used`);
    return suggestMoment(plan, i, viewing, theme, cards, words, plan.moments[i]!.acts.map((a) => kindOf(a).kind));
  };
  const tag = (m: Moment) => `@${m.word}`;
  const subjectOf = (m: Moment): string | undefined => m.reveal ?? m.show ?? m.becomes[0]?.id ?? m.arrows[0]?.b ?? m.wrong[0];
  const sid = (id: string | undefined) => (id ? pr(id)?.name ?? kr(id)?.name ?? id : id);
  const isObj = (id: string | undefined) => !!id && !!defs.get(id)?.obj;
  // What an act is, read off the depiction's own verbs (never off the verb's words).
  const kindCache = new Map<string, Classified>();
  const kindOf = (a: Act): Classified => {
    const k = `${a.ids[0]}|${a.verb}`;
    return kindCache.get(k) ?? kindCache.set(k, classify(defs.get(sid(a.ids[0]) ?? "")?.obj, a.verb)).get(k)!;
  };
  const is = (a: Act, kind: ActKind) => kindOf(a).kind === kind;
  /** The shape the stage needs of an object: its box, outlet and mouth, and its real size when known. */
  const shapeOf = (id: string): A.ObjShape => {
    const d = defs.get(id)!.obj!;
    const spec = defs.get(id)!.spec;
    const real = spec ? sizeCm(spec) : undefined;
    return { w: d.box.w, h: d.box.h, outlet: d.anchor("outlet") ?? d.anchor("mouth"), mouth: d.anchor("mouth") ?? d.anchor("surface"), ...(real ? { realCm: real } : {}) };
  };
  const pinsOf = (i: number) => pins[i]!;

  function readPins(m: Moment, i: number) {
    const out: { camera?: CameraPlan; arrangement?: string; supportOpacity?: number; sets: { id: string; props: Record<string, Value>; line: number }[]; texts: { id: string; size?: number; role?: string }[]; kept: string[]; computed: string[]; plays: { behavior: string; targets: string[]; args: Record<string, Value>; line: number }[] } = { sets: [], texts: [], kept: [], computed: [], plays: [] };
    for (const p of m.pinned) {
      const toks = p.text.split(/\s+/);
      const head = toks[0]!.replace(/:$/, "");
      const kv = Object.fromEntries(toks.slice(1).filter((t) => t.includes("=")).map((t) => [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1).replace(/^"|"$/g, "")]));
      if (head === "camera") {
        const zoom = Number(kv.zoom ?? 1);
        const at = kv.at;
        out.camera = { zoom: Number.isFinite(zoom) ? zoom : 1, at: at && /^[\d.]+,[\d.]+$/.test(at) ? (at.split(",").map(Number) as [number, number]) : [0.5, 0.5], move: kv.frames === "0" ? "cut" : "follow", frames: kv.frames ? Number(kv.frames) : undefined };
        if (at && !/^[\d.]+,[\d.]+$/.test(at)) out.kept.push(`line ${p.line}: camera at=${at} (a thing) is centered once it is placed`), ((out.camera as CameraPlan & { atId?: string }).atId = at);
      } else if (["row", "stack", "grid", "ring", "chain", "free"].includes(head)) out.arrangement = head === "row" ? "row" : head === "stack" ? "stack" : (out.kept.push(`line ${p.line}: "${head}" is read as a stack`), "stack");
      else if (head === "dim") out.supportOpacity = 1 - Number(kv.amount ?? 0.5);
      else if (head === "set" && toks[1]) {
        const props: Record<string, Value> = {};
        for (const [k, v] of Object.entries(kv)) props[k] = /^-?\d*\.?\d+$/.test(v) ? Number(v) : v;
        out.sets.push({ id: toks[1]!, props, line: p.line });
      } else if (head === "text" && toks[1]) {
        const id = toks[1]!;
        const text = /"([^"]*)"/.exec(p.text)?.[1];
        if (text !== undefined && !defs.has(id)) defs.set(id, { id, text });
        if (!m.keep.includes(id) && m.show !== id) m.keep.push(id);
        out.texts.push({ id, size: kv.size ? (TEXT_SIZE[kv.size] ?? Number(kv.size)) * (SHORT / 1080) : undefined, role: kv.role });
      } else if (kitKinds[head] && computed.has(idLine(p.text)[1] ?? "")) {
        // A computed thing is on screen in the moment that makes it.
        const id = idLine(p.text)[1]!;
        if (!out.computed.includes(id)) out.computed.push(id);
      } else if (kitKinds[head]) {
        // Its problem is already the author's (it could not be made).
      } else if (head === "do") {
        // A behavior played at the moment's word, as the scene language plays it: `do steps demo1 from=1 to=3`.
        const read = parseScene(`@0\n${p.text}`, Object.keys(kitKinds).filter((k) => k !== "graph"));
        const c = read.doc.states[0]?.commands[0];
        if (read.problems.length || !c || c.do !== "play") {
          out.kept.push(`line ${p.line}: "${p.text}" ${read.problems[0]?.message ?? "is not a behavior to play"}: not drawn`);
          continue;
        }
        const args = Object.fromEntries(Object.entries(c.attrs).map(([k, v]) => [k, argValue(v, (t) => when({ word: Math.min(Math.max(0, t.word), words.length - 1), offset: t.offset }, kitCtx))]));
        out.plays.push({ behavior: c.behavior, targets: c.targets, args, line: p.line });
        for (const t of c.targets) {
          const root = kr(t)?.name;
          if (root && !out.computed.includes(root)) out.computed.push(root);
        }
      } else out.kept.push(`line ${p.line}: "${p.text}" is pinned to @${m.word}, but this composer does not draw that line of the scene language yet`);
    }
    // What is computed here is on screen here, as support unless the moment shows it.
    for (const id of out.computed) if (!m.keep.includes(id) && kr(m.show)?.name !== id && kr(m.reveal)?.name !== id) m.keep.push(id);
    for (const k of out.kept) notes.push(k);
    if (m.pinned.length) decide("pinned", i, `${m.pinned.length} pinned line(s) of the scene language`, "author", "explicit lines win for their thing in their moment; the rest is composed around them");
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 2. Timing that follows the voice. Each moment starts `lead` before its word and holds at least `dwell`; a moment
  // too short to stand alone is merged into the next, its subject passed on as support. Demonstrations are never cut.
  // Captions are the designer's call per platform: their box is kept clear only while they show.
  const U0 = usableRect(keptClear(viewing), V.px("frame.margin"));
  decide("captions", undefined, viewing.captions.show ? `captions show${viewing.captions.box ? ", their box is kept clear" : ""}` : "no captions", "director", viewing.captions.why);
  const U = U0.rect;
  if (U0.cuts.length) decide("frame", undefined, U0.cuts.join("; "), "director", viewing.why);
  const demoOf = (i: number, a: number) => design.demos.find((d) => d.moment === i && d.act === a);
  const speedOf = (s: "real" | "slow" | "fast" | number | undefined, k: number) => (s === undefined || s === "real" ? 1 : s === "slow" ? V.n("demo.slow", k) : s === "fast" ? V.n("demo.fast", k) : Math.max(0.01, Number(s)));
  // A fall's real time needs the drawing's scale: estimated here from the anchor box the design asks for.
  const fallFramesOf = (i: number, a: Act, box: { w: number; h: number }) => {
    const mem = a.ids.filter(isObj).map((id) => ({ id, shape: shapeOf(id) }));
    if (!mem.length) return { real: 0, played: 0, metres: 0 };
    const g = A.fallGroup(mem, box, new Set(), fallParams(i));
    const metres = g.pxPerM ? g.fall / g.pxPerM : V.n("fall.heightM", i);
    const real = Math.max(1, Math.round(A.fallSeconds(metres) * FPS));
    const d = demoOf(i, plan.moments[i]!.acts.indexOf(plan.moments[i]!.acts.find((x) => x.line === a.line) ?? a));
    const rep = d?.replay ? { speed: speedOf(d.replay.value.speed, i), pause: V.f("fall.replayPause", i) } : undefined;
    return { real, played: A.fallPlayFrames(real, speedOf(d?.speed.value, i), rep, V.f("fall.squashTime", i) + V.f("fall.settle", i)), metres };
  };
  const fallParams = (k: number): A.FallGroupParams => ({ bigShare: V.n("fall.bigShare", k), gapShare: V.n("fall.gapShare", k), minShare: V.n("fall.minShare", k), roomShare: V.n("fall.roomShare", k), floorGap: V.px("fall.floorGap", k) });
  const anchorBox = (md: MomentDesign) => ({ w: md.subjectScale.value * rw(U), h: md.subjectScale.value * rh(U) });
  const demoFrames = (f: { i: number; acts: Act[]; md: MomentDesign }) => Math.max(0, ...f.acts.filter((a) => is(a, "fall")).map((a) => fallFramesOf(f.i, a, anchorBox(f.md)).played));
  const dwellOf = (f: FM) => Math.round(f.md.dwell.value * FPS) + (V.get<boolean>("demo.neverCut", f.i) ? demoFrames(f) : 0);
  const fms: FM[] = [];
  for (const { m, i } of sortedM) {
    const md = mdOf(i);
    let nominal = Math.max(1, Math.round(wordStart(m.word) * FPS) - Math.round(md.lead.value * FPS));
    const fm: FM = { m, i, md, onset: nominal, carry: [], becomes: m.becomes, wrong: m.wrong, acts: m.acts, merged: [] };
    for (;;) {
      const prev = fms.at(-1);
      if (!prev) break;
      const cand = Math.max(nominal, prev.onset + dwellOf(prev));
      const delay = cand - nominal;
      const demo = prev.acts.some((x) => is(x, "fall") || is(x, "flow")) && V.get<boolean>("demo.neverCut", prev.i);
      const allowed = demo ? Infinity : Math.round((prev.m.reveal || prev.m.ask ? V.n("timing.maxDelayPayoff", fm.i) : V.n("timing.maxDelay", fm.i)) * FPS);
      if (delay <= allowed) {
        fm.onset = cand;
        if (delay > 1) decide("timing", fm.i, `starts ${(delay / FPS).toFixed(2)} s after its lead`, "style", `${tag(prev.m)} holds ${(dwellOf(prev) / FPS).toFixed(1)} s (its dwell${demo ? " and its demonstration" : ""})`);
        break;
      }
      const s = subjectOf(prev.m);
      notes.push(`${tag(prev.m)} lasts only ${((nominal - prev.onset) / FPS).toFixed(1)} s before ${tag(m)}: merged into ${tag(m)}${s ? `, "${s}" kept as support` : ""}`);
      decide("timing", prev.i, `merged into @${m.word}`, "style", `it would last ${((nominal - prev.onset) / FPS).toFixed(1)} s, under its dwell of ${prev.md.dwell.value} s, and waiting would delay @${m.word} past ${(allowed / FPS).toFixed(2)} s`);
      fm.carry = [...(s ? [s] : []), ...prev.carry, ...fm.carry].filter((x, j, a) => a.indexOf(x) === j).slice(-Math.round(V.n("timing.carry", fm.i)));
      fm.becomes = [...prev.becomes, ...fm.becomes];
      fm.wrong = [...prev.wrong, ...fm.wrong];
      fm.acts = [...prev.acts, ...fm.acts];
      fm.merged = [...prev.merged, prev.i, ...fm.merged];
      fms.pop();
      // The merged moment takes over the time of what it absorbed: the absorbed words are said over its picture (their
      // subject is in it as support), not over an empty board or the moment before. A payoff keeps its own start while
      // a moment before it can hold the frame, so it is not given away early.
      if (!(fm.m.reveal || fm.m.ask) || !fms.length) {
        nominal = Math.min(nominal, prev.onset);
        fm.onset = nominal;
      }
    }
    fms.push(fm);
  }
  const K = fms.length;
  if (!K) throw new Error("the intent has no moments");
  const onsets = fms.map((f) => Math.min(f.onset, FRAMES - 20));

  // ---------------------------------------------------------------------------------------------------------------
  // 3. Each moment: who is on screen and in what role.
  // Apparatus: a source with what it pours or drips into, and things that fall together. A vessel fed by several sources
  // keeps only its first (primary) source as context; another source comes on screen when the plan names it.
  // Where things are: the author's relations between objects, staged as one scene (abilities/scene.ts). A relation that
  // names something not drawn as itself is the author's to repair (checkIntent says so); here it is left out.
  const rels: Relation[] = [];
  for (const r of plan.relations ?? []) {
    const [a, b] = [sid(r.a)!, sid(r.b)!];
    if (isObj(a) && isObj(b) && a !== b) rels.push({ ...r, a, b });
    else notes.push(`${r.a} ${r.words} ${r.b}: ${!isObj(a) ? a : b} is not a drawn object, so the line places nothing`);
  }
  const apparatus: { ids: string[]; flow: boolean }[] = [];
  const primarySource = new Map<string, string>();
  for (const f of fms)
    for (const a of f.acts) {
      const flow = is(a, "flow") && !!a.to;
      const g = flow ? [a.ids[0]!, a.to!] : is(a, "fall") && a.ids.length > 1 ? a.ids : [];
      if (g.length > 1 && g.every(isObj) && !apparatus.some((x) => x.flow === flow && g.every((y) => x.ids.includes(y)))) apparatus.push({ ids: g, flow });
      if (flow && g.every(isObj) && !primarySource.has(g[1]!)) primarySource.set(g[1]!, g[0]!);
    }
  const sticky = new Set<string>();
  const plans: Plan[] = [];
  const rank = new Map<string, number>();
  const subjectEver = new Set<string>();
  fms.forEach((f, k) => {
    const m = f.m;
    const md = f.md;
    const subjRaw = subjectOf(m);
    const subj = sid(subjRaw);
    f.wrong.forEach((x) => sticky.add(x));
    const slots: Slot[] = [];
    const has = (id: string) => slots.some((s) => s.id === id);
    const focusSub = new Map<string, string>();
    const focusSup = new Map<string, Set<string>>();
    const reg = (id: string, subject: boolean) => {
      const r = pr(id);
      if (!r?.part) return;
      if (subject) focusSub.set(r.name, r.part);
      else (focusSup.get(r.name) ?? focusSup.set(r.name, new Set()).get(r.name)!).add(r.part);
    };
    const add = (raw: string, cls: Cls, extra: Partial<Slot> = {}) => {
      const id = sid(raw)!;
      reg(raw, false);
      if (!has(id)) slots.push({ id, cls, wrong: sticky.has(id), reveal: m.reveal === raw, ...extra });
    };
    const props = md.proposals.map((p) => p.value);
    const q = m.ask;
    const phProp = q ? props.find((p) => p.kind === "placeholder") : undefined;
    const phFor = phProp ? sid(canon(phProp.ids[0], tag(m))) : undefined;
    if (q && !phFor) notes.push(`${tag(m)} ask: no placeholder proposed, the question stands alone`);
    if (m.show && m.reveal && m.show !== m.reveal) notes.push(`${tag(m)} has both show and reveal: "${m.show}" becomes support, "${m.reveal}" is the subject`);
    if (!subj && !m.compare && !q) notes.push(`${tag(m)} has no show: nothing is the subject`);
    let pair = m.compare && m.compare[0] !== m.compare[1] ? m.compare : undefined;
    let partPair: Plan["partPair"];
    if (pair && (kr(pair[0]) || kr(pair[1]))) {
      // A computed thing is compared whole, on the stage beside its partner (a part names where to look, not what to draw).
      const whole = [sid(pair[0])!, sid(pair[1])!] as [string, string];
      if (whole[0] === whole[1]) {
        notes.push(`${tag(m)} compare ${pair[0]} ${pair[1]}: two parts of one computed thing, shown as that one thing`);
        add(pair[0], "support");
        pair = undefined;
      } else pair = whole;
    }
    if (pair && (pr(pair[0]) || pr(pair[1]))) {
      const [ra, rb] = [pr(pair[0]), pr(pair[1])];
      if (ra?.part && rb?.part && ra.name === rb.name && isChart(pics.get(ra.name))) {
        partPair = { pic: ra.name, parts: [ra.part, rb.part] };
        decide("relation", f.i, `compare ${pair[0]} ${pair[1]}: both lit with level lines on the chart's own scale`, "author", "two parts of a chart with data");
      } else notes.push(`${tag(m)} compare ${pair[0]} ${pair[1]} involves a picture: both are shown and the part is outlined`);
      for (const x of pair) add(x, "support");
      pair = undefined;
    }
    const scaledProp = props.find((p) => p.kind === "compare-scale");
    if (!pair && !partPair && scaledProp && scaledProp.ids.length === 2 && !scaledProp.ids.some((x) => kr(x))) {
      pair = [canon(scaledProp.ids[0], tag(m))!, canon(scaledProp.ids[1], tag(m))!];
      decide("relation", f.i, `${pair[0]} and ${pair[1]} on one scale`, md.proposals.find((p) => p.value === scaledProp)!.from, md.proposals.find((p) => p.value === scaledProp)!.why ?? "proposed");
    }
    const scaled = !!pair && !!scaledProp && scaledProp.ids.every((x) => pair!.includes(canon(x, tag(m))!));
    const pairIsSubject = !!pair && (!subj || pair.includes(subj));
    if (q) add(`q.${k}`, "question");
    for (const x of f.carry) add(x, "support");
    for (const x of m.from.map((fr) => fr.b)) add(x, "support");
    for (const x of m.keep) add(x, "support");
    // A moment merged into this one may have pinned or played a computed thing: it stays on screen for its steps.
    for (const j of f.merged) for (const x of pinsOf(j).computed) add(x, "support");
    if (m.show && sid(m.show) !== subj) add(m.show, "support");
    const plainArrows: Plan["arrows"] = [];
    const parrows: PArrow[] = [];
    for (const a of m.arrows) {
      const ra = pr(a.a);
      const rb = pr(a.b);
      if (ra && rb) (add(a.a, "support"), add(a.b, "support"), notes.push(`${tag(m)} arrow ${a.a} -> ${a.b} joins two parts of the material: both are outlined, no arrow`));
      else if (ra || rb) {
        const part = (ra ?? rb)!;
        const t = ra ? a.b : a.a;
        add(t, "support");
        add(part.part ? `${part.name}.${part.part}` : part.name, "support");
        if (part.part) parrows.push({ t, pic: part.name, part: part.part, to: !!rb });
        if (a.label) notes.push(`${tag(m)} arrow label "${a.label}" is not drawn: words stay off the material`);
      } else (add(a.a, "support"), add(a.b, "support"), plainArrows.push(a));
    }
    for (const x of m.wrong) add(x, "support");
    for (const x of f.becomes) add(x.id, "support");
    for (const a of f.acts) for (const x of [...a.ids, ...(a.to ? [a.to] : [])]) if (x && sid(x) !== subj) add(x, "support");
    // An apparatus is one thing: while any part of it is on screen, the rest stays as quiet context.
    const here = (x: string) => has(x) || x === subj;
    for (const { ids: g, flow } of apparatus) {
      // A source brings what it feeds; a vessel brings only its primary source; things that fall together come together.
      const pull = !flow ? (g.some(here) ? g : []) : here(g[0]!) ? [g[1]!] : here(g[1]!) && primarySource.get(g[1]!) === g[0] ? [g[0]!] : [];
      for (const x of pull) if (!here(x)) (add(x, "support"), decide("continuity", f.i, `${x} stays as context`, "style", `it belongs to one apparatus with ${g.filter((y) => y !== x).join(", ")}`));
    }
    // A scene holds together: what a thing rests on, hangs from or stands in stays on screen while it is shown, so
    // nothing floats where its support should be.
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rels)
        if (HELD_BY.has(r.kind) && here(r.a) && !here(r.b)) {
          add(r.b, "support");
          decide("continuity", f.i, `${r.b} stays as context`, "author", `${r.a} ${r.words} ${r.b}: what it is placed on stays with it`);
          grew = true;
        }
    }
    if (pair) for (const x of pair) add(x, pairIsSubject ? "subject" : "support");
    if (subj) {
      const s = slots.find((x) => x.id === subj);
      if (s) s.cls = "subject";
      else add(subjRaw!, "subject");
      reg(subjRaw!, true);
    }
    if (phFor) slots.push({ id: "ph", cls: "ph", wrong: false, reveal: false });
    for (const fr of m.from) {
      const s = slots.find((x) => x.id === sid(fr.a));
      if (s) s.born = fr.b;
      else add(fr.a, "support", { born: fr.b });
    }
    for (const s of slots) {
      if (pics.has(s.id)) (s.part = focusSub.get(s.id)), (s.parts = [...(focusSup.get(s.id) ?? [])].filter((x) => x !== s.part));
      if (computed.has(s.id) && s.cls === "subject" && kr(subjRaw)?.part) {
        s.part = kr(subjRaw)!.part;
        decide("focus", f.i, `${s.id}.${s.part} is the subject, within ${s.id}`, "author", "the moment shows a part of a computed thing: the whole thing is placed, and the part is named for the instruments");
      }
      if (s.cls === "subject") subjectEver.add(s.id);
    }
    for (const s of slots) {
      const key = s.id === "ph" ? phFor! : s.id;
      if (s.cls !== "question" && !rank.has(key)) rank.set(key, rank.size);
    }
    // Levels on a chart: proposals ("level", [chart.part, thing]) and the parts compared on it.
    const levels: Plan["levels"] = [];
    for (const p of props.filter((x) => x.kind === "level")) {
      const r = pr(p.ids[0]);
      if (r?.part && has(r.name) && p.ids[1] && has(sid(p.ids[1])!)) levels.push({ part: r.part, thing: sid(p.ids[1])!, v: Number(p.args?.value) });
    }
    for (const p of props.filter((x) => x.kind === "pointer")) {
      const r = pr(p.ids[1]);
      if (r?.part && has(r.name) && has(sid(p.ids[0])!) && !parrows.length) parrows.push({ t: sid(p.ids[0])!, pic: r.name, part: r.part, to: true });
    }
    plans.push({ slots, pair: pair && has(pair[0]) && has(pair[1]) ? (pair as [string, string]) : undefined, scaled, partPair, arrows: plainArrows, parrows, subject: subj, question: q, phFor, levels });
  });
  const flows = new Map<string, string>();
  const fallGroups: string[][] = [];
  const fallenAt: Set<string>[] = [];
  {
    const fallen = new Set<string>();
    fms.forEach((f) => {
      fallenAt.push(new Set(fallen));
      for (const a of f.acts) {
        if (is(a, "flow") && a.to && isObj(a.ids[0]) && isObj(a.to) && !flows.has(a.ids[0]!)) (flows.set(a.ids[0]!, a.to), decide("composition", f.i, `${a.ids[0]} over ${a.to}, one apparatus`, "style", `${a.ids[0]} ${a.verb} ${a.to}: the source's outlet over the target's mouth whenever both are on screen`));
        if (is(a, "fall")) {
          const g = a.ids.filter(isObj);
          if (g.length && !fallGroups.some((x) => g.every((y) => x.includes(y)))) (fallGroups.push(g), decide("composition", f.i, `${g.join(" and ")} fall together`, "style", `${g.length > 1 ? "side by side, bottoms level, " : ""}over a floor with room to fall`));
          g.forEach((x) => fallen.add(x));
        }
      }
    });
  }
  // Scenes: things the author relates, solved once at one real scale (abilities/scene.ts), so they keep their places
  // across the moments they share. A source that pours or drips into a thing of a scene joins it, its outlet held over the
  // mouth. Things that fall together keep their own composition (room to fall).
  type SceneG = { ids: string[]; things: A.SceneThing[]; layout: A.SceneLayout };
  const scenes: SceneG[] = [];
  const sceneOf = new Map<string, number>();
  const told = new Set<string>();
  {
    const falling = new Set(fallGroups.flat());
    const srels: A.SceneRel[] = [];
    for (const r of rels) {
      if (falling.has(r.a) || falling.has(r.b)) {
        notes.push(`${r.a} ${r.words} ${r.b}: ${falling.has(r.a) ? r.a : r.b} falls, so it keeps the fall's own composition and the line places nothing`);
        continue;
      }
      srels.push({ a: r.a, b: r.b, kind: r.kind, words: r.words, ...(r.at ? { at: r.at } : {}), ...(r.gapCm !== undefined ? { gapCm: r.gapCm } : {}) });
    }
    const related = new Set(srels.flatMap((r) => [r.a, r.b]));
    for (const [src, dst] of flows)
      if ((related.has(src) || related.has(dst)) && !falling.has(src) && !falling.has(dst)) {
        srels.push({ a: src, b: dst, kind: "over", words: "pours into", aPoints: ["outlet", "mouth"], bPoints: ["mouth", "surface"], gapShare: V.n("apparatus.gapShare") });
        decide("staging", undefined, `${src} over ${dst}, in the scene`, "style", `${src} pours or drips into ${dst}, which the author places in a scene: its outlet is held over the mouth at the scene's one scale`);
      }
    // Connected things are one scene.
    const root = new Map<string, string>();
    const find = (x: string): string => {
      let y = x;
      while (root.has(y) && root.get(y) !== y) y = root.get(y)!;
      return y;
    };
    for (const r of srels) if (find(r.a) !== find(r.b)) root.set(find(r.a), find(r.b));
    const parts = new Map<string, string[]>();
    for (const r of srels)
      for (const x of [r.a, r.b]) {
        const list = parts.get(find(x)) ?? parts.set(find(x), []).get(find(x))!;
        if (!list.includes(x)) list.push(x);
      }
    for (const ids of parts.values()) {
      const things: A.SceneThing[] = ids.map((id) => {
        const d = defs.get(id)!.obj!;
        const real = defs.get(id)!.spec ? sizeCm(defs.get(id)!.spec!) : undefined;
        return { id, w: d.box.w, h: d.box.h, ...(real ? { realCm: real } : {}), point: (n: string) => pointOf(d, n) };
      });
      const mine = srels.filter((r) => ids.includes(r.a));
      const layout = A.solveScene(things, mine, { gap: V.n("scene.gap") });
      const n = scenes.push({ ids, things, layout }) - 1;
      ids.forEach((x) => sceneOf.set(x, n));
      for (const c of layout.checks) {
        const why = c.by ? `${c.rel.a}'s ${c.by.a} on ${c.rel.b}'s ${c.by.b}` : c.rel.kind;
        decide("staging", undefined, `${c.rel.a} ${c.rel.words ?? c.rel.kind} ${c.rel.b}: ${c.held ? "held" : `${Math.round(c.offCm)} cm off`}`, c.rel.aPoints ? "style" : "author", why, { offCm: Math.round(c.offCm) });
        // A place the author names on a thing that has no point by that name is the depicter's to give.
        if (c.rel.at && !pointOf(defs.get(c.rel.b)!.obj!, c.rel.at)) problems.push({ thing: c.rel.b, who: "depicter", task: `depict.${c.rel.b}`, problem: `the plan puts ${c.rel.a} at "${c.rel.at}" of ${c.rel.b}: name that place in points, [x, y] as 0 to 1 of the box` });
      }
      for (const id of layout.unsized) problems.push({ thing: id, who: "depicter", task: `depict.${id}`, problem: `it stands in one scene with ${ids.filter((x) => x !== id).join(", ")}: give its real size, so the scene keeps their true proportion` });
      for (const x of layout.notes) notes.push(`scene ${ids.join(", ")}: ${x}`);
      decide("staging", undefined, `${ids.join(", ")} as one scene, back to front ${layout.z.join(", ")}${layout.grounds.length ? `; ${layout.grounds.join(", ")} under the rest` : ""}`, "author", "the author says where these things are relative to each other: they are staged together at one real scale");
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 4. Entities: what is drawn, with versions (becomes "text") and counts (becomes N) over time.
  const ents = new Map<string, Ent>();
  const key = (id: string) => (pics.has(id) ? `p.${id}` : computed.has(id) ? `k.${id}` : `t.${id}`);
  const verAt: Map<string, number>[] = [];
  const countAt: Map<string, number>[] = [];
  const textsOf = new Map<string, string[]>();
  const nOf = new Map<string, number>();
  for (const d of defs.values()) {
    if (d.many) nOf.set(d.id, d.many.n);
    else if (!d.obj) textsOf.set(d.id, [d.text]);
  }
  const maxN = new Map<string, number>(nOf);
  {
    const ver = new Map<string, number>();
    fms.forEach((f) => {
      for (const b of f.becomes) {
        const d = defs.get(b.id);
        if (!d) continue;
        if (d.many) {
          if (b.n === undefined) notes.push(`${tag(f.m)} ${b.id} becomes words, but it is a many thing: ignored`);
          else nOf.set(b.id, Math.max(0, Math.round(b.n))), maxN.set(b.id, Math.max(maxN.get(b.id) ?? 0, Math.round(b.n)));
        } else if (d.obj) notes.push(`${tag(f.m)} ${b.id} is an object: say what changes about it with a verb the depicter maps onto it`);
        else {
          const t = b.text ?? String(b.n);
          const list = textsOf.get(b.id)!;
          if (list.at(-1) !== t) list.push(t);
          ver.set(b.id, list.lastIndexOf(t));
        }
      }
      verAt.push(new Map([...textsOf.keys()].map((id) => [id, ver.get(id) ?? 0])));
      countAt.push(new Map(nOf));
    });
  }
  const linesFor = (text: string, subject: boolean) => A.pickLines(text, em, { width: rw(U), cap: V.px("type.subjectMax"), size: V.px("type.support"), gain: V.n("type.twoLineGain"), subject });
  for (const d of defs.values()) {
    if (d.obj) (ents.set(d.id, { id: d.id, type: "obj" }), decide("depiction", undefined, `${d.id}: ${d.obj.kind}${d.obj.form ? ` (${d.obj.form})` : ""}${d.obj.size ? `, ${d.obj.size.w} by ${d.obj.size.h} ${d.obj.size.unit}` : ""}`, "material", d.spec?.why ?? "the depicter's answer"));
    else if (d.many) ents.set(d.id, { id: d.id, type: "many", many: { id: d.id, unit: d.many.unit, maxN: Math.max(1, maxN.get(d.id) ?? d.many.n), n0: d.many.n } });
    else ents.set(d.id, { id: d.id, type: "text", text: A.textEnt(d.id, textsOf.get(d.id)!, (t) => linesFor(t, subjectEver.has(d.id)), em) });
  }
  for (const p of pics.values()) if (plans.some((pl) => pl.slots.some((s) => s.id === p.name))) ents.set(p.name, { id: p.name, type: "pic" });
  for (const c of computed.values()) if (plans.some((pl) => pl.slots.some((s) => s.id === c.id))) ents.set(c.id, { id: c.id, type: "kit" });
  plans.forEach((p, k) => {
    if (p.question) ents.set(`q.${k}`, { id: `q.${k}`, type: "text", text: A.textEnt(`q.${k}`, [p.question], (t) => A.twoLines(t, em).length > 1 && em(t) * V.px("type.question") > rw(U) ? A.twoLines(t, em) : [t], em) });
    if (p.phFor) ents.set("ph", { id: "ph", type: "ph", text: A.textEnt("ph", [A.PLACEHOLDER], (t) => [t], em) });
  });
  const picParts = new Map<string, Set<string>>();
  for (const p of plans) for (const s of p.slots) if (pics.has(s.id)) for (const x of [s.part, ...(s.parts ?? [])]) if (x) (picParts.get(s.id) ?? picParts.set(s.id, new Set()).get(s.id)!).add(x);
  // A redrawn chart's words follow the design's type sizes and the moment's type scale (labels at the label step, its
  // values a step up, its words in focus large), never under the smallest size; the chart fits them in its box.
  const typeScaleOf = (k?: number) => (k === undefined ? 1 : fms.find((x) => x.i === k)?.md.typeScale.value ?? 1);
  const chartSmall = (k?: number) => Math.max(MIN_FS, V.px("type.label", k) * typeScaleOf(k));
  const LABEL_FONT = roleLook(theme, "label").font ?? FONT;
  const emLabel = (t: string) => emCache.get(`\u0000${t}`) ?? emCache.set(`\u0000${t}`, measure(t, 100, LABEL_FONT) / 100).get(`\u0000${t}`)!;
  const chartLook = (k?: number): A.ChartLook => ({ small: chartSmall(k), min: MIN_FS, valueFs: Math.max(MIN_FS, chartSmall(k) * V.n("chart.valueScale", k)), headBig: Math.max(MIN_FS, V.px("chart.headBig", k) * typeScaleOf(k)), headShare: V.n("chart.headShare", k), rowLine: V.n("chart.rowLine", k), gap: V.px("chart.gap", k), barFrac: V.n("chart.barFrac", k), photoBarFrac: V.n("chart.photoBarFrac", k), dimBars: V.n("chart.dimBars", k), dimText: V.n("chart.dimText", k), labelOpacity: V.n("chart.labelOpacity", k), levelPad: V.px("chart.levelPad", k), em, emLabel });

  // ---------------------------------------------------------------------------------------------------------------
  // 5. Layout: per moment, the anchor where the design asks, the rest packed around it by the arrangement.
  const blank = () => A.blankSt(C.subject);
  type LaidOut = { items: Map<string, Item>; order: string[]; stageKey?: string; stageRect?: Rect; boxes: Record<string, [number, number, number, number]>; over: number };
  const textBlock = (keyId: string, entId: string, e: A.TextEnt, ver: number, fs: number, st: Partial<St>, rnk: number, subject: boolean): Block => {
    const b = A.textBox(e, ver, fs, LH);
    return { key: keyId, rank: rnk, w: b.w, h: b.h, items: [{ id: entId, dx: 0, dy: b.h / 2, w: b.w, h: b.h, st: { ...st, fs, s: fs / 100 } }], decor: [], subject, stage: false };
  };

  function layoutMoment(k: number, fixedStage: Rect | undefined, tell: boolean): LaidOut {
    const plan = plans[k]!;
    const f = fms[k]!;
    const md = f.md;
    const pin = pinsOf(f.i);
    const slotOf = new Map(plan.slots.map((s) => [s.id, s]));
    const verOf = (id: string) => verAt[k]!.get(id) ?? 0;
    const supOp = pin.supportOpacity ?? md.supportOpacity.value;
    const arrangement = pin.arrangement ?? md.arrangement.value;
    const typeScale = md.typeScale.value;
    const colorFor = (s: Slot, subjectLike: boolean) => (s.wrong ? C.wrong : s.reveal ? C.answer : s.cls === "question" ? C.heading : subjectLike ? C.subject : C.muted);
    // Focus is the designer's: one subject (or two compared) with support stepping back, no focal point (all at full
    // strength), or the subject withheld (it keeps its place, unseen, until a later moment shows it).
    const focus = md.focus.value;
    const level = focus === "none" || focus === "all";
    const subjOp = focus === "hidden" ? V.n("focus.hidden", f.i) : 1;
    const opFor = (s: Slot, subjectLike: boolean) => (s.wrong ? V.n("wrong.opacity", f.i) : subjectLike ? subjOp : s.cls === "question" || level ? 1 : supOp);
    if (tell && focus !== "one" && focus !== "two") decide("focus", f.i, focus === "hidden" ? `the subject is withheld (opacity ${subjOp})` : "no focal point: support at full strength", md.focus.from, md.focus.why ?? "");
    const pinnedFs = (id: string) => pin.texts.find((t) => t.id === id)?.size;
    // Text sizes: the subject up to the type scale's largest step (times the moment's type scale) and the width it is
    // given; support and questions at their steps, shrunk by cs when room is short; never under the smallest size.
    const fsFor = (e: A.TextEnt, ver: number, role: "subject" | "support" | "question", maxW: number, cs: number, wrong: boolean, maxH = Infinity) => {
      const fit = Math.min(maxW / e.ems[ver]!, maxH / (e.lines[ver]!.length * LH));
      const pinned = pinnedFs(e.id);
      let fs = pinned ?? (role === "subject" ? V.px("type.subjectMax", f.i) * typeScale : role === "question" ? V.px("type.question", f.i) * typeScale * cs : V.px("type.support", f.i) * typeScale * cs);
      fs = Math.min(fs, fit);
      if (wrong) fs *= V.n("type.wrong", f.i);
      // Words that only fit below the smallest size count as not fitting, so the packer makes room instead.
      if (fit < MIN_FS - 0.5) squeezed++;
      return Math.max(fs, Math.min(MIN_FS, fit));
    };
    const objCls = (id: string): Partial<St> => ({ cls: slotOf.get(id)!.cls, op: slotOf.get(id)!.cls === "subject" ? subjOp : !plan.subject || !slotOf.has(plan.subject) || level ? 1 : supOp, reveal: slotOf.get(id)!.reveal });
    // Countable marks on screen together share one mark size.
    const manyExtent = (s: Slot, maxW: number, cs: number, paired: boolean) => Math.min(maxW, (paired ? V.px("many.paired", f.i) : V.px("many.support", f.i)) * cs);
    let markCap = Infinity;
    const manyBlock = (s: Slot, extent: number, maxW: number): Block => {
      const e = ents.get(s.id)!.many!;
      const subjectLike = s.cls === "subject";
      const b = A.manyBox(e, { extent: Math.min(extent, maxW), labelFs: V.px("type.label", f.i), cap: markCap, gap: V.px("many.labelGap", f.i), minW: 0, lineHeight: LH });
      const n = countAt[k]!.get(s.id) ?? e.n0;
      return { key: s.id, rank: rank.get(s.id) ?? 0, w: b.w, h: b.h, items: [{ id: s.id, dx: 0, dy: b.h / 2, w: b.w, h: b.h, st: { cls: s.cls, wrong: s.wrong, reveal: s.reveal, color: colorFor(s, subjectLike), op: opFor(s, subjectLike), s: b.s, n, dotsY: b.dotsY, labY: b.labY, label: `${e.unit} × ${n}`, fs: extent } }], decor: [], subject: subjectLike, stage: false };
    };
    const supportBlock = (s: Slot, maxW: number, cs: number): Block => {
      const e = ents.get(s.id)!;
      const subjectLike = s.cls === "subject";
      if (e.type === "many") return manyBlock(s, manyExtent(s, maxW, cs, false), maxW);
      if (e.type === "ph") {
        const R = ents.get(plan.phFor!);
        const fs = R?.type === "text" && !plan.subject ? fsFor(R.text!, 0, "subject", maxW, 1, false) : Math.min(V.px("type.placeholder", f.i) * cs, maxW / e.text!.ems[0]!);
        return textBlock("ph", "ph", e.text!, 0, fs, { cls: "ph", color: C.muted, op: supOp }, rank.get(plan.phFor!) ?? 0, false);
      }
      const role = s.cls === "subject" ? "subject" : s.cls === "question" ? "question" : "support";
      const ver = verOf(s.id);
      const fs = fsFor(e.text!, ver, role, maxW, cs, s.wrong);
      return textBlock(s.id, s.id, e.text!, ver, fs, { cls: s.cls, wrong: s.wrong, reveal: s.reveal, ver, color: colorFor(s, subjectLike), op: opFor(s, subjectLike) }, s.cls === "question" ? -1 : rank.get(s.id) ?? 0, subjectLike);
    };
    const pairBlock = (maxW: number, cs: number, asAnchor: boolean, maxH: number): Block => {
      const [a, b] = wordPair!;
      const members = [slotOf.get(a)!, slotOf.get(b)!];
      const subjectLike = members[0]!.cls === "subject";
      const gap = V.px("compare.gap", f.i);
      const texts = members.map((s) => ({ s, e: ents.get(s.id)!, ver: verOf(s.id) }));
      const emMax = Math.max(...texts.filter((t) => t.e.type === "text").map((t) => t.e.text!.ems[t.ver]!), 0.2);
      const nums = texts.map((t) => (t.e.type === "text" ? A.numOf(t.e.text!.texts[t.ver]!) : undefined));
      const placed: Placed[] = [];
      const decor: Dec[] = [];
      const role = subjectLike ? "subject" : "support";
      if (plan.scaled && nums[0] && nums[1] && texts.every((t) => t.e.type === "text")) {
        // Columns of one kind on one baseline, heights on one scale, each value standing on its own column.
        const colW = (maxW - gap) / 2;
        const fs0 = Math.min(...texts.map((t) => fsFor(t.e.text!, t.ver, role, colW * 0.96, cs, t.s.wrong)));
        const boxes = texts.map((t) => A.textBox(t.e.text!, t.ver, fs0, LH));
        const textH = Math.max(...boxes.map((x) => x.h));
        const vg = V.px("compare.valueGap", f.i);
        const Hb = Math.max(0, Math.min(V.n("compare.columnHeight", f.i) * rh(U) * (asAnchor ? 1 : cs), maxH - textH - vg));
        const hs = A.columnsOnOneScale([nums[0].v, nums[1].v], Hb, MIN_FS * 0.2);
        const hC = textH + vg + Hb;
        texts.forEach((t, i) => {
          const dx = (i === 0 ? -1 : 1) * (colW / 2 + gap / 2);
          placed.push({ id: t.s.id, dx, dy: hC - hs[i]! - vg - boxes[i]!.h / 2, w: boxes[i]!.w, h: boxes[i]!.h, st: { cls: subjectLike ? "subject" : "support", wrong: t.s.wrong, reveal: t.s.reveal, ver: t.ver, color: colorFor(t.s, subjectLike), op: opFor(t.s, subjectLike), fs: fs0, s: fs0 / 100 } });
          decor.push({ type: "vbar", id: `vbar.${t.s.id}`, dx, dy: hC, len: hs[i]!, w: colW * V.n("compare.columnWidth", f.i), color: t.s.wrong ? C.wrong : t.s.reveal ? C.answer : subjectLike ? C.subject : C.muted, op: t.s.wrong ? 0.55 : subjectLike ? 1 : supOp });
        });
        if (tell) decide("relation", f.i, `${a} and ${b} as two columns on one baseline (${nums[0].v} against ${nums[1].v} ${nums[0].unit})`, "style", "quantities of one kind: a glance reads the ratio before any word");
        return { key: `pair.${a}.${b}`, rank: Math.min(rank.get(a) ?? 0, rank.get(b) ?? 0), w: maxW, h: hC, items: placed, decor, subject: subjectLike, stage: false };
      }
      const halfW = (maxW - gap) / 2;
      const side = texts.every((t) => t.e.type !== "text" || emMax * V.px("type.support", f.i) * cs <= halfW);
      const region = side ? halfW : maxW;
      const sized = texts.map((t) => {
        if (t.e.type === "many") {
          const bx = A.manyBox(t.e.many!, { extent: Math.min(region * 0.9, V.px("many.paired", f.i) * (subjectLike ? 1 : cs)), labelFs: V.px("type.label", f.i), cap: markCap, gap: V.px("many.labelGap", f.i), minW: 0, lineHeight: LH });
          return { ...t, box: { w: bx.w, h: bx.h }, many: bx, fs: 0 };
        }
        const fs = fsFor(t.e.text!, t.ver, role, region, cs, t.s.wrong);
        return { ...t, box: A.textBox(t.e.text!, t.ver, fs, LH), fs, many: undefined };
      });
      const mk = (i: number, dx: number, dy: number) => {
        const t = sized[i]!;
        const st: Partial<St> = { cls: subjectLike ? "subject" : "support", wrong: t.s.wrong, reveal: t.s.reveal, ver: t.ver, color: colorFor(t.s, subjectLike), op: opFor(t.s, subjectLike) };
        const n = countAt[k]!.get(t.s.id) ?? t.e.many?.n0 ?? 0;
        if (t.many) Object.assign(st, { s: t.many.s, n, dotsY: t.many.dotsY, labY: t.many.labY, label: `${t.e.many!.unit} × ${n}` });
        else Object.assign(st, { fs: t.fs, s: t.fs / 100 });
        placed.push({ id: t.s.id, dx, dy, w: t.box.w, h: t.box.h, st });
      };
      let h: number;
      if (side) {
        const hm = Math.max(sized[0]!.box.h, sized[1]!.box.h);
        mk(0, -(halfW / 2 + gap / 2), hm / 2);
        mk(1, halfW / 2 + gap / 2, hm / 2);
        h = hm;
      } else {
        mk(0, 0, sized[0]!.box.h / 2);
        mk(1, 0, sized[0]!.box.h + gap + sized[1]!.box.h / 2);
        h = sized[0]!.box.h + gap + sized[1]!.box.h;
      }
      if (tell) decide("relation", f.i, `compare ${a} ${b}: ${side ? "side by side" : "stacked"}`, "style", side ? "both fit side by side at support size" : "too wide to stand side by side");
      return { key: `pair.${a}.${b}`, rank: Math.min(rank.get(a) ?? 0, rank.get(b) ?? 0), w: side ? maxW : Math.max(...sized.map((s) => s.box.w)), h, items: placed, decor, subject: subjectLike, stage: false };
    };
    const arrowBlock = (ar: { a: string; b: string; label: string }, maxW: number, cs: number): Block => {
      const Ab = supportBlock(slotOf.get(ar.a)!, maxW, cs);
      const Bb = supportBlock(slotOf.get(ar.b)!, maxW, cs);
      const GA = V.px("arrow.gap", f.i);
      const items: Placed[] = [{ ...Ab.items[0]!, dy: Ab.h / 2 }, { ...Bb.items[0]!, dy: Ab.h + GA + Bb.h / 2 }];
      const len = V.px("arrow.len", f.i);
      const decor: Dec[] = [{ type: "arrow", id: `arrow.${ar.a}.${ar.b}`, dx: 0, dy: Ab.h + (GA - len) / 2, len, color: C.pointer }];
      let w = Math.max(Ab.w, Bb.w);
      if (ar.label) {
        const lid = `lab.${ar.a}.${ar.b}`;
        if (!ents.has(lid)) ents.set(lid, { id: lid, type: "text", text: A.textEnt(lid, [ar.label], (t) => [t], em) });
        const e = ents.get(lid)!.text!;
        const fs = Math.min(V.px("type.label", f.i) * cs, (maxW / 2 - GA / 2) / e.ems[0]!);
        const bx = A.textBox(e, 0, fs, LH);
        items.push({ id: lid, dx: GA / 2 + bx.w / 2, dy: Ab.h + GA / 2, ...bx, st: { cls: "support", color: C.muted, op: 1, fs, s: fs / 100, ver: 0 } });
        w = Math.max(w, 2 * (GA / 2 + bx.w));
      }
      return { key: `arrow.${ar.a}.${ar.b}`, rank: Math.min(Ab.rank, Bb.rank), w, h: Ab.h + GA + Bb.h, items, decor, subject: Ab.subject || Bb.subject, stage: false };
    };
    // The stage: what persists (objects and the user's material), composed in a box.
    const objIn = (id: string) => slotOf.has(id) && ents.get(id)?.type === "obj";
    const picIn = (id: string) => slotOf.has(id) && ents.get(id)?.type === "pic";
    const kitIn = (id: string) => slotOf.has(id) && ents.get(id)?.type === "kit";
    // A comparison that holds a drawn or computed thing is composed on the stage: the stage things side by side on one
    // baseline (at one real scale when their sizes are known), and a partner made of words beside the stage.
    const onStage = (id: string) => objIn(id) || picIn(id) || kitIn(id);
    const stagePair = plan.pair?.some(onStage) ? plan.pair : undefined;
    const wordPair = stagePair ? undefined : plan.pair;
    const pairSet = stagePair?.every((x) => objIn(x) || kitIn(x)) ? new Set(stagePair) : undefined;
    const stageParts = (): string[][] => {
      const used = new Set<string>();
      const groups: string[][] = [];
      // One apparatus per vessel. Of the sources on screen that feed it, the one that pours or drips in this moment has
      // its outlet over the mouth (else the primary source); any other stands beside the vessel, clear of the working
      // parts, so two sources never share the mouth.
      // A scene first: what the author relates stands together, each thing where its relations put it.
      scenes.forEach((sc, n) => {
        const mem = sc.ids.filter((x) => objIn(x) && !used.has(x));
        if (!mem.length) return;
        groups.push([`scene:${n}`, ...mem]);
        mem.forEach((x) => used.add(x));
      });
      const feeds = new Map<string, string[]>();
      for (const [src, dst] of flows) (feeds.get(dst) ?? feeds.set(dst, []).get(dst)!).push(src);
      const grouped = new Set([...flows.keys(), ...flows.values(), ...fallGroups.flat(), ...sceneOf.keys()]);
      for (const [dst, srcs] of feeds) {
        if (!objIn(dst) || used.has(dst)) continue;
        const here = srcs.filter((x) => objIn(x) && !used.has(x) && x !== dst);
        if (!here.length) continue;
        const acting = here.filter((x) => f.acts.some((a) => is(a, "flow") && a.ids[0] === x && a.to === dst));
        const src = acting.at(-1) ?? (here.includes(primarySource.get(dst) ?? "") ? primarySource.get(dst)! : here[0]!);
        const aside = here.filter((x) => x !== src);
        if (aside.length && tell) decide("composition", f.i, `${src} over ${dst}; ${aside.join(", ")} beside ${dst}`, "style", acting.includes(src) ? `${src} pours or drips into ${dst} now: its outlet takes the mouth` : `${src} is ${dst}'s primary source`);
        // Compared things stand together, not as satellites of an apparatus they are not part of.
        const keepPair = pairSet && !pairSet.has(src) && !pairSet.has(dst);
        const sats = [...aside, ...plan.slots.filter((sl) => objIn(sl.id) && !grouped.has(sl.id) && !used.has(sl.id) && !(keepPair && pairSet.has(sl.id))).map((sl) => sl.id)];
        groups.push(["flow", src, dst, ...sats]);
        [src, dst, ...sats].forEach((x) => used.add(x));
      }
      for (const g of fallGroups) {
        const mem = g.filter((x) => objIn(x) && !used.has(x));
        if (!mem.length) continue;
        groups.push(["fall", ...mem]);
        mem.forEach((x) => used.add(x));
      }
      for (const s of plan.slots) if ((objIn(s.id) || picIn(s.id) || kitIn(s.id)) && !used.has(s.id)) groups.push([objIn(s.id) ? "obj" : kitIn(s.id) ? "kit" : "pic", s.id]);
      // Two compared things that stand alone become one comparison, where the first of them stood.
      if (pairSet) {
        const [a, b] = [...pairSet];
        const alone = (g: string[], x: string) => g.length === 2 && g[1] === x && g[0] !== "pic" && !g[0]!.startsWith("scene:");
        const ga = groups.findIndex((g) => alone(g, a!));
        const gb = groups.findIndex((g) => alone(g, b!));
        if (ga >= 0 && gb >= 0) {
          groups.splice(Math.max(ga, gb), 1);
          groups.splice(Math.min(ga, gb), 1, ["pair", a!, b!]);
        }
      }
      return groups;
    };
    const stageBlock = (box: { w: number; h: number }, groups: string[][]): Block => {
      // Several stage things share the box along its longer side.
      const n = groups.length;
      const along = box.w >= box.h ? "x" : "y";
      const cell = along === "x" ? { w: box.w / n, h: box.h } : { w: box.w, h: box.h / n };
      const items: Placed[] = [];
      const decor: Dec[] = [];
      let off = 0;
      let W0 = 0;
      let H0 = 0;
      const cellsOut: { w: number; h: number; items: Placed[]; decor: Dec[] }[] = [];
      for (const g of groups) {
        const [kind, ...ids] = g;
        const out: Placed[] = [];
        const dec: Dec[] = [];
        let w = 0;
        let h = 0;
        if (kind!.startsWith("scene:")) {
          // The whole scene is fitted to the cell, so it keeps one size and place whichever of its things are shown.
          const sc = scenes[Number(kind!.slice(6))]!;
          // The moment's subject, when it is a thing of the scene, is what the window may close in on.
          const focus = plan.subject && sc.ids.includes(plan.subject) ? { id: plan.subject, share: V.n("scene.subjectShare", f.i) } : undefined;
          const fit = A.fitScene(sc.layout, sc.things, cell, { bleed: V.get<boolean>("scene.bleed", f.i), margin: V.n("scene.margin", f.i), ...(focus ? { focus } : {}) }, new Set(ids));
          // What runs past the window is cut to it, so it never runs under the words around the stage.
          const win: [number, number, number, number] | undefined = fit.spills ? [-fit.w / 2, 0, fit.w / 2, fit.h] : undefined;
          for (const mm of fit.members) out.push({ id: mm.id, dx: mm.dx, dy: mm.dy - mm.h / 2, w: mm.w, h: mm.h, st: { ...objCls(mm.id), s: mm.scale, ...(win ? { win } : {}) } });
          (w = fit.w), (h = fit.h);
          const from = (key: string): From => (V.over.has(key) || V.over.has(`${key}@${f.i}`) ? "designer" : "style");
          // Told once per moment, however many sizes the search for room tries.
          const say = (choice: string, key: string) => {
            if (!tell || told.has(`${f.i}|${key}`)) return;
            told.add(`${f.i}|${key}`);
            decide("staging", f.i, choice, from(key), V.style[key]!.why);
          };
          if (fit.bleeds.length && !fit.closer) say(`${fit.bleeds.join(", ")} runs past the scene's sides`, "scene.bleed");
          if (fit.closer) say(`the scene's window closes in on ${focus!.id}; the rest runs past it`, "scene.subjectShare");
        } else if (kind === "flow") {
          const [src, dst, ...sats] = ids;
          const ap = A.apparatus({ id: src!, shape: shapeOf(src!) }, { id: dst!, shape: shapeOf(dst!) }, sats.map((id) => ({ id, shape: shapeOf(id) })), cell, { sourceShare: V.n("apparatus.sourceShare", f.i), gapShare: V.n("apparatus.gapShare", f.i), sourceWidth: V.n("apparatus.sourceWidth", f.i), vesselWidth: V.n("apparatus.vesselWidth", f.i), satelliteShare: V.n("apparatus.satelliteShare", f.i), satelliteGap: V.px("apparatus.satelliteGap", f.i) });
          for (const mm of ap.members) out.push({ id: mm.id, dx: mm.dx, dy: mm.dy - mm.h / 2, w: mm.w, h: mm.h, st: { ...objCls(mm.id), s: mm.scale } });
          (w = ap.w), (h = ap.h);
        } else if (kind === "fall") {
          const g2 = A.fallGroup(ids.map((id) => ({ id, shape: shapeOf(id) })), cell, fallenAt[k]!, fallParams(f.i));
          for (const mm of g2.members) out.push({ id: mm.id, dx: mm.dx, dy: mm.dy - mm.h / 2, w: mm.w, h: mm.h, st: { ...objCls(mm.id), s: mm.scale, len: g2.fall } });
          dec.push({ type: "floor", id: `floor.${ids.join(".")}`, dx: -g2.floorW / 2, dy: g2.floorY, len: g2.floorW, color: C.muted, op: 0.5 });
          (w = g2.w), (h = g2.h);
        } else if (kind === "obj") {
          const p = shapeOf(ids[0]!);
          const sc = A.fitObject(p, cell);
          out.push({ id: ids[0]!, dx: 0, dy: (p.h * sc) / 2, w: p.w * sc, h: p.h * sc, st: { ...objCls(ids[0]!), s: sc } });
          (w = p.w * sc), (h = p.h * sc);
        } else if (kind === "pair") {
          const mem = ids.map((id) => {
            if (objIn(id)) return { id, shape: shapeOf(id) };
            const c = computed.get(id)!;
            return { id, shape: { w: c.box.w, h: c.box.h }, cap: c.nodes[0]?.props?.typeset ? 1 : undefined };
          });
          const g2 = A.sideBySide(mem, cell, V.px("compare.gap", f.i));
          for (const mm of g2.members) out.push({ id: mm.id, dx: mm.dx, dy: mm.dy - mm.h / 2, w: mm.w, h: mm.h, st: { ...objCls(mm.id), s: mm.scale } });
          (w = g2.w), (h = g2.h);
          if (tell) decide("relation", f.i, `compare ${ids[0]} ${ids[1]}: side by side on one baseline${g2.toScale ? ", at one real scale" : ""}`, "style", g2.toScale ? "both have real sizes: the eye reads their true ratio" : "a real size is missing for one of them: each fills an equal half, not to scale");
        } else if (kind === "kit") {
          // A computed thing fills its cell by the box of all it may ever show (so its later steps fit too), as the
          // scene language fits it into a slot; type (a formula) keeps its own size beside words, never larger.
          const c = computed.get(ids[0]!)!;
          const b = c.box;
          let sc = Math.min(cell.w / b.w, cell.h / b.h);
          if (c.nodes[0]?.props?.typeset) sc = Math.min(sc, 1);
          out.push({ id: ids[0]!, dx: 0, dy: (b.h * sc) / 2, w: b.w * sc, h: b.h * sc, st: { ...objCls(ids[0]!), s: sc } });
          (w = b.w * sc), (h = b.h * sc);
        } else {
          const s = slotOf.get(ids[0]!)!;
          const p = pics.get(s.id)!;
          if (isChart(p)) {
            const lit = plan.partPair?.pic === s.id ? plan.partPair.parts : s.part ? [s.part] : [];
            // The redrawn chart takes its cell, or the height its words need at that width when the cell is short, so
            // the packer makes room rather than letting labels print over each other.
            const real = md.proposals.some((q) => q.value.kind === "real" && q.value.ids.some((x) => x.split(".")[0] === s.id));
            let cw = cell.w;
            let fit = real ? undefined : A.chartFit({ w: cw, h: cell.h, sub: s.part, lit }, p, chartLook(f.i));
            // Short of room, a chart alone on a stage that stacks may take the usable frame's width: wider rows need
            // fewer lines.
            if (fit && !fit.fits && groups.length === 1 && arrangement !== "row" && arrangement !== "split" && rw(U) > cw + 1) {
              const wide = A.chartFit({ w: rw(U), h: cell.h, sub: s.part, lit }, p, chartLook(f.i));
              if (wide.fits || wide.needH < fit.needH) (fit = wide), (cw = rw(U));
            }
            const ch = fit && !fit.fits ? fit.needH : cell.h;
            if (fit && !fit.fits && tell) decide("layout", f.i, `${s.id}: the redrawn chart needs ${Math.round(fit.needH)} px of height at ${Math.round(cw)} px wide, ${Math.round(cell.h)} px given`, "style", "its labels, values and header rows at the smallest size do not fit the box", { needH: fit.needH, given: cell.h });
            out.push({ id: s.id, dx: 0, dy: ch / 2, w: cw, h: ch, st: { cls: s.cls, op: 1, s: 1, z: 1, ox: 0, oy: 0, sub: s.part, sup: s.parts, lit } });
            (w = cw), (h = ch);
          } else {
            const asp = p.w / p.h;
            const pw = Math.min(cell.w, cell.h * asp) * V.n("picture.photoWidth", f.i);
            const ph = pw / asp;
            const vw = A.viewOf(p, s.part ?? s.parts?.[0], s.part ? "subject" : "support", { closeUnder: V.n("picture.closeUnder", f.i), fillW: V.arr("picture.fill", f.i)[0]!, fillH: V.arr("picture.fill", f.i)[1]!, zoomMax: V.n("picture.zoomMax", f.i), zoomSupportMax: V.n("picture.zoomSupport", f.i), zoomMin: V.n("picture.zoomMin", f.i) });
            out.push({ id: s.id, dx: 0, dy: ph / 2, w: pw, h: ph, st: { cls: s.cls, op: 1, s: pw / A.REFW, ...vw, sub: s.part, sup: s.parts } });
            (w = pw), (h = ph);
          }
        }
        cellsOut.push({ w, h, items: out, decor: dec });
      }
      // Lay the cells side by side (or one under another), centered across.
      const totalAlong = cellsOut.reduce((s, c) => s + (along === "x" ? c.w : c.h), 0);
      W0 = along === "x" ? totalAlong : Math.max(...cellsOut.map((c) => c.w));
      H0 = along === "y" ? totalAlong : Math.max(...cellsOut.map((c) => c.h));
      off = along === "x" ? -totalAlong / 2 : 0;
      for (const c of cellsOut) {
        const sx = along === "x" ? off + c.w / 2 : 0;
        const sy = along === "x" ? (H0 - c.h) / 2 : off;
        for (const it of c.items) items.push({ ...it, dx: it.dx + sx, dy: it.dy + sy, ...(it.st.win ? { st: { ...it.st, win: [it.st.win[0] + sx, it.st.win[1] + sy, it.st.win[2] + sx, it.st.win[3] + sy] } } : {}) });
        for (const d of c.decor) decor.push({ ...d, dx: d.dx + sx, dy: d.dy + sy });
        off += along === "x" ? c.w : c.h;
      }
      const subject = items.some((it) => slotOf.get(it.id)?.cls === "subject");
      return { key: "stage", rank: Math.min(...items.map((it) => rank.get(it.id) ?? 0)), w: W0, h: H0, items, decor, subject, stage: true };
    };

    const groups = stageParts();
    const stageIds = new Set(groups.flatMap((g) => g.slice(1)));
    const pairIds = new Set(wordPair ?? []);
    if (tell && stagePair && !groups.some((g) => g[0] === "pair")) {
      const together = groups.some((g) => stagePair.every((x) => g.includes(x)));
      decide("relation", f.i, `compare ${stagePair[0]} ${stagePair[1]}: ${together ? "within the composition that already holds both" : "the drawn thing on the stage, its partner beside it"}`, "style", together ? "they already stand together on the stage, as one apparatus or group" : "a comparison of a drawn thing with words or with a thing composed elsewhere on the stage");
    }
    const arrowIds = new Set<string>();
    const arrowsUsed = plan.arrows.filter((ar) => {
      const ok = slotOf.has(ar.a) && slotOf.has(ar.b) && ar.a !== ar.b && !pairIds.has(ar.a) && !pairIds.has(ar.b) && !stageIds.has(ar.a) && !stageIds.has(ar.b) && !arrowIds.has(ar.a) && !arrowIds.has(ar.b);
      if (ok) (arrowIds.add(ar.a), arrowIds.add(ar.b));
      else if (tell) notes.push(`${tag(f.m)} arrow ${ar.a} -> ${ar.b} skipped: an end is already placed in another relation`);
      return ok;
    });
    const loose = plan.slots.filter((s) => !stageIds.has(s.id) && !pairIds.has(s.id) && !arrowIds.has(s.id));
    // The anchor: the stage when one is on screen, else the block that holds the subject, else the question.
    const anchorKind = groups.length ? "stage" : wordPair && (pairIds.has(plan.subject ?? "") || !plan.subject) ? "pair" : plan.subject && arrowIds.has(plan.subject) ? "arrow" : plan.subject && loose.some((s) => s.id === plan.subject) ? "single" : plan.question ? "question" : loose.length ? "first" : "none";
    const anchorSlot = anchorKind === "single" ? slotOf.get(plan.subject!)! : anchorKind === "question" ? slotOf.get(`q.${k}`)! : anchorKind === "first" ? loose[0]! : undefined;
    const scale0 = md.subjectScale.value;
    const at = md.subjectAt.value;
    const gaps = V.arr("space.gaps", f.i).map((g) => g * SHORT);
    const supportFloor = V.n("support.floor", f.i);
    const anchorFloor = V.n("anchor.floor", f.i);
    const buildAnchor = (bw: number, bh: number): Block | undefined => {
      if (anchorKind === "stage") return stageBlock({ w: bw, h: bh }, groups);
      if (anchorKind === "pair") return pairBlock(bw, 1, true, bh);
      if (anchorKind === "arrow") return arrowBlock(arrowsUsed.find((a) => a.a === plan.subject || a.b === plan.subject)!, bw, 1);
      if (!anchorSlot) return undefined;
      const e = ents.get(anchorSlot.id)!;
      if (e.type === "many") return manyBlock(anchorSlot, Math.min(bw, bh), bw);
      const role = anchorSlot.cls === "question" ? "question" : anchorSlot.cls === "subject" ? "subject" : "support";
      const ver = verOf(anchorSlot.id);
      if (e.type === "ph") return supportBlock(anchorSlot, bw, 1);
      const fs = fsFor(e.text!, ver, role, bw, 1, anchorSlot.wrong, bh);
      return textBlock(anchorSlot.id, anchorSlot.id, e.text!, ver, fs, { cls: anchorSlot.cls, wrong: anchorSlot.wrong, reveal: anchorSlot.reveal, ver, color: colorFor(anchorSlot, anchorSlot.cls === "subject"), op: opFor(anchorSlot, anchorSlot.cls === "subject") }, anchorSlot.cls === "question" ? -1 : rank.get(anchorSlot.id) ?? 0, anchorSlot.cls === "subject");
    };
    // Every other block, with the rank that says whether it goes before or after the anchor.
    const othersFor = (maxBefore: number, maxAfter: number, cs: number, anchorRank: number): (Block & { before: boolean })[] => {
      const out: (Block & { before: boolean })[] = [];
      const side = (r: number) => r < anchorRank;
      if (wordPair && anchorKind !== "pair") {
        const r = Math.min(rank.get(wordPair[0]) ?? 0, rank.get(wordPair[1]) ?? 0);
        out.push({ ...pairBlock(side(r) ? maxBefore : maxAfter, cs, false, rh(U)), before: side(r) });
      }
      for (const ar of arrowsUsed) {
        if (anchorKind === "arrow" && (ar.a === plan.subject || ar.b === plan.subject)) continue;
        const r = Math.min(rank.get(ar.a) ?? 0, rank.get(ar.b) ?? 0);
        out.push({ ...arrowBlock(ar, side(r) ? maxBefore : maxAfter, cs), before: side(r) });
      }
      for (const s of loose) {
        if (anchorSlot && s.id === anchorSlot.id) continue;
        const r = s.cls === "question" ? -1 : s.id === "ph" ? rank.get(plan.phFor!) ?? 0 : rank.get(s.id) ?? 0;
        // A subject that is not the anchor (words while the stage holds) is set at its own size, in the room it has.
        const b = s.cls === "subject" ? (() => {
          const e = ents.get(s.id)!;
          if (e.type !== "text") return supportBlock(s, side(r) ? maxBefore : maxAfter, cs);
          const ver = verOf(s.id);
          const fs = fsFor(e.text!, ver, "subject", (side(r) ? maxBefore : maxAfter) * scale0, 1, s.wrong);
          return textBlock(s.id, s.id, e.text!, ver, fs, { cls: s.cls, wrong: s.wrong, reveal: s.reveal, ver, color: colorFor(s, true), op: opFor(s, true) }, r, true);
        })() : supportBlock(s, side(r) ? maxBefore : maxAfter, cs);
        out.push({ ...b, rank: r, before: side(r) });
      }
      return out.sort((x, y) => x.rank - y.rank);
    };
    // The search for room: the largest gap, support shrinking, then the anchor shrinking, until all fits.
    markCap = Infinity;
    let squeezed = 0;
    let chosen: { anchor: Block; others: (Block & { before: boolean })[]; packed: ReturnType<typeof pack>; gap: number; cs: number; shrink: number; box: { w: number; h: number } } | undefined;
    let fallback: typeof chosen;
    const shrinks: number[] = [];
    if (fixedStage) shrinks.push(1);
    else for (let s = 1; s >= anchorFloor - 1e-6; s -= 0.06) shrinks.push(s);
    const css: number[] = [];
    for (let c = 1; c >= supportFloor - 1e-6; c -= 0.1) css.push(c);
    search: for (const shrink of shrinks) {
      // Split gives the anchor one half of the frame.
      const halves = arrangement === "split" ? splitHalves(U, at) : undefined;
      const room = halves ? halves.anchor : U;
      // Room is made along the axis the arrangement stacks on: a stack gives up height, a row width; the others both.
      const [sw0, sh0] = shrinkAxes(arrangement, shrink);
      const bw = fixedStage ? rw(fixedStage) : scale0 * sw0 * rw(room);
      const bh = fixedStage ? rh(fixedStage) : scale0 * sh0 * rh(room);
      const anchor = buildAnchor(bw, bh);
      if (!anchor) break;
      const A0 = fixedStage ? { x0: (fixedStage.x0 + fixedStage.x1) / 2 - anchor.w / 2, y0: (fixedStage.y0 + fixedStage.y1) / 2 - anchor.h / 2, x1: (fixedStage.x0 + fixedStage.x1) / 2 + anchor.w / 2, y1: (fixedStage.y0 + fixedStage.y1) / 2 + anchor.h / 2 } : halves ? anchorRect(halves.anchor, anchor.w, anchor.h, [0.5, 0.5]) : anchorRect(U, anchor.w, anchor.h, at);
      for (const cs of css)
        for (const gap of gaps) {
          squeezed = 0;
          const sw = sideWidths(arrangement, U, A0, gap);
          const others = othersFor(sw.before, sw.after, cs, anchor.rank);
          const packed = pack(arrangement, U, A0, others.map((b) => ({ key: b.key, w: b.w, h: b.h, before: b.before })), gap, !!fixedStage);
          const c = { anchor, others, packed, gap, cs, shrink, box: { w: bw, h: bh } };
          if (!fallback || packed.over < fallback.packed.over) fallback = c;
          if (squeezed) packed.over += squeezed * MIN_FS;
          if (packed.fits && !squeezed) {
            chosen = c;
            break search;
          }
        }
    }
    if (!chosen && fallback) {
      chosen = fallback;
      if (tell) notes.push(`${tag(f.m)} does not fit even at the smallest sizes: ${Math.round(fallback.packed.over)} px run over (arrangement ${arrangement})`);
      if (tell) decide("layout", f.i, `overflow ${Math.round(fallback.packed.over)} px`, "style", "nothing smaller fits; an agent should drop something or change the arrangement", { over: fallback.packed.over });
    }
    const items = new Map<string, Item>();
    const order: string[] = [];
    const boxes: LaidOut["boxes"] = {};
    let stageRect: Rect | undefined;
    if (chosen) {
      if (tell) {
        if (!(ARR as readonly string[]).includes(arrangement)) notes.push(`${tag(f.m)} arrangement "${arrangement}" is not one the packer knows: packed as a stack`);
        decide("layout", f.i, `${chosen.packed.arrangement}, anchor ${anchorKind} at ${Math.round(scale0 * chosen.shrink * 100)}% of the usable frame${fixedStage ? " (the stage keeps its place)" : ""}${chosen.cs < 1 ? `, support at ${Math.round(chosen.cs * 100)}%` : ""}, gap ${Math.round(chosen.gap)} px`, md.arrangement.from, md.arrangement.why ?? "", { anchorShrink: chosen.shrink, supportScale: chosen.cs, gap: chosen.gap });
        if (pin.arrangement) decide("layout", f.i, `arrangement ${pin.arrangement} pinned`, "author", "a pinned container line of the scene language");
      }
      const place = (b: Block, r: Rect) => {
        boxes[b.key] = [r.x0 / W, r.y0 / H, r.x1 / W, r.y1 / H];
        const cx = (r.x0 + r.x1) / 2;
        for (const p of b.items) {
          const e = ents.get(p.id)!;
          const type: ItemType = e.type === "many" ? "many" : e.type === "ph" ? "ph" : e.type === "pic" ? "pic" : e.type === "obj" ? "obj" : e.type === "kit" ? "kit" : "text";
          // Objects are placed by their base.
          const st: St = { ...blank(), ...p.st, x: cx + p.dx, y: r.y0 + p.dy + (type === "obj" ? p.h / 2 : 0), w: p.w, h: p.h } as St;
          // A scene cut to its window (widened below, once every block is placed).
          if (p.st.win) {
            const [a0, b0, a1, b1] = p.st.win;
            st.clip = [cx + a0, r.y0 + b0, cx + a1, r.y0 + b1];
            delete st.win;
          }
          const id = p.id === "ph" ? "ph" : p.id.startsWith("q.") || p.id.startsWith("lab.") ? p.id : key(p.id);
          items.set(id, { id, type, st, born: slotOf.get(p.id)?.born ? key(sid(slotOf.get(p.id)!.born!)!) : undefined });
          order.push(id);
          if (st.wrong && e.text) {
            const nl = e.text.lines[st.ver]!.length;
            const firstW = em(e.text.lines[st.ver]![0]!) * st.fs;
            items.set(`strike.${p.id}`, { id: `strike.${p.id}`, type: "strike", st: { ...blank(), x: st.x, y: st.y - ((nl - 1) / 2) * LH * st.fs, len: firstW + V.px("strike.pad", f.i), color: C.wrong, op: 1 } });
          }
        }
        for (const d of b.decor) items.set(d.id, { id: d.id, type: d.type, st: { ...blank(), x: cx + d.dx, y: r.y0 + d.dy, len: d.len, color: d.color, op: d.op ?? 1, w: d.w ?? 0, h: d.type === "floor" ? V.px("mark.width") * 0.6 : V.px("compare.barThick") } });
      };
      const a = chosen.packed.anchor;
      const ar: Rect = { x0: (a.x0 + a.x1) / 2 - chosen.anchor.w / 2, y0: a.y0, x1: (a.x0 + a.x1) / 2 + chosen.anchor.w / 2, y1: a.y0 + chosen.anchor.h };
      place(chosen.anchor, ar);
      // The stage's box is the room it was given (not only what it drew), so things that join it later fit beside it.
      if (chosen.anchor.stage) {
        const cx = Math.min(Math.max((ar.x0 + ar.x1) / 2, U.x0 + chosen.box.w / 2), U.x1 - chosen.box.w / 2);
        const cy = (ar.y0 + ar.y1) / 2;
        const bh = Math.max(rh(ar), Math.min(chosen.box.h, 2 * Math.min(cy - U.y0, U.y1 - cy)));
        stageRect = { x0: cx - chosen.box.w / 2, y0: cy - bh / 2, x1: cx + chosen.box.w / 2, y1: cy + bh / 2 };
      }
      for (const b of chosen.others) place(b, chosen.packed.rects.get(b.key)!);
      // A scene that runs past its window shows on to the nearest other thing, kept-clear zone or the frame's edge on
      // each side, as a frame crops a scene: it is cut only where something else needs the room.
      const cut = [...items.values()].filter((it) => it.st.clip);
      if (cut.length) {
        const mine = new Set(cut.map((it) => it.id));
        const blocks: Rect[] = [...chosen.others.map((b) => chosen!.packed.rects.get(b.key)!), ...[...items.values()].filter((it) => !mine.has(it.id) && it.st.w > 0 && it.st.h > 0 && ["obj", "pic", "kit", "text", "many"].includes(it.type)).map((it) => (it.type === "obj" ? { x0: it.st.x - it.st.w / 2, y0: it.st.y - it.st.h, x1: it.st.x + it.st.w / 2, y1: it.st.y } : { x0: it.st.x - it.st.w / 2, y0: it.st.y - it.st.h / 2, x1: it.st.x + it.st.w / 2, y1: it.st.y + it.st.h / 2 }))];
        // Kept-clear zones above or below (captions, a progress bar) cut it there; a zone beside it (buttons over the
        // frame's side) does not, since a backdrop runs on under them.
        const zones: Rect[] = keptClear(viewing).uiZones.map((z) => ({ x0: z.box[0] * W, y0: z.box[1] * H, x1: z.box[2] * W, y1: z.box[3] * H }));
        const g = chosen.gap / 2;
        for (const it of cut) {
          let [x0, y0, x1, y1] = it.st.clip!;
          const across = (o: Rect) => o.x1 > x0 && o.x0 < x1;
          y0 = Math.max(0, ...[...blocks, ...zones].filter((o) => across(o) && o.y1 <= y0 + 0.5).map((o) => o.y1 + g));
          y1 = Math.min(H, ...[...blocks, ...zones].filter((o) => across(o) && o.y0 >= y1 - 0.5).map((o) => o.y0 - g));
          const along = (o: Rect) => o.y1 > y0 && o.y0 < y1;
          x0 = Math.max(0, ...blocks.filter((o) => along(o) && o.x1 <= x0 + 0.5).map((o) => o.x1 + g));
          x1 = Math.min(W, ...blocks.filter((o) => along(o) && o.x0 >= x1 - 0.5).map((o) => o.x0 - g));
          it.st.clip = [x0, y0, x1, y1];
        }
      }
    }
    // Pointers from words to a part of the material, levels on a chart, through the placed state.
    const L = chartLook(f.i);
    for (const [cid, ci] of items) {
      if (ci.type !== "pic") continue;
      const pic = pics.get(cid.slice(2))!;
      if (!isChart(pic)) continue;
      const levels: { part: string; v: number; tag: string }[] = [];
      for (const lv of plan.levels) {
        if (!pic.barsOf.has(lv.part) || levels.some((l) => l.part === lv.part)) continue;
        levels.push({ part: lv.part, v: lv.v, tag: "" });
        anchorMem.set(`${pic.name}.${lv.part}`, lv.v);
        const ti = items.get(key(lv.thing));
        if (ti) ti.st.color = C.pointer;
        if (tell) decide("proposal", f.i, `level line at ${lv.v} on ${pic.name}.${lv.part}`, "style", `the words take the line's color`);
      }
      for (const part of plan.partPair?.pic === pic.name ? plan.partPair.parts : []) {
        if (levels.some((l) => l.part === part) || !pic.barsOf.has(part)) continue;
        const vs = pic.barsOf.get(part)!.map((i) => pic.data.values[i]!);
        const v = anchorMem.get(`${pic.name}.${part}`) ?? Math.round(vs.reduce((s, x) => s + x, 0) / vs.length);
        levels.push({ part, v, tag: String(v) });
      }
      ci.st.levels = levels;
    }
    plan.parrows.forEach((pa, i) => {
      const ti = items.get(key(pa.t));
      const pi = items.get(key(pa.pic));
      if (!ti || !pi) return;
      const pic = pics.get(pa.pic)!;
      const bx = isChart(pic) ? A.chartValueEnd(pi.st, pic, pa.part, L) : pic.parts.has(pa.part) ? A.partOnScreen(pi.st, pic, pa.part) : undefined;
      if (!bx) return;
      const id = `parrow.${i}.${pa.t}.${pa.part}`;
      items.set(id, { id, type: "parrow", st: { ...blank(), pts: A.pointerPoints(ti.st, bx, pa.to, { gap: V.px("pointer.gap", f.i), head: V.px("pointer.head", f.i), inset: V.px("pointer.gap", f.i) }) } });
      if (tell) decide("proposal", f.i, `pointer from ${pa.t} to ${pa.pic}.${pa.part}`, "style", "words shown while one part is held");
    });
    for (const [, it] of items) if (it.born && !items.has(it.born)) it.born = undefined;
    return { items, order, stageKey: groups.length ? [...stageIds].sort().join(" ") : undefined, stageRect, boxes, over: chosen?.packed.over ?? 0 };
  }
  const ARR = ["stack", "row", "around", "split", "inset"] as const;
  function shrinkAxes(arrangement: string, f: number): [number, number] {
    return arrangement === "stack" ? [1, f] : arrangement === "row" ? [f, 1] : [f, f];
  }
  const anchorMem = new Map<string, number>();
  let laid: LaidOut[] = [];
  for (let k = 0; k < K; k++) laid.push(layoutMoment(k, undefined, false));
  // The stage keeps its place: in each stretch of moments that share the same stage, every moment uses the smallest
  // stage box any of them needed, at that moment's place.
  const steadyStage: (Rect | undefined)[] = Array(K).fill(undefined);
  if (V.get<boolean>("stage.steady")) {
    for (let k = 0; k < K; ) {
      const sk = laid[k]!.stageKey;
      let e = k + 1;
      // A stretch goes on while each moment shares something on the stage with the one before it.
      const shares = (a?: string, b?: string) => !!a && !!b && a.split(" ").some((x) => b.split(" ").includes(x));
      while (sk && e < K && shares(laid[e - 1]!.stageKey, laid[e]!.stageKey)) e++;
      if (sk && e - k > 1) {
        // Each moment's own stage box is a candidate; the one the whole stretch fits around best is kept.
        // The stretch keeps the smallest size any of its moments needed, at the place where the whole stretch fits best
        // (each moment's own center is a candidate).
        const own = laid.slice(k, e).map((l) => l.stageRect!);
        const small = own.reduce((p, q) => (rw(q) * rh(q) < rw(p) * rh(p) ? q : p));
        const cands = own.map((r) => ({ cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 })).map(({ cx, cy }) => ({ x0: cx - rw(small) / 2, y0: cy - rh(small) / 2, x1: cx + rw(small) / 2, y1: cy + rh(small) / 2 })).filter((r, j, all) => all.findIndex((q) => Math.abs(q.x0 - r.x0) + Math.abs(q.y0 - r.y0) < 1) === j);
        const cost = (r: Rect) => {
          let over = 0;
          for (let j = k; j < e; j++) over += layoutMoment(j, r, false).over;
          anchorMem.clear();
          return over;
        };
        // When no place fits the whole stretch, the size steps down (to the anchor floor) and places along the free
        // range are tried too.
        let best = cands[0]!;
        let bestOver = Infinity;
        const floor = V.n("anchor.floor");
        for (let sz = 1; sz >= floor - 1e-6 && bestOver > 0.5; sz -= 0.08) {
          const [ax, ay] = shrinkAxes(fms[k]!.md.arrangement.value, sz);
          const wS = rw(small) * ax;
          const hS = rh(small) * ay;
          const tries = [...cands.map((r) => ({ cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 })), ...Array.from({ length: 7 }, (_, j) => ({ cx: (small.x0 + small.x1) / 2, cy: U.y0 + hS / 2 + ((rh(U) - hS) * j) / 6 }))];
          for (const { cx, cy } of tries) {
            const r = { x0: cx - wS / 2, y0: cy - hS / 2, x1: cx + wS / 2, y1: cy + hS / 2 };
            const over = cost(r);
            if (over < bestOver - 0.5) (bestOver = over), (best = r);
            if (bestOver <= 0.5) break;
          }
        }
        for (let j = k; j < e; j++) steadyStage[j] = best;
        decide("stage", fms[k]!.i, `the stage keeps one place for ${e - k} moments`, "style", V.style["stage.steady"]!.why);
      }
      k = e;
    }
  }
  anchorMem.clear();
  laid = [];
  for (let k = 0; k < K; k++) laid.push(layoutMoment(k, steadyStage[k], true));
  // Check: nothing placed overlaps anything else (a property the packer keeps; reported if it is broken).
  laid.forEach((l, k) => {
    const rs = Object.entries(l.boxes);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const [a, b] = [rs[i]![1], rs[j]![1]];
        const o = overlap({ x0: a[0] * W, y0: a[1] * H, x1: a[2] * W, y1: a[3] * H }, { x0: b[0] * W, y0: b[1] * H, x1: b[2] * W, y1: b[3] * H });
        if (o > 0.5) notes.push(`${tag(fms[k]!.m)} ${rs[i]![0]} and ${rs[j]![0]} overlap by ${Math.round(o)} px`);
      }
  });
  fms.forEach((f, k) => {
    if (!f.m.ask) return;
    const next = onsets[k + 1] ?? FRAMES;
    decide("direction", f.i, `think time ${((next - onsets[k]!) / FPS).toFixed(1)} s`, "style", plans[k]!.phFor ? "a placeholder waits in the answer's slot" : "the question stands alone");
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 6. Nodes: one long-lived node tree per entity, created hidden. Material first, so words sit in front of it.
  const w = new A.Writer(W, H);
  const used = new Set<string>();
  for (const l of laid) for (const id of l.items.keys()) used.add(id);
  const markW = V.px("mark.width");
  for (const [id, e] of ents) {
    if (e.type !== "pic" || !used.has(key(id))) continue;
    const pic = pics.get(id)!;
    if (isChart(pic)) A.chartNodes(w, key(id), pic, { subject: C.subject, muted: C.muted, pointer: C.pointer, small: chartSmall(), valueFs: chartSmall() * V.n("chart.valueScale"), baseWidth: markW * 0.5, levelWidth: V.px("level.width") });
    else A.pictureNodes(w, key(id), pic, picParts.get(id) ?? [], { pointer: C.pointer, pad: 6, radius: 14 });
  }
  // Computed things: the kit's own parts under their group, created hidden at their first place. Words the kit draws are
  // kept at least the smallest size at the smallest scale the thing is shown at, as the scene language keeps them.
  for (const [id, e] of ents) {
    if (e.type !== "kit" || !used.has(key(id))) continue;
    const c = computed.get(id)!;
    const placed = laid.map((l) => l.items.get(c.sid)?.st).filter((s): s is St => !!s && s.s > 0);    const s0 = Math.min(...placed.map((s) => s.s));
    const at = placed[0]!;
    const [root, ...rest] = c.nodes;
    w.node(c.sid, "group", { ...root!.props, x: at.x - c.box.x * at.s, y: at.y - c.box.y * at.s, scaleX: at.s, scaleY: at.s, opacity: 0 }, undefined);
    for (const n of rest) {
      const size = n.props?.size;
      const props = n.kind === "text" && typeof size === "number" && size * s0 < MIN_FS ? { ...n.props, size: Math.round((MIN_FS / s0) * 10) / 10 } : { ...(n.props ?? {}) };
      w.node(n.id, n.kind as "group" | "path" | "text" | "image", props, n.parent);
    }
  }
  // A scene's things are drawn back to front (what rests on a thing after it), in the slots its things already hold.
  const drawOrder = [...ents];
  for (const sc of scenes) {
    const at = drawOrder.flatMap(([id], i) => (sc.ids.includes(id) ? [i] : []));
    const byDepth = at.map((i) => drawOrder[i]!).sort((x, y) => sc.layout.z.indexOf(x[0]) - sc.layout.z.indexOf(y[0]));
    at.forEach((i, j) => (drawOrder[i] = byDepth[j]!));
  }
  for (const [id, e] of drawOrder) {
    if (e.type === "pic" || e.type === "kit") continue;
    const nid = id === "ph" ? "ph" : id.startsWith("q.") || id.startsWith("lab.") ? id : key(id);
    if (!used.has(nid)) continue;
    if (e.type === "many") A.manyNodes(w, nid, e.many!, { fill: C.key, labelColor: C.muted, labelFs: V.px("type.label") });
    else if (e.type === "obj") {
      // Drawn again at its size on screen, so its lines and its text have the style's widths there.
      const d0 = defs.get(id)!;
      const s0 = laid.map((l) => l.items.get(nid)?.st.s).find((x) => x !== undefined && x > 0) ?? 1;
      d0.obj = depictionFrom(d0.spec!, theme, { id: nid, look: suggestLook(theme, s0), text: V.px("type.label") / s0 });
      A.depictionNodes(w, d0.obj, { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: W / 2, y: H / 2 });
    } else {
      const pinRole = pins.flatMap((p) => p.texts).find((t) => t.id === id)?.role;
      A.textNodes(w, nid, e.text!, pinRole ?? (id.startsWith("q.") ? "heading" : id.startsWith("lab.") ? "label" : "title"), C.subject, LH);
    }
  }
  for (const id of used) {
    if (id.startsWith("strike.")) A.strikeNode(w, id, C.wrong, V.px("strike.width"));
    else if (id.startsWith("vbar.")) A.columnNode(w, id, C.subject);
    else if (id.startsWith("bar.") || id.startsWith("floor.")) A.barNode(w, id, { fill: C.muted });
    else if (id.startsWith("parrow.")) A.pointerNode(w, id, { color: C.pointer, width: markW });
    else if (id.startsWith("arrow.")) A.arrowNode(w, id, { color: C.pointer, width: markW, len: V.px("arrow.len"), head: V.px("arrow.head") });
  }
  const dashPx = V.arr("level.dash").map((x) => x * SHORT);
  for (const dst of new Set(flows.values())) A.bloomNodes(w, key(dst), V.n("flow.pool"));
  for (const g of fallGroups) A.fallNodes(w, g.map((id) => ({ id: key(id), fill: String(defs.get(id)!.obj!.state.color ?? C.subject) })), V.n("fall.trail"), g.length > 1 ? { id: `level.${g.join(".")}`, color: C.pointer, width: V.px("level.width"), dash: dashPx } : undefined);
  fms.forEach((f, k) => {
    for (const a of f.acts) {
      if (is(a, "read")) A.readingNodes(w, String(k), C.pointer);
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 7. Transitions: staged exits, moves, entrances; then what objects do; then the camera.
  const paceMul = (k: number) => (fms[k]!.m.pace === "slow" ? V.n("pace.slow", fms[k]!.i) : fms[k]!.m.pace === "fast" ? V.n("pace.fast", fms[k]!.i) : 1);
  const [mvMin, mvPer, mvMax] = V.arr("motion.move");
  const durMove = (px: number, k: number) => Math.max(1, Math.round(Math.min(mvMax!, mvMin! + mvPer! * Math.sqrt(Math.max(0, px) / SHORT)) * FPS * paceMul(k) * tempo));
  const ent = (id: string): Ent | undefined => (id === "ph" ? ents.get("ph") : id.startsWith("q.") || id.startsWith("lab.") ? ents.get(id) : id.startsWith("t.") || id.startsWith("p.") || id.startsWith("k.") ? ents.get(id.slice(2)) : undefined);
  const chartSeen = new Map<string, Set<number>>();
  // Real or redrawn is the designer's call per piece and moment: a "real" proposal keeps the user's own picture as it
  // is (evidence to recognise); otherwise a chart with its data is redrawn on its own bars.
  const realIn = (k: number, name: string) => fms[k]!.md.proposals.some((p) => p.value.kind === "real" && p.value.ids.some((x) => x.split(".")[0] === name));
  const target = (it: Item, k: number): Triple[] => {
    const { id, st } = it;
    if (it.type === "text" || it.type === "ph") return A.textTargets(id, ent(id)!.text!, st);
    if (it.type === "many") return A.manyTargets(id, st);
    if (it.type === "obj") {
      const out: Triple[] = [[id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op]];
      // A thing of a scene is cut to the scene's window in its own units (all of the frame when nothing runs past).
      if (sceneOf.has(id.slice(2))) {
        const [x0, y0, x1, y1] = st.clip ?? [-W, -H, 2 * W, 2 * H];
        const lx = (x: number) => (x - st.x) / st.s;
        const ly = (y: number) => (y - st.y) / st.s;
        out.push([id, "clip", [lx(x0), ly(y0), lx(x1), ly(y0), lx(x1), ly(y1), lx(x0), ly(y1)]]);
      }
      return out;
    }
    if (it.type === "kit") {
      // The group is placed so the center of the kit's box lands on the item's center.
      const b = computed.get(id.slice(2))!.box;
      return [[id, "x", st.x - b.x * st.s], [id, "y", st.y - b.y * st.s], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op]];
    }
    if (it.type === "pic") {
      const pic = pics.get(id.slice(2))!;
      if (isChart(pic)) return A.chartTargets(id, st, pic, realIn(k, pic.name) ? "photo" : "own", chartSeen.get(id) ?? new Set(), chartLook(fms[k]!.i), C);
      return A.pictureTargets(id, st, picParts.get(pic.name) ?? [], { dim: V.n("picture.dim", fms[k]!.i), supportOutline: V.n("picture.supportOutline", fms[k]!.i), outlineWidth: markW });
    }
    if (it.type === "parrow") return A.pointerTargets(id, st);
    if (it.type === "strike") return A.strikeTargets(id, st);
    if (it.type === "vbar") return A.columnTargets(id, st);
    if (it.type === "bar" || it.type === "floor") return A.barTargets(id, st);
    return A.arrowTargets(id, st);
  };
  const visibleIn = (k: number, id: string) => plans[k]!.slots.some((sl) => sl.id === id);
  // A thing that flashes a color while something flows into it blooms where each drop lands, until it changes color.
  const flashes: { dst: string; color: string; from: number; to: number; line: number }[] = [];
  const setsColor = (b: Act) => kindOf(b).def?.arg === "color" && kindOf(b).def?.motion !== "pulse";
  fms.forEach((f, k) => {
    for (const a of f.acts) {
      const c = kindOf(a);
      const id = sid(a.ids[0])!;
      if (c.kind !== "change" || c.def?.motion !== "pulse" || c.def.arg !== "color" || ![...flows.values()].includes(id)) continue;
      const col = A.colorNamed(defs.get(id)!.spec, a.arg);
      if (!col) {
        problems.push({ thing: id, who: "depicter", task: `depict.${id}`, problem: `${tag(f.m)} ${id} ${a.verb} "${a.arg ?? ""}": name that color among its colors` });
        continue;
      }
      let to = FRAMES;
      for (let m = k + 1; m < K; m++) if (fms[m]!.acts.some((b) => b.ids.includes(id) && setsColor(b))) (to = onsets[m]!), (m = K);
      flashes.push({ dst: id, color: col, from: onsets[k]!, to, line: a.line });
    }
  });
  const flashAt = (dst: string, t: number) => flashes.find((x) => x.dst === dst && t >= x.from && t < x.to)?.color;
  const poolAt = new Map<string, number>();
  const nextOf = (name: string) => {
    const j = poolAt.get(name) ?? 0;
    poolAt.set(name, j + 1);
    return `${name}.${j % V.n("flow.pool")}`;
  };

  const placedOf = (id: string, it: Item): A.Placed => ({ d: defs.get(id)!.obj!, x: it.st.x, y: it.st.y, s: it.st.s });
  const realOf = (id: string) => (defs.get(id)?.spec ? sizeCm(defs.get(id)!.spec!) : undefined);
  const scheduleActs = (k: number, at0: number, cur: Map<string, Item>): number => {
    const f = fms[k]!;
    const i = f.i;
    const nextOn = onsets[k + 1] ?? FRAMES;
    let landed = at0;
    f.acts.forEach((a) => {
      const Aid = sid(a.ids[0])!;
      const itA = cur.get(key(Aid));
      const def = defs.get(Aid);
      const c = kindOf(a);
      if (def?.missing) return; // the depicter's task is already reported
      if (!itA || !def?.obj) return void notes.push(`${tag(f.m)} "${Aid}" ${a.verb}: it is not an object on screen, so nothing moves`);
      if (c.kind === "unknown") {
        problems.push({ thing: Aid, who: "depicter", task: `depict.${Aid}`, problem: `${tag(f.m)} ${Aid} ${a.verb}: ${def.obj.label} has no verb "${a.verb}"; map it in the spec's verbs onto one it has (${Object.keys(def.obj.verbs).join(", ")}), or answer with a kind that can` });
        decide("act", i, `${Aid} ${a.verb} not drawn`, "author", "a verb this thing's depiction does not have yet");
        return;
      }
      const P = placedOf(Aid, itA);
      // The act's own moment in the plan (a merged moment carries acts of the moments merged into it).
      const origin = plan.moments.findIndex((pm) => pm.acts.some((x) => x.line === a.line));
      const demo = origin >= 0 ? demoOf(origin, plan.moments[origin]!.acts.findIndex((x) => x.line === a.line)) : undefined;
      if (c.kind === "flow") {
        const B = a.to ? sid(a.to)! : undefined;
        if (!B) return void problems.push({ thing: Aid, who: "author", problem: `line ${a.line}: ${Aid} ${a.verb}: into what? name the other thing` });
        const itB = cur.get(key(B));
        const dB = defs.get(B)?.obj;
        if (!itB || !dB) return void notes.push(`${tag(f.m)} ${Aid} ${a.verb} ${B}: ${B} is not an object on screen, so nothing flows`);
        let end = FRAMES - 6;
        for (let m = k + 1; m < K; m++) {
          const stop = fms[m]!.acts.some((b) => (is(b, "flow") && sid(b.ids[0]) === Aid) || (b.ids.includes(B) && setsColor(b))) || !visibleIn(m, Aid) || !visibleIn(m, B);
          if (stop) (end = onsets[m]!), (m = K);
        }
        end = Math.max(at0 + 20, end - V.f("flow.stopBefore", i));
        const sp = demo?.speed.value;
        // Slow, for a flow, is drop by drop at real speed; a number or fast changes the speed itself.
        const drops = sp === "slow" || (sp === undefined && (a.speed === "slow" || (!a.speed && f.m.pace === "slow")));
        const stretch = 1 / speedOf(sp === "slow" ? "real" : sp, i);
        const realA = realOf(Aid);
        const pxPerCm = P.s * (realA ? P.d.box.h / realA.h : P.d.box.h / V.n("flow.sourceCm", i));
        if (!realA) notes.push(`${tag(f.m)} ${Aid} has no real size: its flow is timed as from ${V.n("flow.sourceCm", i)} cm`);
        const j = drops ? 0 : 1;
        // A replay shares the flow's time: the live pass, a pause, then the replay at its speed, all before what follows.
        const stopF = V.f("flow.stop", i);
        let replay: { at: number; frames: number; rs: number } | undefined;
        if (demo?.replay) {
          const rs = 1 / speedOf(demo.replay.value.speed, i);
          const pause = V.f("flow.replayPause", i);
          const live = Math.round((end - at0 - pause - stopF) / (1 + rs / stretch));
          const frames = end - (at0 + live + stopF + pause);
          if (live >= FPS * 0.5 && frames >= FPS * 0.5) replay = { at: at0 + live + stopF + pause, frames, rs };
          else notes.push(`${tag(f.m)} ${Aid} ${a.verb} ${B}: no room for the replay before what follows (${((end - at0) / FPS).toFixed(1)} s in all)`);
        }
        const liveEnd = replay ? replay.at - stopF - V.f("flow.replayPause", i) : end;
        const res = A.playFlow(w, P, placedOf(B, itB), at0, liveEnd, {
          id: `flow.${key(Aid)}.${k}`,
          verb: a.verb,
          form: drops ? "drops" : "stream",
          rate: V.arr("flow.rate", i)[j]!,
          volume: { perDrop: V.n("flow.perDrop", i), perSecond: V.n("flow.perSecond", i) },
          widthPx: Math.max(V.arr("flow.trueWidth", i)[j]! * pxPerCm, V.px("flow.minWidth", i)),
          pxPerCm,
          stretch,
          bloom: { size: [V.arr("flow.bloom", i)[0]!, V.arr("flow.bloom", i)[1]! * SHORT], grow: V.f("flow.bloomGrow", i), fade: Math.round(V.arr("flow.bloomFade", i)[j]! * FPS), spread: V.n("flow.bloomSpread", i), every: V.f("flow.bloomEvery", i) },
          tapFrames: V.f("flow.tap", i),
          stopFrames: stopF,
          fps: FPS,
          theme,
          look: suggestLook(theme, 1),
        }, () => nextOf(`bloom.${key(B)}`), (t) => flashAt(B, t));
        flowIds.push(res.flow.id);
        let how = `${drops ? "drop by drop" : "a stream"}, ${res.lands.length} landings until ${(liveEnd / FPS).toFixed(1)} s${res.moved ? `, ${res.moved.toFixed(2)} ${P.d.capacity?.unit ?? ""} moved` : ""}${stretch !== 1 ? `, played at ${(1 / stretch).toFixed(2)} times real speed` : ""}`;
        if (replay) {
          A.replayFlow(w, res.flow, replay.at, replay.frames, replay.rs, FPS, stopF);
          how += `, then replayed for ${(replay.frames / FPS).toFixed(1)} s at ${(1 / replay.rs).toFixed(2)} times real speed (nothing moves a second time)`;
          landed = Math.max(landed, replay.at + replay.frames);
        }
        decide("demonstration", i, `${Aid} ${a.verb} ${B}: ${how}`, demo?.speed.from ?? "style", demo?.speed.why ?? "as the author paced it", { landings: res.lands.length, moved: res.moved });
        for (const n of res.notes) notes.push(`${tag(f.m)} ${n}`);
      } else if (c.kind === "fall") {
        const mem = a.ids.map((x) => sid(x)!).filter((x) => cur.has(key(x)) && isObj(x));
        const its = mem.map((id) => cur.get(key(id))!);
        if (!its.length) return;
        // Physical time from the drawing's scale: the fall in px over px per metre, or the style's height when no scale is known.
        const sized = mem.findIndex((id) => realOf(id));
        const pxPerM = sized >= 0 ? its[sized]!.st.w / (realOf(mem[sized]!)!.w / 100) : undefined;
        const metres = pxPerM ? its[0]!.st.len / pxPerM : V.n("fall.heightM", i);
        const real = Math.max(1, Math.round(A.fallSeconds(metres) * FPS));
        const speed = speedOf(demo?.speed.value, i);
        const rep = demo?.replay ? { speed: speedOf(demo.replay.value.speed, i), pause: V.f("fall.replayPause", i) } : undefined;
        const g2 = fallGroups.find((x) => mem.every((y) => x.includes(y)));
        const res = A.playFall(w, its.map((it, j) => ({ id: key(mem[j]!), x: it.st.x, y: it.st.y, s: it.st.s, d: it.st.w, len: it.st.len, fill: "" })), at0 + 2, {
          realFrames: real,
          speed,
          replay: rep,
          squash: { amount: V.n("fall.squash", i), frames: V.f("fall.squashTime", i), settle: V.f("fall.settle", i) },
          trail: { marks: V.n("fall.trail", i), opacity: V.n("fall.trailOpacity", i), fadeAt: nextOn - 6, fadeFrames: V.f("chart.lateFrames", i) },
          level: g2 && g2.length > 1 ? { id: `level.${g2.join(".")}`, opacity: V.n("fall.levelOpacity", i), holdAfter: V.f("fall.levelHold", i), fadeFrames: V.f("chart.lateFrames", i) } : undefined,
        });
        landed = Math.max(landed, res.land);
        decide("demonstration", i, `${mem.join(" and ")} fall ${metres.toFixed(2)} m: ${(real / FPS).toFixed(2)} s at real speed, played ${res.passes.map((p) => `${(p / FPS).toFixed(2)} s`).join(" then ")}`, demo?.speed.from ?? "style", `${pxPerM ? "the scale of the drawing comes from the real size of what falls" : "no real size is known, the style's height is used"}; ${demo?.why ?? "no demonstration plan: real speed"}`, { metres, realSeconds: real / FPS });
      } else if (c.kind === "read") {
        const said = a.arg && /\d/.test(a.arg) ? a.arg : undefined;
        const r = A.actOn(w, P, a.verb, said, at0 + 2, { frames: V.f("reading.move", i), fps: FPS });
        if (!r.known) problems.push({ thing: Aid, who: "depicter", task: `depict.${Aid}`, problem: `${tag(f.m)} ${Aid} ${a.verb}: ${r.notes.join("; ")}` });
        const v = A.readingOf(P, a.arg);
        // A stated value sits at its own graduation on the thing's scale. Where the contents drawn there stand elsewhere
        // (by more than one minor step), the scene says two things at once: the depicter is asked to repair it.
        const said0 = v.fromScale ? undefined : A.levelOfReading(P, v.value);
        const drawnLv = Number(P.d.state.level);
        if (said0 !== undefined && Number.isFinite(drawnLv)) {
          const off = Math.abs(said0 - drawnLv);
          decide("demonstration", i, `${Aid}: the reading's mark at its value on the scale`, "style", "a stated reading sits where its value is printed", { saidLevel: said0, drawnLevel: drawnLv });
          if (off > (P.d.minorLevel ?? 0.01)) {
            const cap = P.d.capacity;
            const start = Number(defs.get(Aid)?.spec?.state?.level ?? P.d.states.level?.initial);
            const moved = cap && Number.isFinite(start) ? cap.at(start) - cap.at(drawnLv) : undefined;
            const need = cap && moved !== undefined ? cap.at(said0) + moved : undefined;
            const hint = need === undefined || !Number.isFinite(need) ? "" : need > cap!.at(1) + 1e-9 ? `; even full it cannot: ${moved!.toFixed(2)} ${cap!.unit} moves out before ${tag(f.m)}${drawnLv <= 0.001 ? " and it runs empty" : ""}, so the flows before it, its scale or the reading must change` : `; start it at level ${cap!.levelOf(need).toFixed(3)} so what moves out before ${tag(f.m)} (${moved!.toFixed(2)} ${cap!.unit}) brings it to the reading${drawnLv <= 0.001 ? " (it runs empty, so this is the least it needs)" : ""}`;
            problems.push({ thing: Aid, who: "depicter", task: `depict.${Aid}`, problem: `${tag(f.m)} ${Aid} ${a.verb} "${v.value}", but its contents stand at ${P.d.read?.() ?? `level ${drawnLv.toFixed(3)}`} there (level ${drawnLv.toFixed(3)}, the reading's is ${said0.toFixed(3)})${hint}` });
            notes.push(`${tag(f.m)} ${Aid} reads "${v.value}" while its contents are drawn at ${P.d.read?.() ?? drawnLv.toFixed(3)}: the mark sits at the stated value`);
          }
        }
        A.readClose(w, String(k), P, v.value, at0 + 2, { zoom: V.n("reading.zoom", i), textPx: V.px("reading.size", i), markPx: V.px("reading.mark", i), moveFrames: V.f("reading.move", i), textAt: V.f("reading.textAt", i), textFrames: V.f("chart.fade", i), markAt: Math.round(V.f("reading.textAt", i) * 0.8), gap: V.px("reading.gap", i), em }, said0);
        decide("demonstration", i, `${Aid} reads ${v.value}${v.fromScale ? " (off its scale, at the level the plan left it)" : " (the author's value)"}`, "style", "the camera closes in on the part read and the value stands beside it");
      } else if (c.kind === "move") {
        const to = a.to ? cur.get(key(sid(a.to)!)) : undefined;
        if (!to) return void notes.push(`${tag(f.m)} ${Aid} ${a.verb} ${a.to ?? ""}: ${a.to ?? "the place"} is not on screen`);
        const frames = durMove(Math.hypot(to.st.x - itA.st.x, to.st.y - itA.st.y), k);
        w.put(key(Aid), "x", to.st.x, at0 + 2, frames, "smooth");
        w.put(key(Aid), "y", to.st.y, at0 + 2, frames, "smooth");
        decide("act", i, `${Aid} ${c.key} ${a.to}`, "author", c.def!.about);
      } else {
        if (flashes.some((x) => x.line === a.line)) return void decide("act", i, `${Aid} ${a.verb} ${a.arg ?? ""}: a bloom where each drop lands`, "style", "it flashes while something flows into it");
        // A steady change (time passing) spreads over the moment; any other change takes the style's time.
        const frames = c.def!.ease === "linear" ? Math.max(20, nextOn - at0 - V.f("flow.stopBefore", i)) : Math.round(V.f("change.time", i) * paceMul(k) * tempo);
        const r = A.actOn(w, P, a.verb, a.arg, at0 + 4, { frames, fps: FPS });
        if (!r.known) problems.push({ thing: Aid, who: "depicter", task: `depict.${Aid}`, problem: `${tag(f.m)} ${Aid} ${a.verb}${a.arg ? ` "${a.arg}"` : ""}: ${r.notes.join("; ")}` });
        else decide("act", i, `${Aid} ${c.key}${a.arg ? ` ${a.arg}` : ""} over ${(frames / FPS).toFixed(2)} s`, "author", c.def!.about);
      }
    });
    return landed;
  };
  const flowIds: string[] = [];

  for (let k = 0; k < K; k++) {
    const f = fms[k]!;
    const i = f.i;
    const md = f.md;
    const cur = laid[k]!.items;
    const prev = k ? laid[k - 1]!.items : new Map<string, Item>();
    const plan = plans[k]!;
    const t0 = onsets[k]!;
    const base = durMove(0, k) + 4;
    const dEx = Math.max(5, Math.round(V.n("motion.exitShare", i) * base));
    const exits = [...prev.keys()].filter((id) => !cur.has(id));
    const stays = [...cur.keys()].filter((id) => prev.has(id));
    const enters = [...cur.keys()].filter((id) => !prev.has(id));
    const order = laid[k]!.order;
    const revealKey = plan.slots.find((s) => s.reveal)?.id;
    const revealId = revealKey ? key(revealKey) : undefined;
    const phDip = prev.has("ph") && revealId !== undefined && cur.has(revealId) && !prev.has(revealId);
    const lead = Math.round(md.lead.value * FPS);
    let lastId: string | undefined = plan.subject ? key(plan.subject) : plan.pair ? key(plan.pair[1]) : undefined;
    if (lastId && !cur.has(lastId)) lastId = undefined;
    if (!lastId && cur.has("ph")) lastId = "ph";
    const pxOf = (id: string) => {
      const a = prev.get(id)!.st;
      const b = cur.get(id)!.st;
      return Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(a.h - b.h) + Math.abs(a.fs - b.fs) * 0.5 + Math.abs(a.z - b.z) * SHORT * 0.25;
    };
    const verChanged = (id: string) => cur.get(id)!.type === "text" && cur.get(id)!.st.ver !== prev.get(id)!.st.ver;
    const movers = stays.filter((id) => target(cur.get(id)!, k).some(([n, p, v]) => w.would(n, p, v)) && id !== lastId);
    const maxMove = Math.max(0, ...movers.map((id) => durMove(pxOf(id), k)));
    const STAG = V.f("motion.stagger", i);
    const mvOff0 = exits.length ? Math.round(dEx * 0.6) : 0;
    const enOff0 = mvOff0 + (movers.length ? Math.round(maxMove * 0.5) : 0);
    const entering = enters.filter((id) => id !== lastId && !["bar", "vbar", "strike"].includes(cur.get(id)!.type));
    entering.sort((a, b) => {
      const rk = (id: string) => (cur.get(id)!.type === "arrow" || cur.get(id)!.type === "parrow" ? 1000 : order.indexOf(id) < 0 ? 999 : order.indexOf(id));
      return rk(a) - rk(b);
    });
    // The changes fit into the lead: exits, moves and entrances start early enough that the subject lands on its word.
    const avail = lead - STAG * entering.length;
    const scale = enOff0 === 0 ? 1 : avail >= enOff0 ? 1 : Math.max(0, avail) / enOff0;
    const mvOff = Math.round(mvOff0 * scale);
    const enOff = exits.length ? Math.max(Math.round(enOff0 * scale), Math.round(dEx * 0.9)) : Math.round(enOff0 * scale);
    let subjAt = t0 + enOff + STAG * entering.length;
    const [, dipF] = V.arr("motion.placeholderDip", i);
    if (phDip) subjAt = Math.max(subjAt, t0 + Math.round(dipF! * FPS));
    const actAt = subjAt;
    const subjDur = lastId && prev.has(lastId) ? durMove(pxOf(lastId), k) : base;
    // Exits: fade and slight shrink, accelerating.
    for (const id of exits) {
      const it = prev.get(id)!;
      if (id === "ph" && phDip) {
        const [shrink] = V.arr("motion.placeholderDip", i);
        A.placeholderDip(w, id, it.st, t0, { shrink: shrink!, frames: Math.round(dipF! * FPS) });
        continue;
      }
      w.put(id, "opacity", 0, t0, dEx, "in");
      const sh = V.n("type.enterFrom", i);
      if (it.type === "text" || it.type === "ph" || it.type === "pic" || it.type === "obj") (w.put(id, "scaleX", it.st.s * sh, t0, dEx, "in"), w.put(id, "scaleY", it.st.s * sh, t0, dEx, "in"));
      else if (it.type === "many") (w.put(`${id}.dots`, "scaleX", it.st.s * sh, t0, dEx, "in"), w.put(`${id}.dots`, "scaleY", it.st.s * sh, t0, dEx, "in"));
    }
    // The camera goes back to rest while things move, unless this moment's plan keeps it.
    const restF = V.f("camera.rest", i);
    // Stays: moves and resizes; the subject's change is the last onset.
    const becomesNow: string[] = [];
    for (const id of stays) {
      const it = cur.get(id)!;
      const at = id === lastId ? subjAt : t0 + mvOff;
      const frames = durMove(pxOf(id), k);
      if (verChanged(id)) {
        becomesNow.push(id);
        const e = ent(id)!.text!;
        const [ps, pf] = V.arr("motion.pulse", i);
        const [sa, sf] = V.arr("becomes.settle", i);
        A.becomes(w, id, e, prev.get(id)!.st.ver, it.st.ver, { at, prepAt: t0 - 1, lift: V.n("becomes.lift", i) * 100, outFrames: V.f("becomes.out", i), inFrames: V.f("becomes.in", i), inDelay: 3, accent: C.key, settleColor: it.st.color, settleAfter: Math.round(sa! * FPS), settleFrames: Math.round(sf! * FPS), lineHeight: LH, pulse: { at: at + 9, size: ps!, frames: Math.round(pf! * FPS) } });
      }
      for (const [n, p, v] of target(it, k)) {
        if (n.includes(".v") && (p === "opacity" || p === "color") && verChanged(id)) continue;
        if (n.endsWith(".lab") && p === "text") {
          if (prev.get(id)!.st.label !== it.st.label) w.put(n, p, v, at + Math.round(frames / 2), 1, "step");
          continue;
        }
        w.put(n, p, v, at, frames, "smooth");
      }
      if (it.type === "many") {
        const a = prev.get(id)!.st.n;
        const b = it.st.n;
        if (a !== b) {
          const e = ent(id)!.many!;
          const n = A.countMarks(w, id, e, a, b, at, { step: Math.min(V.f("many.markStep", i), V.f("many.enter", i) / Math.abs(b - a)), frames: V.f("many.markFrames", i), hiddenScale: 0.3 });
          decide("motion", i, `${e.id} ${b > a ? "adds" : "removes"} ${n} marks one by one`, "style", "a count changes mark by mark");
        }
      }
    }
    // Entrances: decelerate, staggered; the carrier of the moment arrives last.
    const enterOne = (id: string, at: number) => {
      const it = cur.get(id)!;
      if (it.type === "pic" && isChart(pics.get(id.slice(2)))) {
        const pic = pics.get(id.slice(2)) as A.Chart;
        const seen = chartSeen.get(id) ?? new Set();
        const L = chartLook(i);
        if (realIn(k, pic.name)) {
          for (const [n, q, v] of A.chartTargets(id, it.st, pic, "photo", seen, L, C)) w.put(n, q, v, t0 - 1);
          w.put(id, "opacity", 0, t0 - 1);
          w.put(id, "opacity", 1, at, V.f("chart.fade", i), "out");
          const pr0 = fms[k]!.md.proposals.find((p) => p.value.kind === "real" && p.value.ids.some((x) => x.split(".")[0] === pic.name))!;
          decide("material", i, `${pic.name}: kept real, as the user's own picture`, pr0.from, pr0.why ?? "evidence the viewer should recognise");
          return;
        }
        const how = A.enterChart(w, id, pic, A.chartTargets(id, it.st, pic, "photo", seen, L, C), A.chartTargets(id, it.st, pic, "own", seen, L, C), { prep: t0 - 1, at, room: (onsets[k + 1] ?? FRAMES) - at, nextHas: k + 1 < K && laid[k + 1]!.items.has(id) }, {
          holdOriginal: [Math.round(V.arr("chart.holdOriginal", i)[0]! * FPS), Math.round(V.arr("chart.holdOriginal", i)[1]! * FPS)],
          settle: V.f("chart.settle", i),
          minRoomBoth: V.f("chart.minRoomBoth", i),
          minRoom: V.f("chart.minRoom", i),
          fade: V.f("chart.fade", i),
          move: V.f("chart.move", i),
          late: V.f("chart.late", i),
          lateFrames: V.f("chart.lateFrames", i),
          growStagger: V.f("chart.growStagger", i),
          grow: V.f("chart.grow", i),
        });
        decide("material", i, `${pic.name}: ${how}`, "style", "the user's own chart is recognised first, then comes to life on its own bars");
        return;
      }
      const e = ent(id);
      const born = it.born ? prev.get(it.born) ?? cur.get(it.born) : undefined;
      const reveal = it.st.reveal && (it.type === "text" || it.type === "many");
      const dur = reveal ? V.f("motion.reveal", i) : Math.max(10, base);
      for (const [n, p, v] of target(it, k)) {
        let from: Value = v;
        let frames = dur;
        let ease: Ease = "out";
        let atN = at;
        if (it.type === "text" || it.type === "ph") {
          from = A.textEntryFrom(n, p, v, id, born?.st, e!.text!, it.st.ver, { fromScale: reveal ? V.n("type.revealFrom", i) : V.n("type.enterFrom", i), lineHeight: LH });
          if (n === id && p === "opacity") frames = reveal ? 6 : 10;
          if (reveal && n === id && (p === "scaleX" || p === "scaleY")) ease = "overshoot";
        } else if (it.type === "many") {
          if (n === id && p === "opacity") (from = 0), (frames = 10);
          if (n === `${id}.dots` && (p === "scaleX" || p === "scaleY")) from = (v as number) * V.n("type.enterFrom", i);
          if (born && n === id && (p === "x" || p === "y")) from = p === "x" ? born.st.x : born.st.y;
        } else if (it.type === "kit") {
          // A computed thing fades in where it stands: growing about its group's origin would carry it across the frame.
          if (n === id && p === "opacity") (from = 0), (frames = 12);
        } else if (it.type === "obj") {
          if (n === id && p === "opacity") (from = 0), (frames = 12);
          if (n === id && (p === "scaleX" || p === "scaleY")) from = (v as number) * V.n("type.enterFrom", i);
        } else if (it.type === "pic") {
          if (n === id && p === "opacity") (from = 0), (frames = 10);
          else if (n === id && (p === "scaleX" || p === "scaleY")) from = (v as number) * V.n("type.enterFrom", i);
          else if (n === `${id}.c`) (from = p === "x" || p === "y" ? 0 : 1), (atN = at + 6), (frames = Math.max(dur, 22)), (ease = "smooth");
          else if (p === "opacity" || p === "trimEnd") (from = 0), (atN = at + 10), (frames = 14), (ease = "smooth");
        } else if (it.type === "strike" || it.type === "arrow" || it.type === "parrow") {
          if (p === "opacity") from = 1;
          if (p === "trimEnd") (from = 0), (ease = "smooth"), (frames = 14);
        } else if (it.type === "vbar") {
          if (p === "points") (from = A.columnPts(it.st, 0)), (ease = "smooth"), (frames = 20);
          if (p === "opacity") (from = 0), (frames = 6);
        } else if (it.type === "bar" || it.type === "floor") {
          if (p === "points") (from = A.barPts(it.st, 0)), (ease = "smooth"), (frames = 16);
          if (p === "opacity") (from = 0), (frames = 6);
        }
        w.put(n, p, from, t0 - 1);
        w.put(n, p, v, atN, frames, ease);
      }
      if (it.type === "many") A.enterMarks(w, id, ent(id)!.many!, it.st.n, t0 - 1, at + 4, { step: Math.min(V.f("many.markStep", i), V.f("many.enter", i) / Math.max(1, it.st.n)), frames: V.f("many.markFrames", i), hiddenScale: 0.3 });
      if (it.type === "ph") {
        const [ps, pf] = V.arr("motion.placeholderPulse", i);
        A.placeholderWait(w, id, at + 22, { size: ps!, frames: Math.round(pf! * FPS) });
      }
      if (born) decide("motion", i, `${e?.id ?? id} is born from ${it.born!.replace(/^[tp]\./, "")}`, "author", "it starts at that thing's place and size");
    };
    entering.forEach((id, j) => enterOne(id, t0 + enOff + STAG * j));
    // When a moment demonstrates and reveals words, the words wait for the landing they describe.
    const landed = scheduleActs(k, actAt, cur);
    let subjEnter = subjAt;
    if (landed > actAt && revealId && cur.get(revealId)?.type === "text" && V.get<boolean>("demo.wordsWait", i)) {
      subjEnter = landed + 4;
      decide("direction", i, `the revealed words wait ${((subjEnter - subjAt) / FPS).toFixed(1)} s for the landing`, "style", V.style["demo.wordsWait"]!.why);
    }
    if (lastId && enters.includes(lastId)) enterOne(lastId, subjEnter);
    for (const id of enters) {
      const it = cur.get(id)!;
      if (it.type === "bar") enterOne(id, subjEnter + 4);
      if (it.type === "vbar") enterOne(id, subjEnter + 2);
      if (it.type === "strike") enterOne(id, subjEnter + Math.round(base * 0.7));
    }
    for (const [id, it] of cur) {
      if (it.type !== "pic" || !isChart(pics.get(id.slice(2)))) continue;
      const pic = pics.get(id.slice(2)) as A.Chart;
      const set = chartSeen.get(id) ?? chartSeen.set(id, new Set()).get(id)!;
      for (const part of [...(it.st.lit ?? []), it.st.sub, ...(it.st.sup ?? [])]) if (part) for (const b of pic.barsOf.get(part) ?? []) set.add(b);
    }
    if (f.m.reveal && cur.get(key(sid(f.m.reveal)!))?.type === "obj") {
      const [ps, pf] = V.arr("motion.objectPulse", i);
      w.play(subjEnter + 6, key(sid(f.m.reveal)!), "pulse", { size: ps!, frames: Math.round(pf! * FPS) });
    }
    // The camera: the moment's plan (a pinned camera line wins); a reading brings it close itself.
    const tEnd = subjEnter + Math.max(subjDur, base) + 4;
    const nextOn = onsets[k + 1] ?? FRAMES;
    let cam = md.camera.value;
    let camFrom = md.camera.from;
    const pinCam = pinsOf(i).camera as (CameraPlan & { atId?: string }) | undefined;
    if (pinCam) {
      if (pinCam.atId) {
        const t = cur.get(key(pinCam.atId));
        if (t) pinCam.at = [t.st.x / W, t.st.y / H];
      }
      if (md.camera.from !== "style" && JSON.stringify(md.camera.value) !== JSON.stringify(pinCam)) notes.push(`${tag(f.m)} the pinned camera line wins over the ${md.camera.from}'s camera`);
      cam = pinCam;
      camFrom = "author";
    }
    if (f.acts.some((a) => is(a, "read"))) decide("camera", i, "close in on the reading", "style", "the reading brings the camera close");
    else {
      const window: [number, number] = cam.move === "push" || cam.move === "drift" ? [tEnd, nextOn] : [t0 + mvOff, nextOn];
      const did = A.cameraMove(w, cam, window[0], window[1], restF);
      if (did !== "hold") decide("camera", i, did, camFrom, md.camera.why ?? "");
    }
    if (becomesNow.length) decide("motion", i, `${becomesNow.map((x) => ent(x)!.id).join(", ")} changes in place`, "author", "old words lift and fade, new words rise, then a pulse");
    // Pinned sets: applied last in the moment, at its onset, so they win.
    for (const s of pinsOf(i).sets) {
      const targets = kr(s.id) && w.has(`k.${s.id}`) ? [`k.${s.id}`] : w.has(s.id) ? [s.id] : w.has(key(s.id)) ? [key(s.id)] : [];
      if (!targets.length) {
        notes.push(`line ${s.line}: set ${s.id}: no such thing on screen, kept and not applied`);
        continue;
      }
      for (const [p, v] of Object.entries(s.props)) w.put(targets[0]!, p, v, subjEnter + base, Math.max(1, base), "smooth");
      decide("pinned", i, `set ${s.id} ${Object.entries(s.props).map(([p, v]) => `${p}=${v}`).join(" ")}`, "author", "a pinned line of the scene language");
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 8. The SceneDoc, compiled, and the map from plan names to scene ids.
  // Pinned plays (`do steps demo1 from=2 to=3`): at the moment's own word, as the scene language plays a state's lines,
  // with the kit's behaviors in the compile, so a computed thing's steps land on the words that pin them.
  const pinnedPlays: { at: number; line: number; play: NonNullable<Step["play"]>[number] }[] = [];
  plan.moments.forEach((pm, i) => {
    const at = when({ word: Math.min(Math.max(0, pm.word), words.length - 1) }, kitCtx);
    for (const p of pinsOf(i).plays)
      for (const t of p.targets) {
        const target = kr(t) ? `k.${t}` : w.has(key(t)) ? key(t) : w.has(t) ? t : undefined;
        if (!target || (kr(t) && !w.has(computed.get(kr(t)!.name)!.sid))) {
          notes.push(`line ${p.line}: do ${p.behavior} ${t}: ${t} is not on screen, nothing plays`);
          continue;
        }
        pinnedPlays.push({ at, line: p.line, play: { behavior: p.behavior, target, args: p.args } });
        decide("pinned", i, `do ${p.behavior} ${t}${Object.keys(p.args).length ? ` ${Object.entries(p.args).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""} at ${(at / FPS).toFixed(2)} s`, "author", "a pinned line of the scene language, played on its moment's word");
      }
  });
  const docWith = (plays: typeof pinnedPlays): SceneDoc => {
    const d = w.doc();
    return { ...d, steps: [...d.steps, ...plays.map((p) => ({ at: p.at, play: [p.play] }))] };
  };
  // A play the kit refuses (steps out of range, played twice, a stretch too short at its pace) is the author's to repair,
  // with the kit's own words; the rest of the scene is composed without it.
  let kept = pinnedPlays;
  let doc = docWith(kept);
  let scene: Scene | undefined;
  for (let tries = 0; !scene; tries++) {
    try {
      scene = compile(doc, kitCtx);
    } catch (e) {
      if (!kept.length || tries > pinnedPlays.length) throw e;
      // The first play whose addition breaks the compile is the one refused.
      let bad = kept.length - 1;
      for (let j = 0; j < kept.length; j++) {
        try {
          compile(docWith(kept.slice(0, j + 1)), kitCtx);
        } catch (err) {
          bad = j;
          e = err;
          break;
        }
      }
      const p = kept[bad]!;
      problems.push({ thing: p.play.target.replace(/^[tpk]\./, ""), who: "author", problem: `line ${p.line}: ${(e as Error).message}` });
      notes.push(`line ${p.line}: do ${p.play.behavior} ${p.play.target.replace(/^[tpk]\./, "")} is refused, not played: ${(e as Error).message}`);
      kept = kept.filter((_, j) => j !== bad);
      doc = docWith(kept);
    }
  }
  const ids: Record<string, string[]> = {};
  const addId = (name: string, ...sids: string[]) => {
    const list = (ids[name] ??= []);
    for (const s of sids) if (w.has(s) && !list.includes(s)) list.push(s);
  };
  for (const d of defs.values()) {
    addId(d.id, key(d.id));
    if (d.obj) for (const s of w.specs.filter((x) => x.id.startsWith(`flow.${key(d.id)}.`) || x.id.startsWith(`ghost.${key(d.id)}.`))) addId(d.id, s.id);
  }
  for (const dst of new Set(flows.values())) for (const s of w.specs.filter((x) => x.id.startsWith(`bloom.${key(dst)}.`))) addId(dst, s.id);
  for (const p of pics.values()) {
    if (!w.has(key(p.name))) continue;
    addId(p.name, key(p.name));
    const parts = new Set([...p.parts.keys(), ...(isChart(p) ? Object.keys(p.data.texts ?? {}) : [])]);
    for (const part of parts) {
      const nmPart = `${p.name}.${part}`;
      if (isChart(p)) {
        const rows = (row: string) => Array.from({ length: A.CHART_LINES }, (_, j) => A.lineId(row, j));
        for (const b of p.barsOf.get(part) ?? []) addId(nmPart, `${key(p.name)}.bar${b}`, `${key(p.name)}.val${b}`, ...rows(`${key(p.name)}.lab${b}`));
        addId(nmPart, ...(p.data.texts?.[part] !== undefined ? rows(`${key(p.name)}.hd.${part}`) : [`${key(p.name)}.hd.${part}`]), `${key(p.name)}.lv.${part}`);
      } else addId(nmPart, `${key(p.name)}.c.ol.${part}`);
      if (!ids[nmPart]?.length) delete ids[nmPart];
    }
  }
  // A computed thing by its plan name, and every part of it by the kit's own part path (demo1.item.2).
  for (const c of computed.values()) {
    if (!w.has(c.sid)) continue;
    addId(c.id, c.sid);
    for (const part of c.parts) addId(`${c.id}.${part}`, `${c.sid}.${part}`);
  }
  plans.forEach((p, k) => {
    if (p.question) addId(`ask@${fms[k]!.m.word}`, `q.${k}`);
    if (w.has(`read.${k}`)) addId(`reading@${fms[k]!.m.word}`, `read.${k}`, `readmark.${k}`);
  });
  if (w.has("ph")) addId("?", "ph");
  for (const [name, list] of Object.entries(ids)) if (!list.length) delete ids[name];
  return { doc, scene, ids, notes, decisions, problems, boxes: laid.map((l, k) => ({ moment: fms[k]!.i, boxes: l.boxes })) };
}
