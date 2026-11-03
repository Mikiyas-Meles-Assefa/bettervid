// Calibration (a development script, not part of the engine): checks each instrument against the bench's viewers where
// they overlap, on the committed scenes and watcher answers of a bench run. Instruments that disagree with every
// viewer are wrong; this prints the agreement so it can be read, and the bench's old and new scores side by side.
//
// Usage (after `npm run -s bench -- prepare <work run>` and copying each case's scene.txt and map.json, or a
// composed.scene.json, into bench/work/<work run>/<case>/):
//   node --experimental-strip-types engine/design/instruments/calibrate.ts <work run> <results run> [out.json]
// Viewer text is matched with plain patterns here only to sort viewer answers into complaints; nothing in an
// instrument reads them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../../language/build.ts";
import type { Scene } from "../../core/types.ts";
import { caseProject, loadCase, picturesOf } from "../../../bench/lib/case.ts";
import { measureCase } from "../../../bench/lib/measure.ts";
import { settingsOf } from "../../../bench/lib/settings.ts";
import { folderOf, RESULTS } from "../../../bench/lib/paths.ts";
import { cleanMap, members, sample, spans, type Mapped } from "../../../pipeline/lib/direction-check.ts";
import { kitKinds, sceneBuildOptions } from "../../../pipeline/stages/scene.ts";
import type { MeasureInput, Viewing } from "../types.ts";
import { instruments, sampled, settingsFor } from "./index.ts";
import { salienceAt } from "./salience.ts";
import { streamGroups } from "./load.ts";

const [workRun, resultsRun, outFile] = process.argv.slice(2);
// The viewers saw every clip the same way (sheets of 270 by 480 px frames), whatever the case's audience; to compare
// with them, measure as they saw (VIEWER=1). Without it, the case's own viewing is used.
const VIEWER = !!process.env.VIEWER;
if (!workRun || !resultsRun) throw new Error("usage: calibrate.ts <work run> <results run> [out.json]");
const SCENES = join(RESULTS, resultsRun, "scenes");
const json = <T,>(f: string): T => JSON.parse(readFileSync(f, "utf8"));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// Old bench code, for the stability table, when a copy sits beside the new one.
const OLD = join(import.meta.dirname, "../../../bench/lib/measure-old.tmp.ts");
const old = existsSync(OLD) ? ((await import(OLD)) as typeof import("../../../bench/lib/measure.ts")) : undefined;

// Spearman rank correlation and the AUC (chance a flagged case scores higher than an unflagged one).
const ranks = (xs: number[]) => {
  const o = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < o.length; ) {
    let j = i;
    while (j + 1 < o.length && o[j + 1]!.x === o[i]!.x) j++;
    for (let k = i; k <= j; k++) r[o[k]!.i] = (i + j) / 2;
    i = j + 1;
  }
  return r;
};
function spearman(a: number[], b: number[]): number {
  const keep = a.map((x, i) => [x, b[i]!] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (keep.length < 3) return NaN;
  const [ra, rb] = [ranks(keep.map((k) => k[0])), ranks(keep.map((k) => k[1]))];
  const [ma, mb] = [mean(ra), mean(rb)];
  const cov = ra.reduce((s, x, i) => s + (x - ma) * (rb[i]! - mb), 0);
  const va = Math.sqrt(ra.reduce((s, x) => s + (x - ma) ** 2, 0));
  const vb = Math.sqrt(rb.reduce((s, x) => s + (x - mb) ** 2, 0));
  return va && vb ? cov / (va * vb) : NaN;
}
function auc(scores: number[], flags: boolean[]): number {
  const pos = scores.filter((_, i) => flags[i]);
  const neg = scores.filter((_, i) => !flags[i]);
  if (!pos.length || !neg.length) return NaN;
  let w = 0;
  for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

// Viewer complaints, sorted by plain patterns.
const SMALL = /\b(tiny|too small|small (\w+ )?(text|type|label|labels|words|letters|font|print|line|lines|tag|tags|caps)|unreadable at|illegible|squint|barely (legible|readable)|px)\b/i;
const FAINT = /\b(faint|low contrast|washed|hard to see|barely visible|dim(med)?\b|pale)\b/i;
const EMPTY = /\b(empty|unused|blank|wasted|dead space|lower half|bottom half|upper half|top half|half (of )?the frame|negative space|lot of space|mostly black|mostly dark)\b/i;
const MISS = /\b(easy to miss|missed|miss it|did not see|didn't see|too (quick|brief|fast) to (see|read|notice)|blink|hard to notice|barely notice|unnoticed|subtle)\b/i;
const OVER = /\b(too (much|many|fast|busy)|at once|crowded|cluttered|hard to (track|follow)|overwhelm|chaotic|so many|lots of (things|movement)|everything (moves|changes)|busy)\b/i;

type Follow = { sheet: number; looking: string; waiting?: string; confusing?: string };
type Designer = { composition: number; type: number; overall: number; issues: string[] };
type Scroll = { sheets: { sheet: number; watching: boolean; noticed: string }[] };

const STOP = new Set("the and with for from into onto that this then them they its it's are was were has have had but not one two all any each over under above below some same still static only just very more most moving appears appear appearing".split(" "));
const words = (t: string) => t.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/(ing|ed|es|s)$/u, "")).filter((w) => w.length >= 3 && !STOP.has(w));

async function sceneOf(id: string): Promise<{ scene?: Scene; source: string; p: ReturnType<typeof caseProject> }> {
  const folder = folderOf(workRun!, id);
  const p = caseProject(loadCase(id));
  const composed = join(folder, "composed.scene.json");
  if (existsSync(composed)) return { scene: json<Scene>(composed), source: "", p };
  const file = join(folder, "scene.txt");
  if (!existsSync(file)) return { source: "", p };
  const source = readFileSync(file, "utf8");
  const r = await build(source, sceneBuildOptions(p, Object.fromEntries(picturesOf(p).map((x) => [x.name, x.src]))));
  return { scene: r.scene, source, p };
}

const cases = (await import("node:fs")).readdirSync(join(folderOf(workRun, "")))
  .filter((id) => existsSync(join(SCENES, `${id}.follow.json`)) || existsSync(join(SCENES, `${id}.designer.json`)))
  .sort();

const rows: Record<string, unknown>[] = [];
type Variant = Partial<Omit<import("./salience.ts").SalienceSettings, "kinds">> & { kinds?: Partial<import("./salience.ts").SalienceSettings["kinds"]> };
const VARIANTS: Variant[] = [
  {}, { onset: 0, motion: 0 }, { onset: 2, onsetFade: 0.6, onsetSize: 1 }, { onsetSize: 1 }, { onsetSize: 0 }, { onset: 3 }, { onset: 10 }, { kinds: { text: 1 } }, { center: 0 }, { size: 1, contrast: 0 },
];
const sweep: number[][] = [];
const sheets: { id: string; sheet: number; share: number; topHit: number; chance: number; mentioned: number; load: number; newN: number; pull: number; over: boolean; confused: boolean; missed: number; missFlag: boolean; top?: string; said: string; named: string[] }[] = [];
const designed: { id: string; sheet: number; small: boolean; empty: boolean; shareBelow: number; minAngle: number; chars: number; filled: number; emptyBand: number }[] = [];
const stability: { id: string; old?: Record<string, number>; now: Record<string, number> }[] = [];
let ms = 0;
let calls = 0;
for (const id of cases) {
  const { scene, source, p } = await sceneOf(id);
  if (!scene) {
    console.log(`${id}: no scene`);
    continue;
  }
  const c = loadCase(id);
  const set = settingsOf(c);
  const theme = sceneBuildOptions(p).ctx.theme;
  const mapFile = join(folderOf(workRun, id), "map.json");
  const raw = existsSync(mapFile) ? json<Mapped>(mapFile) : undefined;
  const now = measureCase(p, scene, source, theme, raw, set);
  const before = old?.measureCase(p, scene, source, theme, raw, set as never);
  stability.push({ id, old: before?.scores as Record<string, number> | undefined, now: now.scores as Record<string, number> });

  // The viewing the case's settings describe: the bench scales its read sizes with how wide the frame looks, so the
  // same scale gives the distance (65 mm wide at 400 mm is the phone default).
  const viewing: Viewing = {
    width: scene.width, height: scene.height, fps: scene.fps, screen: set.context.screen, frameWidthMm: 65, distanceMm: VIEWER ? 400 : 400 * (set.read.comfortable / 0.07), watch: set.context.attention,
    uiZones: [{ box: [0, 0, 1, 0.047], what: "top bar" }, { box: [0, 0.812, 1, 1], what: "captions" }], captions: { show: true, why: "the bench clips carry captions" }, why: set.context.why,
  };
  const s = sampled(scene);
  const ds = sample(scene);
  const ids = raw ? cleanMap(raw, ds, members(source, kitKinds())) : undefined;
  const list = spans(p.direction!, p.narration!.words, scene.fps, scene.frames);
  const lookAt = (f: number) => (ids?.events[list.find((x) => f >= x.from && f < x.to)?.event.id ?? ""]?.look ?? []);
  const base: MeasureInput = { scene, words: p.narration!.words, viewing };
  const sal = settingsFor("salience", base);
  const ld = settingsFor("load", base);
  const groups = streamGroups(s, sal.streams);

  // Whole clip.
  const t0 = performance.now();
  const whole = Object.fromEntries(["legibility", "fill", "load", "steadiness", "visibility"].map((n) => [n, instruments[n]!.measure(base, settingsFor(n, base)).values]));
  ms += performance.now() - t0;
  calls++;

  // Per follow sheet (2 s windows).
  const follow = existsSync(join(SCENES, `${id}.follow.json`)) ? json<Follow[]>(join(SCENES, `${id}.follow.json`)) : [];
  const shares: number[] = [];
  for (const fsh of follow) {
    const w: [number, number] = [Math.round((fsh.sheet - 1) * 2 * scene.fps), Math.min(scene.frames, Math.round(fsh.sheet * 2 * scene.fps))];
    if (w[1] <= w[0]) continue;
    const mid = Math.round((w[0] + w[1]) / 2);
    const look = lookAt(mid);
    const input: MeasureInput = { ...base, window: w, ids: look.length ? { look } : undefined };
    const r = instruments.salience!.measure(input, sal);
    const share = look.length ? r.values["share.look"]! : NaN;
    if (look.length) shares.push(share);
    // Which things the viewer names: words shared with a thing's text or id.
    const said = new Set(words(fsh.looking));
    const named = s.units.map((u, i) => ({ i, hit: [...new Set([...words(s.texts[i] ?? ""), ...words(u)])].some((k) => said.has(k)) }));
    const frames = r.series!.map((x) => x.frame);
    const tally = new Map<number, number>();
    for (const f of frames) {
      const sh = salienceAt(s, f, sal);
      for (const x of sh) tally.set(x.unit, (tally.get(x.unit) ?? 0) + x.share);
    }
    const top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mentioned = named.filter((x) => x.hit).map((x) => groups.rep[x.i]!);
    // A sweep over the salience weights (SWEEP=1), to read which cues the viewers follow.
    if (process.env.SWEEP && mentioned.length) {
      for (const [k, variant] of VARIANTS.entries()) {
        const v = { ...sal, ...variant, kinds: { ...sal.kinds, ...(variant.kinds ?? {}) } };
        const t = new Map<number, number>();
        for (const f of frames) for (const x of salienceAt(s, f, v)) t.set(x.unit, (t.get(x.unit) ?? 0) + x.share);
        const best = [...t].sort((a, b) => b[1] - a[1])[0]?.[0];
        (sweep[k] ??= []).push(best !== undefined && mentioned.includes(best) ? 1 : 0);
      }
    }
    const visible = [...tally.keys()];
    const topHit = top !== undefined && mentioned.includes(top) ? 1 : 0;
    const chance = visible.length ? visible.filter((v) => mentioned.includes(v)).length / visible.length : 0;
    const lr = instruments.load!.measure(input, ld);
    const newN = lr.series!.reduce((t, x) => t + x.values.new!, 0) / Math.max(1, lr.series!.length);
    const pull = lr.values.meanPull!;
    const ep = instruments.eyePath!.measure(input, settingsFor("eyePath", input)).values;
    sheets.push({ id, sheet: fsh.sheet, share, topHit, chance, mentioned: mentioned.length, load: newN + pull, newN, pull, over: OVER.test(fsh.confusing ?? ""), confused: !!(fsh.confusing ?? "").trim(), missed: ep.missed!, missFlag: MISS.test(`${fsh.confusing ?? ""} ${fsh.looking}`), top: top === undefined ? undefined : s.units[top], said: fsh.looking, named: [...new Set(mentioned)].map((u) => s.units[u]!) });
  }

  const designer = existsSync(join(SCENES, `${id}.designer.json`)) ? json<Designer>(join(SCENES, `${id}.designer.json`)) : undefined;
  // Per designer sheet: complaints about small text or an empty frame, by the sheets each issue names. Issues about the
  // captions are left out: the bench clip draws its captions over the scene, so no scene instrument sees them.
  if (designer) {
    const n = Math.ceil(scene.frames / scene.fps / 2);
    const flags = Array.from({ length: n }, () => ({ small: false, empty: false }));
    for (const issue of designer.issues) {
      if (/caption/i.test(issue)) continue;
      const m = /sheets?\s*(\d+)(?:\s*(?:-|to|and)\s*(\d+))?/i.exec(issue);
      if (!m) continue;
      const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
      if (b - a > 3) continue; // a complaint about the whole clip names no sheet
      for (let k = a; k <= Math.min(n, b); k++) {
        if (SMALL.test(issue)) flags[k - 1]!.small = true;
        if (EMPTY.test(issue)) flags[k - 1]!.empty = true;
      }
    }
    for (let k = 0; k < n; k++) {
      const w: [number, number] = [Math.round(k * 2 * scene.fps), Math.min(scene.frames, Math.round((k + 1) * 2 * scene.fps))];
      const input: MeasureInput = { ...base, window: w };
      const lg = instruments.legibility!.measure(input, settingsFor("legibility", input, process.env.READABLE ? { readable: Number(process.env.READABLE) } : undefined)).values;
      const fl = instruments.fill!.measure(input, settingsFor("fill", input, { settled: false })).values;
      designed.push({ id, sheet: k + 1, small: flags[k]!.small, empty: flags[k]!.empty, shareBelow: lg.shareBelow!, minAngle: lg.chars ? lg.minAngle! : Infinity, chars: lg.chars!, filled: fl.filled!, emptyBand: fl.emptyBand! });
    }
  }
  const scroll = existsSync(join(SCENES, `${id}.scroll.json`)) ? json<Scroll>(join(SCENES, `${id}.scroll.json`)) : undefined;
  const text = [...(designer?.issues ?? []), ...(scroll?.sheets ?? []).map((x) => x.noticed)].join(" | ");
  rows.push({
    id,
    lookShare: mean(shares),
    eye: now.scores.eye,
    legibility: whole.legibility,
    fill: whole.fill,
    load: whole.load,
    oldLoad: before?.raw.load,
    steadiness: whole.steadiness,
    visibility: whole.visibility,
    designer: designer && { composition: designer.composition, type: designer.type },
    small: SMALL.test(text),
    faint: FAINT.test(text),
    empty: EMPTY.test(designer?.issues.join(" ") ?? ""),
    overloadSheets: follow.filter((x) => OVER.test(x.confusing ?? "")).length,
  });
  console.log(`${id}: ${s.units.length} things, look share ${mean(shares).toFixed(2)}, load peakNew ${whole.load.peakNew} (bench new ${(now.raw.load as { peakNew: number }).peakNew}${before ? `, old ${(before.raw.load as { peakNew: number }).peakNew}` : ""}), streams ${whole.load.streams}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables.
const summary = json<{ cases: { id: string; follow?: { onLook: number; confused: number }; designer?: { composition: number } }[] }>(join(RESULTS, resultsRun, "summary.json")).cases;
const byId = new Map(summary.map((x) => [x.id, x]));
const R = rows as { id: string; lookShare: number; eye?: number; legibility: Record<string, number>; fill: Record<string, number>; load: Record<string, number>; designer?: { composition: number; type: number }; small: boolean; faint: boolean; empty: boolean; overloadSheets: number }[];
const onLook = R.map((r) => byId.get(r.id)?.follow?.onLook ?? NaN);
const confused = R.map((r) => byId.get(r.id)?.follow?.confused ?? NaN);
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
const withMention = sheets.filter((x) => x.mentioned > 0);
console.log("\n| check | viewers | instrument value | n | agreement |\n|---|---|---|---|---|");
console.log(`| salience, per sheet | follow "looking at" names the thing | top thing by mean share | ${withMention.length} sheets | top named ${f2(mean(withMention.map((x) => x.topHit)))} vs chance ${f2(mean(withMention.map((x) => x.chance)))} |`);
console.log(`| salience, per case | follow on look (graded) | mean share.look | ${R.length} | Spearman ${f2(spearman(R.map((r) => r.lookShare), onLook))} (bench eye: ${f2(spearman(R.map((r) => r.eye ?? NaN), onLook))}) |`);
console.log(`| load, per sheet | follow "confusing" reports too much at once | new + pulls in the sheet | ${sheets.length} sheets, ${sheets.filter((x) => x.over).length} flagged | AUC ${f2(auc(sheets.map((x) => x.load), sheets.map((x) => x.over)))} |`);
console.log(`| eyePath, per sheet | follow says a change is easy to miss or too quick | missed changes in the sheet | ${sheets.length} sheets, ${sheets.filter((x) => x.missFlag).length} flagged | AUC ${f2(auc(sheets.map((x) => x.missed), sheets.map((x) => x.missFlag)))} |`);
console.log(`| load, per case | follow confused share | meanPull | ${R.length} | Spearman ${f2(spearman(R.map((r) => r.load.meanPull!), confused))}; peakNew ${f2(spearman(R.map((r) => r.load.peakNew!), confused))} |`);
console.log(`| legibility, per case | designer or scroller says small or unreadable text | shareBelow | ${R.length}, ${R.filter((r) => r.small).length} flagged | AUC ${f2(auc(R.map((r) => r.legibility.shareBelow!), R.map((r) => r.small)))}; minAngle (lower) ${f2(auc(R.map((r) => -r.legibility.minAngle!), R.map((r) => r.small)))} |`);
console.log(`| legibility, per case | says faint or low contrast | faintShare | ${R.length}, ${R.filter((r) => r.faint).length} flagged | AUC ${f2(auc(R.map((r) => r.legibility.faintShare!), R.map((r) => r.faint)))} |`);
const D = designed.filter((x) => x.chars > 0);
console.log(`| legibility, per sheet | designer names small or unreadable text on the sheet (captions left out) | shareBelow; minAngle (lower) | ${D.length} sheets with text, ${D.filter((x) => x.small).length} flagged | AUC ${f2(auc(D.map((x) => x.shareBelow), D.map((x) => x.small)))}; ${f2(auc(D.map((x) => -x.minAngle), D.map((x) => x.small)))} |`);
console.log(`| legibility, per case | designer type score | shareBelow | ${R.filter((r) => r.designer).length} | Spearman ${f2(spearman(R.map((r) => r.legibility.shareBelow!), R.map((r) => r.designer?.type ?? NaN)))} |`);
console.log(`| fill, per sheet | designer names an empty or unused frame on the sheet | 1 - filled; emptyBand | ${designed.length} sheets, ${designed.filter((x) => x.empty).length} flagged | AUC ${f2(auc(designed.map((x) => 1 - x.filled), designed.map((x) => x.empty)))}; ${f2(auc(designed.map((x) => x.emptyBand), designed.map((x) => x.empty)))} |`);
console.log(`| fill, per case | designer says empty or unused frame | 1 - filled; emptyBand | ${R.length}, ${R.filter((r) => r.empty).length} flagged | AUC ${f2(auc(R.map((r) => 1 - r.fill.filled!), R.map((r) => r.empty)))}; ${f2(auc(R.map((r) => r.fill.emptyBand!), R.map((r) => r.empty)))} |`);
console.log(`| fill, per case | designer composition score | filled | ${R.filter((r) => r.designer).length} | Spearman ${f2(spearman(R.map((r) => r.fill.filled!), R.map((r) => r.designer?.composition ?? NaN)))} |`);
console.log(`| balance, per case | designer composition score | abs(balanceX) | ${R.filter((r) => r.designer).length} | Spearman ${f2(spearman(R.map((r) => Math.abs(r.fill.balanceX!)), R.map((r) => r.designer?.composition ?? NaN)))} |`);
console.log(`\ninstruments on a whole clip: ${(ms / Math.max(1, calls)).toFixed(0)} ms per clip (five instruments, cold)`);
if (old) {
  console.log("\nbench scores that changed (old -> new):");
  for (const x of stability) {
    const diff = Object.keys(x.now).filter((k) => Math.abs((x.old?.[k] ?? NaN) - x.now[k]!) > 1e-9 || !(k in (x.old ?? {})));
    if (diff.length) console.log(`  ${x.id}: ${diff.map((k) => `${k} ${x.old?.[k]} -> ${x.now[k]}`).join(", ")}`);
  }
}
if (sweep.length) for (const [k, v] of VARIANTS.entries()) console.log(`sweep ${JSON.stringify(v)}: top named ${f2(mean(sweep[k] ?? []))}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ rows, sheets, designed, stability }, null, 1));
