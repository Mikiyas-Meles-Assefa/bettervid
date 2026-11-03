// The composer: a pure function of (intent plan, design, context) to a compiled scene. It decides nothing of taste by
// itself: every size, place, opacity, duration and choice of ability comes from the Design and its MomentDesigns (which
// agents and the search vary), from Design.overrides, or from the style's suggestions (engine/design/suggest.ts). It
// writes a DecisionRecord for what it decided and notes for what it could not do.
//
// Output is a SceneDoc of group, path, text and image nodes with theme color names and roles, compiled by the engine's
// own compile(). `ids` maps every plan name (and part of the user's material) to the scene ids that draw it.
import { compile } from "../../core/compile.ts";
import { roleLook } from "../../core/roles.ts";
import type { Ease, Scene, SceneDoc, Theme, Value } from "../../core/types.ts";
import { estimate, TEXT_SIZE } from "../../language/layout.ts";
import { fontMeasure } from "../../language/measure.ts";
import { colorOf, propNodes, resolve as depict, withAlpha, type Prop } from "../depict/index.ts";
import * as A from "../abilities/index.ts";
import type { Cls, St, Triple } from "../abilities/types.ts";
import { idsOf, KNOWN_VERBS } from "../intent/parse.ts";
import { suggestMoment } from "../suggest.ts";
import type { Act, CameraPlan, DecisionRecord, Design, From, IntentPlan, Moment, MomentDesign, PartCard, Word } from "../types.ts";
import { anchorRect, overlap, pack, rh, rw, sideWidths, splitHalves, usableRect, type Rect } from "./pack.ts";
import { Values } from "./values.ts";

export type ComposeCtx = {
  theme: Theme;
  words: Word[];
  frames: number;
  cards?: PartCard[];
  /** The user's pictures by card name, as data URLs (or any URL the renderer can load). */
  assets?: Record<string, string>;
  measure?: A.Measure;
};

export type Composition = { doc: SceneDoc; scene: Scene; ids: Record<string, string[]>; notes: string[]; decisions: DecisionRecord[]; boxes: { moment: number; boxes: Record<string, [number, number, number, number]> }[] };

type Def = { id: string; text: string; many?: { n: number; unit: string }; obj?: Prop; desc?: string };
type FM = { m: Moment; i: number; md: MomentDesign; onset: number; carry: string[]; becomes: Moment["becomes"]; wrong: string[]; acts: Act[]; merged: number[] };
type Slot = { id: string; cls: Cls; wrong: boolean; reveal: boolean; born?: string; part?: string; parts?: string[] };
type PArrow = { t: string; pic: string; part: string; to: boolean };
type Plan = { slots: Slot[]; pair?: [string, string]; scaled?: boolean; partPair?: { pic: string; parts: [string, string] }; arrows: { a: string; b: string; label: string }[]; parrows: PArrow[]; subject?: string; question?: string; phFor?: string; levels: { part: string; thing: string; v: number }[] };
type Ent = { id: string; type: "text" | "many" | "ph" | "pic" | "obj"; text?: A.TextEnt; many?: A.ManyEnt };
type ItemType = "text" | "ph" | "many" | "strike" | "bar" | "arrow" | "pic" | "parrow" | "vbar" | "obj" | "floor";
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
  for (const t of plan.things) {
    if (t.kind === "object") defs.set(t.id, { id: t.id, text: t.id, obj: depict(t.desc ?? t.id), desc: t.desc });
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
      const data = { ...c.data, ymax: c.data.ymax ?? A.niceCeil(Math.max(...c.data.values)) };
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
  const canon = (id: string | undefined, where: string): string | undefined => {
    if (!id) return id;
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
      becomes: m0.becomes.filter((b) => !pics.has(b.id.split(".")[0]!) || (notes.push(`${w} the user's material cannot become something else: ignored`), false)),
    };
    if (m.word >= words.length || m.word < 0) notes.push(`@${m.word} is not a word of the narration (0 to ${words.length - 1}): moved to the nearest word`);
    return { m, i };
  });
  // Pinned lines of today's scene language: the strongest precedence. What the composer understands is applied; the rest is reported.
  const pins = moments.map(({ m, i }) => readPins(m, i));
  for (const { m } of moments) for (const id of idsOf(m)) if (!pr(id) && !defs.has(id)) (defs.set(id, { id, text: id }), notes.push(`@${m.word} "${id}" was never declared: made a thing whose text is "${id}"`));
  const sortedM = [...moments].sort((a, b) => Math.min(Math.max(a.m.word, 0), words.length - 1) - Math.min(Math.max(b.m.word, 0), words.length - 1) || a.i - b.i);
  if (sortedM.some((x, j) => x !== moments[j])) notes.push("moments were not in word order: sorted by word");
  const wordStart = (n: number) => words[Math.min(Math.max(0, n), words.length - 1)]!.start;
  const mdOf = (i: number): MomentDesign => {
    const md = design.moments.find((x) => x.moment === i);
    if (md) return md;
    notes.push(`@${plan.moments[i]!.word} has no MomentDesign: the style's suggestion is used`);
    return suggestMoment(plan, i, viewing, theme, cards);
  };
  const tag = (m: Moment) => `@${m.word}`;
  const subjectOf = (m: Moment): string | undefined => m.reveal ?? m.show ?? m.becomes[0]?.id ?? m.arrows[0]?.b ?? m.wrong[0];
  const sid = (id: string | undefined) => (id ? pr(id)?.name ?? id : id);
  const isObj = (id: string | undefined) => !!id && !!defs.get(id)?.obj;
  const pinsOf = (i: number) => pins[i]!;

  function readPins(m: Moment, i: number) {
    const out: { camera?: CameraPlan; arrangement?: string; supportOpacity?: number; sets: { id: string; props: Record<string, Value>; line: number }[]; texts: { id: string; size?: number; role?: string }[]; kept: string[] } = { sets: [], texts: [], kept: [] };
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
      } else out.kept.push(`line ${p.line}: "${p.text}" is pinned to @${m.word}, but this composer does not draw that line of the scene language yet`);
    }
    for (const k of out.kept) notes.push(k);
    if (m.pinned.length) decide("pinned", i, `${m.pinned.length} pinned line(s) of the scene language`, "author", "explicit lines win for their thing in their moment; the rest is composed around them");
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 2. Timing that follows the voice. Each moment starts `lead` before its word and holds at least `dwell`; a moment
  // too short to stand alone is merged into the next, its subject passed on as support. Demonstrations are never cut.
  const U0 = usableRect(viewing, V.px("frame.margin"));
  const U = U0.rect;
  if (U0.cuts.length) decide("frame", undefined, U0.cuts.join("; "), "director", viewing.why);
  const demoOf = (i: number, a: number) => design.demos.find((d) => d.moment === i && d.act === a);
  const speedOf = (s: "real" | "slow" | "fast" | number | undefined, k: number) => (s === undefined || s === "real" ? 1 : s === "slow" ? V.n("demo.slow", k) : s === "fast" ? V.n("demo.fast", k) : Math.max(0.01, Number(s)));
  // A fall's real time needs the drawing's scale: estimated here from the anchor box the design asks for.
  const fallFramesOf = (i: number, a: Act, box: { w: number; h: number }) => {
    const mem = a.ids.filter(isObj).map((id) => ({ id, prop: defs.get(id)!.obj! }));
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
  const demoFrames = (f: { i: number; acts: Act[]; md: MomentDesign }) => Math.max(0, ...f.acts.filter((a) => a.verb === "falls").map((a) => fallFramesOf(f.i, a, anchorBox(f.md)).played));
  const dwellOf = (f: FM) => Math.round(f.md.dwell.value * FPS) + (V.get<boolean>("demo.neverCut", f.i) ? demoFrames(f) : 0);
  const fms: FM[] = [];
  for (const { m, i } of sortedM) {
    const md = mdOf(i);
    const nominal = Math.max(1, Math.round(wordStart(m.word) * FPS) - Math.round(md.lead.value * FPS));
    const fm: FM = { m, i, md, onset: nominal, carry: [], becomes: m.becomes, wrong: m.wrong, acts: m.acts, merged: [] };
    for (;;) {
      const prev = fms.at(-1);
      if (!prev) break;
      const cand = Math.max(nominal, prev.onset + dwellOf(prev));
      const delay = cand - nominal;
      const demo = prev.acts.some((x) => x.verb === "falls") && V.get<boolean>("demo.neverCut", prev.i);
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
    }
    fms.push(fm);
  }
  const K = fms.length;
  if (!K) throw new Error("the intent has no moments");
  const onsets = fms.map((f) => Math.min(f.onset, FRAMES - 20));

  // ---------------------------------------------------------------------------------------------------------------
  // 3. Each moment: who is on screen and in what role.
  const apparatus: string[][] = [];
  for (const f of fms)
    for (const a of f.acts) {
      const g = a.verb === "flows" && a.to ? [a.ids[0]!, a.to] : a.verb === "falls" && a.ids.length > 1 ? a.ids : [];
      if (g.length > 1 && g.every(isObj) && !apparatus.some((x) => g.every((y) => x.includes(y)))) apparatus.push(g);
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
    if (!pair && !partPair && scaledProp && scaledProp.ids.length === 2) {
      pair = [canon(scaledProp.ids[0], tag(m))!, canon(scaledProp.ids[1], tag(m))!];
      decide("relation", f.i, `${pair[0]} and ${pair[1]} on one scale`, md.proposals.find((p) => p.value === scaledProp)!.from, md.proposals.find((p) => p.value === scaledProp)!.why ?? "proposed");
    }
    const scaled = !!pair && !!scaledProp && scaledProp.ids.every((x) => pair!.includes(canon(x, tag(m))!));
    const pairIsSubject = !!pair && (!subj || pair.includes(subj));
    if (q) add(`q.${k}`, "question");
    for (const x of f.carry) add(x, "support");
    for (const x of m.from.map((fr) => fr.b)) add(x, "support");
    for (const x of m.keep) add(x, "support");
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
    for (const g of apparatus) if (g.some((x) => has(x) || x === subj)) for (const x of g) if (!has(x) && x !== subj) (add(x, "support"), decide("continuity", f.i, `${x} stays as context`, "style", `it belongs to one apparatus with ${g.filter((y) => y !== x).join(", ")}`));
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
        if (a.verb === "flows" && a.to && isObj(a.ids[0]) && isObj(a.to) && !flows.has(a.ids[0]!)) (flows.set(a.ids[0]!, a.to), decide("composition", f.i, `${a.ids[0]} over ${a.to}, one apparatus`, "style", `${a.ids[0]} ${a.arg ?? "flows"} into ${a.to}: the source's tip over the vessel's mouth whenever both are on screen`));
        if (a.verb === "falls") {
          const g = a.ids.filter(isObj);
          if (g.length && !fallGroups.some((x) => g.every((y) => x.includes(y)))) (fallGroups.push(g), decide("composition", f.i, `${g.join(" and ")} fall together`, "style", `${g.length > 1 ? "side by side, bottoms level, " : ""}over a floor with room to fall`));
          g.forEach((x) => fallen.add(x));
        }
      }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 4. Entities: what is drawn, with versions (becomes "text") and counts (becomes N) over time.
  const ents = new Map<string, Ent>();
  const key = (id: string) => (pics.has(id) ? `p.${id}` : `t.${id}`);
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
        } else if (d.obj) notes.push(`${tag(f.m)} ${b.id} is an object: say what changes about it with a verb (turns, fills)`);
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
    if (d.obj) (ents.set(d.id, { id: d.id, type: "obj" }), decide("depiction", undefined, `${d.id}: ${d.obj.kind}${d.obj.shape ? ` (${d.obj.shape})` : ""}`, "material", d.obj.why));
    else if (d.many) ents.set(d.id, { id: d.id, type: "many", many: { id: d.id, unit: d.many.unit, maxN: Math.max(1, maxN.get(d.id) ?? d.many.n), n0: d.many.n } });
    else ents.set(d.id, { id: d.id, type: "text", text: A.textEnt(d.id, textsOf.get(d.id)!, (t) => linesFor(t, subjectEver.has(d.id)), em) });
  }
  for (const p of pics.values()) if (plans.some((pl) => pl.slots.some((s) => s.id === p.name))) ents.set(p.name, { id: p.name, type: "pic" });
  plans.forEach((p, k) => {
    if (p.question) ents.set(`q.${k}`, { id: `q.${k}`, type: "text", text: A.textEnt(`q.${k}`, [p.question], (t) => A.twoLines(t, em).length > 1 && em(t) * V.px("type.question") > rw(U) ? A.twoLines(t, em) : [t], em) });
    if (p.phFor) ents.set("ph", { id: "ph", type: "ph", text: A.textEnt("ph", [A.PLACEHOLDER], (t) => [t], em) });
  });
  const picParts = new Map<string, Set<string>>();
  for (const p of plans) for (const s of p.slots) if (pics.has(s.id)) for (const x of [s.part, ...(s.parts ?? [])]) if (x) (picParts.get(s.id) ?? picParts.set(s.id, new Set()).get(s.id)!).add(x);
  const chartLook = (k?: number): A.ChartLook => ({ small: MIN_FS, valueFs: MIN_FS * V.n("chart.valueScale", k), headBig: V.px("chart.headBig", k), headShare: V.n("chart.headShare", k), rowLine: V.n("chart.rowLine", k), gap: V.px("chart.gap", k), barFrac: V.n("chart.barFrac", k), photoBarFrac: V.n("chart.photoBarFrac", k), dimBars: V.n("chart.dimBars", k), dimText: V.n("chart.dimText", k), labelOpacity: V.n("chart.labelOpacity", k), levelPad: V.px("chart.levelPad", k), em });

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
    const opFor = (s: Slot, subjectLike: boolean) => (s.wrong ? V.n("wrong.opacity", f.i) : subjectLike || s.cls === "question" ? 1 : supOp);
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
    const objCls = (id: string): Partial<St> => ({ cls: slotOf.get(id)!.cls, op: slotOf.get(id)!.cls === "subject" || !plan.subject || !slotOf.has(plan.subject) ? 1 : supOp, reveal: slotOf.get(id)!.reveal });
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
      const [a, b] = plan.pair!;
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
    const stageParts = (): string[][] => {
      const used = new Set<string>();
      const groups: string[][] = [];
      for (const [src, dst] of flows) {
        if (!objIn(src) || !objIn(dst)) continue;
        const grouped = new Set([...flows.keys(), ...flows.values(), ...fallGroups.flat()]);
        const sats = plan.slots.filter((sl) => objIn(sl.id) && !grouped.has(sl.id) && !used.has(sl.id)).map((sl) => sl.id);
        groups.push(["flow", src, dst, ...sats]);
        [src, dst, ...sats].forEach((x) => used.add(x));
      }
      for (const g of fallGroups) {
        const mem = g.filter((x) => objIn(x) && !used.has(x));
        if (!mem.length) continue;
        groups.push(["fall", ...mem]);
        mem.forEach((x) => used.add(x));
      }
      for (const s of plan.slots) if ((objIn(s.id) || picIn(s.id)) && !used.has(s.id)) groups.push([objIn(s.id) ? "obj" : "pic", s.id]);
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
        if (kind === "flow") {
          const [src, dst, ...sats] = ids;
          const ap = A.apparatus({ id: src!, prop: defs.get(src!)!.obj! }, { id: dst!, prop: defs.get(dst!)!.obj! }, sats.map((id) => ({ id, prop: defs.get(id)!.obj! })), cell, { sourceShare: V.n("apparatus.sourceShare", f.i), gapShare: V.n("apparatus.gapShare", f.i), sourceWidth: V.n("apparatus.sourceWidth", f.i), vesselWidth: V.n("apparatus.vesselWidth", f.i), satelliteShare: V.n("apparatus.satelliteShare", f.i), satelliteGap: V.px("apparatus.satelliteGap", f.i) });
          for (const mm of ap.members) out.push({ id: mm.id, dx: mm.dx, dy: mm.dy - mm.h / 2, w: mm.w, h: mm.h, st: { ...objCls(mm.id), s: mm.scale } });
          (w = ap.w), (h = ap.h);
        } else if (kind === "fall") {
          const g2 = A.fallGroup(ids.map((id) => ({ id, prop: defs.get(id)!.obj! })), cell, fallenAt[k]!, fallParams(f.i));
          for (const mm of g2.members) out.push({ id: mm.id, dx: mm.dx, dy: mm.dy - mm.h / 2, w: mm.w, h: mm.h, st: { ...objCls(mm.id), s: mm.scale, len: g2.fall } });
          dec.push({ type: "floor", id: `floor.${ids.join(".")}`, dx: -g2.floorW / 2, dy: g2.floorY, len: g2.floorW, color: C.muted, op: 0.5 });
          (w = g2.w), (h = g2.h);
        } else if (kind === "obj") {
          const p = defs.get(ids[0]!)!.obj!;
          const sc = A.fitObject(p, cell);
          out.push({ id: ids[0]!, dx: 0, dy: (p.h * sc) / 2, w: p.w * sc, h: p.h * sc, st: { ...objCls(ids[0]!), s: sc } });
          (w = p.w * sc), (h = p.h * sc);
        } else {
          const s = slotOf.get(ids[0]!)!;
          const p = pics.get(s.id)!;
          if (isChart(p)) {
            const lit = plan.partPair?.pic === s.id ? plan.partPair.parts : s.part ? [s.part] : [];
            out.push({ id: s.id, dx: 0, dy: cell.h / 2, w: cell.w, h: cell.h, st: { cls: s.cls, op: 1, s: 1, z: 1, ox: 0, oy: 0, sub: s.part, sup: s.parts, lit } });
            (w = cell.w), (h = cell.h);
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
        for (const it of c.items) items.push({ ...it, dx: it.dx + sx, dy: it.dy + sy });
        for (const d of c.decor) decor.push({ ...d, dx: d.dx + sx, dy: d.dy + sy });
        off += along === "x" ? c.w : c.h;
      }
      const subject = items.some((it) => slotOf.get(it.id)?.cls === "subject");
      return { key: "stage", rank: Math.min(...items.map((it) => rank.get(it.id) ?? 0)), w: W0, h: H0, items, decor, subject, stage: true };
    };

    const groups = stageParts();
    const stageIds = new Set(groups.flatMap((g) => g.slice(1)));
    const pairIds = new Set(plan.pair ?? []);
    const arrowIds = new Set<string>();
    const arrowsUsed = plan.arrows.filter((ar) => {
      const ok = slotOf.has(ar.a) && slotOf.has(ar.b) && ar.a !== ar.b && !pairIds.has(ar.a) && !pairIds.has(ar.b) && !stageIds.has(ar.a) && !stageIds.has(ar.b) && !arrowIds.has(ar.a) && !arrowIds.has(ar.b);
      if (ok) (arrowIds.add(ar.a), arrowIds.add(ar.b));
      else if (tell) notes.push(`${tag(f.m)} arrow ${ar.a} -> ${ar.b} skipped: an end is already placed in another relation`);
      return ok;
    });
    const loose = plan.slots.filter((s) => !stageIds.has(s.id) && !pairIds.has(s.id) && !arrowIds.has(s.id));
    // The anchor: the stage when one is on screen, else the block that holds the subject, else the question.
    const anchorKind = groups.length ? "stage" : plan.pair && (pairIds.has(plan.subject ?? "") || !plan.subject) ? "pair" : plan.subject && arrowIds.has(plan.subject) ? "arrow" : plan.subject && loose.some((s) => s.id === plan.subject) ? "single" : plan.question ? "question" : loose.length ? "first" : "none";
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
      if (plan.pair && anchorKind !== "pair") {
        const r = Math.min(rank.get(plan.pair[0]) ?? 0, rank.get(plan.pair[1]) ?? 0);
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
          const type: ItemType = e.type === "many" ? "many" : e.type === "ph" ? "ph" : e.type === "pic" ? "pic" : e.type === "obj" ? "obj" : "text";
          // Objects are placed by their base.
          const st: St = { ...blank(), ...p.st, x: cx + p.dx, y: r.y0 + p.dy + (type === "obj" ? p.h / 2 : 0), w: p.w, h: p.h } as St;
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
      const bx = isChart(pic) ? A.chartPartBox(pi.st, pic, pa.part, L) : pic.parts.has(pa.part) ? A.partOnScreen(pi.st, pic, pa.part) : undefined;
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
    if (isChart(pic)) A.chartNodes(w, key(id), pic, { subject: C.subject, muted: C.muted, pointer: C.pointer, small: MIN_FS, valueFs: MIN_FS * V.n("chart.valueScale"), baseWidth: markW * 0.5, levelWidth: V.px("level.width") });
    else A.pictureNodes(w, key(id), pic, picParts.get(id) ?? [], { pointer: C.pointer, pad: 6, radius: 14 });
  }
  for (const [id, e] of ents) {
    if (e.type === "pic") continue;
    const nid = id === "ph" ? "ph" : id.startsWith("q.") || id.startsWith("lab.") ? id : key(id);
    if (!used.has(nid)) continue;
    if (e.type === "many") A.manyNodes(w, nid, e.many!, { fill: C.key, labelColor: C.muted, labelFs: V.px("type.label") });
    else if (e.type === "obj") {
      w.node(nid, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: W / 2, y: H / 2 });
      propNodes(nid, defs.get(id)!.obj!, (cid, kind, props, parent) => w.node(cid, kind, props as Record<string, Value>, parent), C.subject, "paper", 60);
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
  for (const [src, dst] of flows) A.flowNodes(w, key(src), key(dst), { pool: V.n("flow.pool"), dropFill: withAlpha("#9fd3e6", 0.95), dropStroke: C.subject, bloomFill: "#e8559a" });
  for (const g of fallGroups) A.fallNodes(w, g.map((id) => ({ id: key(id), fill: defs.get(id)!.obj!.body?.fill ?? C.subject })), V.n("fall.trail"), g.length > 1 ? { id: `level.${g.join(".")}`, color: C.pointer, width: V.px("level.width"), dash: dashPx } : undefined);
  fms.forEach((f, k) => {
    for (const a of f.acts) {
      if (a.verb === "reads") A.readingNodes(w, String(k), C.pointer);
      if (a.verb === "runs") w.node(`run.${k}`, "text", { text: a.arg ?? "", size: 100, role: "heading", color: C.pointer, opacity: 0 });
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 7. Transitions: staged exits, moves, entrances; then what objects do; then the camera.
  const paceMul = (k: number) => (fms[k]!.m.pace === "slow" ? V.n("pace.slow", fms[k]!.i) : fms[k]!.m.pace === "fast" ? V.n("pace.fast", fms[k]!.i) : 1);
  const [mvMin, mvPer, mvMax] = V.arr("motion.move");
  const durMove = (px: number, k: number) => Math.max(1, Math.round(Math.min(mvMax!, mvMin! + mvPer! * Math.sqrt(Math.max(0, px) / SHORT)) * FPS * paceMul(k) * tempo));
  const ent = (id: string): Ent | undefined => (id === "ph" ? ents.get("ph") : id.startsWith("q.") || id.startsWith("lab.") ? ents.get(id) : id.startsWith("t.") || id.startsWith("p.") ? ents.get(id.slice(2)) : undefined);
  const chartSeen = new Map<string, Set<number>>();
  const target = (it: Item, k: number): Triple[] => {
    const { id, st } = it;
    if (it.type === "text" || it.type === "ph") return A.textTargets(id, ent(id)!.text!, st);
    if (it.type === "many") return A.manyTargets(id, st);
    if (it.type === "obj") return [[id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op]];
    if (it.type === "pic") {
      const pic = pics.get(id.slice(2))!;
      if (isChart(pic)) return A.chartTargets(id, st, pic, "own", chartSeen.get(id) ?? new Set(), chartLook(fms[k]!.i), C);
      return A.pictureTargets(id, st, picParts.get(pic.name) ?? [], { dim: V.n("picture.dim", fms[k]!.i), supportOutline: V.n("picture.supportOutline", fms[k]!.i), outlineWidth: markW });
    }
    if (it.type === "parrow") return A.pointerTargets(id, st);
    if (it.type === "strike") return A.strikeTargets(id, st);
    if (it.type === "vbar") return A.columnTargets(id, st);
    if (it.type === "bar" || it.type === "floor") return A.barTargets(id, st);
    return A.arrowTargets(id, st);
  };
  const objState = new Map<string, { level: number; color?: string }>();
  for (const d of defs.values()) if (d.obj) objState.set(d.id, { level: d.obj.level, color: d.obj.liquid });
  const visibleIn = (k: number, id: string) => plans[k]!.slots.some((sl) => sl.id === id);
  const flashes: { dst: string; color: string; from: number; to: number }[] = [];
  fms.forEach((f, k) => {
    for (const a of f.acts) {
      if (a.verb !== "flashes") continue;
      const c = colorOf(a.arg ?? "");
      if (!c) {
        notes.push(`${tag(f.m)} ${a.ids[0]} flashes "${a.arg ?? ""}": no color in it, nothing blooms`);
        continue;
      }
      let to = FRAMES;
      for (let m = k + 1; m < K; m++) if (fms[m]!.acts.some((b) => b.verb === "turns" && b.ids.includes(a.ids[0]!))) (to = onsets[m]!), (m = K);
      flashes.push({ dst: a.ids[0]!, color: c.hex, from: onsets[k]!, to });
    }
  });
  const flashAt = (dst: string, t: number) => flashes.find((x) => x.dst === dst && t >= x.from && t < x.to)?.color;
  const poolAt = new Map<string, number>();
  const nextOf = (name: string) => {
    const j = poolAt.get(name) ?? 0;
    poolAt.set(name, j + 1);
    return `${name}.${j % V.n("flow.pool")}`;
  };

  const scheduleActs = (k: number, at0: number, cur: Map<string, Item>): number => {
    const f = fms[k]!;
    const i = f.i;
    const nextOn = onsets[k + 1] ?? FRAMES;
    let landed = at0;
    f.acts.forEach((a) => {
      const Aid = a.ids[0]!;
      const itA = cur.get(key(Aid));
      const pa = defs.get(Aid)?.obj;
      if (!KNOWN_VERBS.includes(a.verb)) {
        notes.push(`${tag(f.m)} "${a.verb}" has no ability yet: nothing moves (kept in the plan for an agent)`);
        decide("act", i, `${a.verb} not drawn`, "author", "a verb the engine does not know");
        return;
      }
      if (!itA || !pa) return void notes.push(`${tag(f.m)} "${Aid}" ${a.verb}: it is not an object on screen, so nothing moves`);
      const st = objState.get(Aid)!;
      // The act's own moment in the plan (a merged moment carries acts of the moments merged into it).
      const origin = plan.moments.findIndex((pm) => pm.acts.some((x) => x.line === a.line));
      const demo = origin >= 0 ? demoOf(origin, plan.moments[origin]!.acts.findIndex((x) => x.line === a.line)) : undefined;
      if (a.verb === "flows") {
        const B = a.to!;
        const itB = cur.get(key(B));
        const pb = defs.get(B)?.obj;
        if (!itB || !pb) return;
        let end = FRAMES - 6;
        for (let m = k + 1; m < K; m++) {
          const stop = fms[m]!.acts.some((b) => (b.verb === "flows" && b.ids[0] === Aid) || (b.verb === "turns" && b.ids.includes(B))) || !visibleIn(m, Aid) || !visibleIn(m, B);
          if (stop) (end = onsets[m]!), (m = K);
        }
        end = Math.max(at0 + 20, end - V.f("flow.stopBefore", i));
        const sp = demo?.speed.value;
        const drops = sp === "slow" || (sp === undefined && (a.speed === "slow" || (!a.speed && f.m.pace === "slow")));
        const mul = typeof sp === "number" ? Math.max(0.05, sp) : 1;
        const size = V.arr("flow.size", i).map((x) => x * SHORT);
        const res = A.playFlow(w, { node: key(Aid), prop: pa, st: itA.st }, { node: key(B), prop: pb, st: itB.st }, { a: st.level, b: objState.get(B)!.level }, at0, end, {
          mode: drops ? "drops" : "stream",
          every: Math.max(1, Math.round((drops ? V.f("flow.dropsEvery", i) : V.f("flow.streamEvery", i)) / mul)),
          fallFrames: Math.max(1, Math.round((drops ? V.f("flow.dropsFall", i) : V.f("flow.streamFall", i)) / mul)),
          hang: Math.round(V.f("flow.hang", i) / mul),
          size: { start: size[0]!, hang: size[1]!, fall: size[2]! },
          volume: { perDrop: V.n("flow.perDrop", i), perSecond: V.n("flow.perSecond", i) * mul },
          drainShare: V.n("flow.drainShare", i),
          fill: { perDrop: V.arr("flow.fill", i)[0]!, whole: V.arr("flow.fill", i)[1]!, max: V.arr("flow.fill", i)[2]! },
          bloom: { size: [V.arr("flow.bloom", i)[0]!, V.arr("flow.bloom", i)[1]! * SHORT], grow: V.f("flow.bloomGrow", i), fade: Math.round(V.arr("flow.bloomFade", i)[drops ? 0 : 1]! * FPS), spread: V.n("flow.bloomSpread", i) },
          fps: FPS,
        }, { drop: () => nextOf(`drop.${key(Aid)}`), bloom: () => nextOf(`bloom.${key(B)}`) }, (t) => flashAt(B, t));
        st.level = res.levelA;
        objState.get(B)!.level = res.levelB;
        decide("demonstration", i, `${Aid} ${a.arg ?? "flows"} into ${B}: ${drops ? "one drop at a time" : "a stream"}, ${res.n} drops until ${(end / FPS).toFixed(1)} s${res.volume !== undefined ? `, ${res.volume.toFixed(2)} mL` : ""}`, demo?.speed.from ?? "style", demo?.speed.why ?? "as the author paced it");
      } else if (a.verb === "flashes") {
        if (![...flows.values()].includes(Aid)) notes.push(`${tag(f.m)} ${Aid} flashes, but nothing lands in it: the flash shows only where drops land`);
      } else if (a.verb === "turns") {
        const c = colorOf(a.arg ?? "");
        if (!c) {
          notes.push(`${tag(f.m)} ${Aid} turns "${a.arg}": no color in it, so it only pulses`);
          const [ps, pf] = V.arr("motion.pulse", i);
          w.play(at0 + 4, key(Aid), "pulse", { size: ps!, frames: Math.round(pf! * FPS) });
          return;
        }
        const col = withAlpha(c.hex, c.alpha);
        A.turns(w, key(Aid), pa, col, at0 + 4, Math.round(V.f("turns.time", i) * paceMul(k) * tempo));
        st.color = col;
      } else if (a.verb === "fills") {
        const pct = Number(/(\d+(?:\.\d+)?)/.exec(a.arg ?? "")?.[1] ?? NaN) / 100;
        if (!Number.isFinite(pct)) return void notes.push(`${tag(f.m)} ${Aid} fills "${a.arg ?? ""}": no level in it`);
        A.fills(w, key(Aid), pa, pct, at0 + 4, durMove(SHORT * 0.3, k));
        st.level = pct;
      } else if (a.verb === "sways") {
        A.sways(w, key(Aid), a.arg ?? "rocks", at0 + 2, { degrees: V.n("sways.degrees", i), swings: V.n("sways.swings", i), frames: V.f("sways.swing", i), decay: V.n("sways.decay", i), spinFrames: V.f("sways.spin", i) });
      } else if (a.verb === "moves" && a.to) {
        const to = cur.get(key(sid(a.to)!));
        if (!to) return void notes.push(`${tag(f.m)} ${Aid} moves to ${a.to}: ${a.to} is not on screen`);
        A.movesTo(w, key(Aid), { x: to.st.x, y: to.st.y }, at0 + 2, durMove(Math.hypot(to.st.x - itA.st.x, to.st.y - itA.st.y), k));
      } else if (a.verb === "falls") {
        const mem = a.ids.filter((x) => cur.has(key(x)) && isObj(x));
        const its = mem.map((id) => cur.get(key(id))!);
        if (!its.length) return;
        // Physical time from the drawing's scale: the fall in px over px per metre, or the style's height when no scale is known.
        const sized = mem.findIndex((id) => defs.get(id)!.obj!.body?.size);
        const pxPerM = sized >= 0 ? its[sized]!.st.w / (defs.get(mem[sized]!)!.obj!.body!.size / 100) : undefined;
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
      } else if (a.verb === "reads") {
        const r = A.readingOf(pa, st.level, a.arg);
        for (let ml = 0; ml <= 50; ml += 10) w.put(`${key(Aid)}.num${ml}`, "opacity", 0.9, at0 + 14, 12, "out");
        A.readClose(w, String(k), key(Aid), pa, itA.st, st.level, r.value, at0 + 2, { zoom: V.n("reading.zoom", i), textPx: V.px("reading.size", i), markPx: V.px("reading.mark", i), moveFrames: V.f("reading.move", i), textAt: V.f("reading.textAt", i), textFrames: V.f("chart.fade", i), markAt: Math.round(V.f("reading.textAt", i) * 0.8), gap: V.px("reading.gap", i), em });
        decide("demonstration", i, `${Aid} reads ${r.value}${r.offScale ? " (off the drawn scale, which the flow really emptied)" : ""}`, "style", "the camera closes in on the surface and the value stands beside it");
      } else if (a.verb === "runs") {
        const secs = Number(/(\d+(?:\.\d+)?)/.exec(a.arg ?? "")?.[1] ?? NaN);
        A.runs(w, key(Aid), `run.${k}`, itA.st, Number.isFinite(secs) ? secs : (nextOn - at0) / FPS, at0 + 6, Math.max(20, nextOn - at0 - 12), { fs: V.px("runs.size", i), until: nextOn, fade: V.f("chart.lateFrames", i), text: a.arg ?? "" });
      }
    });
    return landed;
  };

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
    if (f.acts.some((a) => a.verb === "reads")) decide("camera", i, "close in on the reading", "style", "the reading brings the camera close");
    else {
      const window: [number, number] = cam.move === "push" || cam.move === "drift" ? [tEnd, nextOn] : [t0 + mvOff, nextOn];
      const did = A.cameraMove(w, cam, window[0], window[1], restF);
      if (did !== "hold") decide("camera", i, did, camFrom, md.camera.why ?? "");
    }
    if (becomesNow.length) decide("motion", i, `${becomesNow.map((x) => ent(x)!.id).join(", ")} changes in place`, "author", "old words lift and fade, new words rise, then a pulse");
    // Pinned sets: applied last in the moment, at its onset, so they win.
    for (const s of pinsOf(i).sets) {
      const targets = w.has(s.id) ? [s.id] : w.has(key(s.id)) ? [key(s.id)] : [];
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
  const doc = w.doc();
  const scene = compile(doc, { fps: FPS, width: W, height: H, frames: FRAMES, theme, words });
  const ids: Record<string, string[]> = {};
  const addId = (name: string, ...sids: string[]) => {
    const list = (ids[name] ??= []);
    for (const s of sids) if (w.has(s) && !list.includes(s)) list.push(s);
  };
  for (const d of defs.values()) {
    addId(d.id, key(d.id));
    if (d.obj) for (const s of w.specs.filter((x) => x.id.startsWith(`drop.${key(d.id)}.`) || x.id.startsWith(`ghost.${key(d.id)}.`))) addId(d.id, s.id);
  }
  for (const [src, dst] of flows) for (const s of w.specs.filter((x) => x.id.startsWith(`bloom.${key(dst)}.`))) addId(dst, s.id);
  for (const p of pics.values()) {
    if (!w.has(key(p.name))) continue;
    addId(p.name, key(p.name));
    const parts = new Set([...p.parts.keys(), ...(isChart(p) ? Object.keys(p.data.texts ?? {}) : [])]);
    for (const part of parts) {
      const nmPart = `${p.name}.${part}`;
      if (isChart(p)) {
        for (const b of p.barsOf.get(part) ?? []) addId(nmPart, `${key(p.name)}.bar${b}`, `${key(p.name)}.val${b}`, `${key(p.name)}.lab${b}`);
        addId(nmPart, `${key(p.name)}.hd.${part}`, `${key(p.name)}.lv.${part}`);
      } else addId(nmPart, `${key(p.name)}.c.ol.${part}`);
      if (!ids[nmPart]?.length) delete ids[nmPart];
    }
  }
  plans.forEach((p, k) => {
    if (p.question) addId(`ask@${fms[k]!.m.word}`, `q.${k}`);
    if (w.has(`read.${k}`)) addId(`reading@${fms[k]!.m.word}`, `read.${k}`, `readmark.${k}`);
  });
  if (w.has("ph")) addId("?", "ph");
  for (const [name, list] of Object.entries(ids)) if (!list.length) delete ids[name];
  return { doc, scene, ids, notes, decisions, boxes: laid.map((l, k) => ({ moment: fms[k]!.i, boxes: l.boxes })) };
}
