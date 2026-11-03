// The design brain's instruments (engine/design/instruments) read on one built part of the scene, turned into plain
// notes a writer can act on: what, where in the frame, at what second, and how much, with the settings they were read
// with (the instruments' suggestions for this project's viewing, each with its reason). Two forms:
// - partNotes: every instrument over the part's window, one short block each, its notes placed on the frame and in time.
// - frameReadings: what the instruments see on one frame, for a reviewer to read beside the still.
// They report and never judge: a number beside its setting is a reading, and what it means for this video is the
// reviewer's and the writer's call.
import type { Scene } from "../../engine/core/types.ts";
import { instruments, settingsFor } from "../../engine/design/instruments/index.ts";
import { arcmin, sampled, UI, area, meet, type Rect, type Sampled } from "../../engine/design/instruments/sample.ts";
import { salienceAt, type SalienceSettings } from "../../engine/design/instruments/salience.ts";
import { standing, type VisibilitySettings } from "../../engine/design/instruments/visibility.ts";
import type { LegibilitySettings } from "../../engine/design/instruments/legibility.ts";
import type { MeasureInput, Reading, Viewing } from "../../engine/design/types.ts";

// The instruments a part is read with, in the order a writer reads them, each under a plain name.
export const READ_WITH: [string, string][] = [
  ["legibility", "Readability"],
  ["visibility", "Covered, cut by the frame, or under the captions"],
  ["salience", "Where attention goes"],
  ["eyePath", "The order the eye likely visits things, and changes it may miss"],
  ["load", "Pace and change load"],
  ["steadiness", "Steadiness of things that stay"],
  ["timing", "Timing against the voice"],
  ["fill", "Fill and balance"],
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Where a box sits on the frame, in words and in shares of the frame: "top left (x 5-40%, y 3-9%)". */
export function placeOf(box: Rect, W: number, H: number): string {
  const [cx, cy] = [(box.x0 + box.x1) / 2 / W, (box.y0 + box.y1) / 2 / H];
  const row = cy < 1 / 3 ? "top" : cy < 2 / 3 ? "middle" : "bottom";
  const col = cx < 1 / 3 ? "left" : cx < 2 / 3 ? "center" : "right";
  const words = row === "middle" && col === "center" ? "center" : col === "center" ? row : row === "middle" ? col : `${row} ${col}`;
  const span = (a: number, b: number, n: number) => `${Math.round(Math.max(0, a / n) * 100)}-${Math.round(Math.min(1, b / n) * 100)}%`;
  return `${words} (x ${span(box.x0, box.x1, W)}, y ${span(box.y0, box.y1, H)})`;
}

// A unit's box on a frame, as the viewer sees it (camera and clips included), or undefined when it is not shown.
function boxAt(s: Sampled, unit: string, f: number): Rect | undefined {
  const mine = s.items(f).filter((t) => t.unit === unit && t.opacity > 0.05);
  if (!mine.length) return undefined;
  return mine.reduce((b, t) => ({ x0: Math.min(b.x0, t.box.x0), y0: Math.min(b.y0, t.box.y0), x1: Math.max(b.x1, t.box.x1), y1: Math.max(b.y1, t.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

// The frame nearest `f` inside the window where the unit shows, so a note is placed where the thing really is.
function shownNear(s: Sampled, u: number, f: number, [a, b]: [number, number]): number | undefined {
  for (let d = 0; d < b - a; d++) for (const g of [f - d, f + d]) if (g >= a && g < b && s.vis[u]![g]) return g;
  return undefined;
}

// The things a note names: unit ids written in it, else the unit whose words a quoted piece of the note shows.
function unitsNamed(s: Sampled, note: string): number[] {
  const out: number[] = [];
  const ids = s.units.map((id, u) => ({ id, u })).sort((x, y) => y.id.length - x.id.length);
  let rest = note;
  for (const { id, u } of ids) {
    const re = new RegExp(`(^|[^\\w.-])${id.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![\\w-])`);
    if (re.test(rest)) {
      out.push(u);
      rest = rest.replace(re, "$1");
    }
  }
  if (out.length) return out;
  for (const m of note.matchAll(/"([^"]{2,})"/g)) {
    const u = s.texts.findIndex((t) => t && t.includes(m[1]!));
    if (u >= 0 && !out.includes(u)) out.push(u);
  }
  return out;
}

// A note with the place on the frame and the second of each thing it names, read where the note says it happens (its
// first time in seconds) or, when it gives none, where the thing first shows in the window.
function placed(s: Sampled, note: string, range: [number, number]): string {
  const said = /(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?s\b/.exec(note);
  const at = said ? Math.round(Number(said[1]) * s.fps) : range[0];
  const where = unitsNamed(s, note).slice(0, 3).flatMap((u) => {
    const f = shownNear(s, u, Math.max(range[0], Math.min(range[1] - 1, at)), range);
    const box = f === undefined ? undefined : boxAt(s, s.units[u]!, f);
    return box ? [`${s.units[u]} at ${(f! / s.fps).toFixed(1)} s: ${placeOf(box, s.W, s.H)}`] : [];
  });
  return where.length ? `${note} [${where.join("; ")}]` : note;
}

// The settings an instrument ran with, short: its numbers and switches, then the reason for them.
function settingsLine(set: Record<string, unknown>): string {
  const own = Object.entries(set).filter(([k, v]) => k !== "why" && k !== "perSecond" && (typeof v === "number" || typeof v === "boolean")).map(([k, v]) => `${k} ${v}`);
  return `${own.join(", ")}${typeof set.why === "string" ? `; ${set.why}` : ""}`;
}

export type PartNotes = { lines: string[]; readings: Reading[]; settings: Record<string, Record<string, unknown>> };

/**
 * Every instrument over a part's window, as plain notes: under each instrument's plain name, the settings it ran with
 * and why (the suggestion for `input.viewing`, with `chosen` on top where an agent chose), its values, and its notes
 * with the place on the frame and the second of each thing they name. `perInstrument` caps the notes of one.
 */
export function partNotes(input: MeasureInput, o: { perInstrument?: number; chosen?: Record<string, Record<string, unknown>> } = {}): PartNotes {
  const s = sampled(input.scene);
  const range: [number, number] = input.window ?? [0, s.frames];
  const lines: string[] = [];
  const readings: Reading[] = [];
  const settings: PartNotes["settings"] = {};
  for (const [name, title] of READ_WITH) {
    const set = settingsFor(name, input, o.chosen?.[name]) as Record<string, unknown>;
    const r = instruments[name]!.measure(input, set);
    readings.push(r);
    settings[name] = set;
    // Per-name values (lag.x, seen.x) are many and repeat what the notes say about each thing; the whole-part ones stay.
    const values = Object.entries(r.values).filter(([k]) => !k.includes(".")).map(([k, v]) => `${k} ${fmt(v)}`);
    lines.push(`${title} (${name}; settings: ${settingsLine(set)})`);
    if (values.length) lines.push(`  values: ${values.join(", ")}`);
    for (const n of r.notes.slice(0, o.perInstrument ?? 6)) lines.push(`  - ${placed(s, n, range)}`);
    if (r.notes.length > (o.perInstrument ?? 6)) lines.push(`  - and ${r.notes.length - (o.perInstrument ?? 6)} more like these`);
  }
  return { lines, readings, settings };
}

/**
 * What the instruments read on one frame, for a reviewer beside the still: where attention likely goes (shares), each
 * piece of writing with its place, cap height in arcminutes and contrast beside the settings, what is changing, and
 * what is covered, cut by the frame or inside a UI zone such as the captions band.
 */
export function frameReadings(scene: Scene, viewing: Viewing, frame: number, o: { things?: number } = {}): string {
  const s = sampled(scene);
  const f = Math.max(0, Math.min(s.frames - 1, Math.round(frame)));
  const input: MeasureInput = { scene, words: [], viewing };
  const sal = settingsFor("salience", input) as SalienceSettings;
  const leg = settingsFor("legibility", input) as LegibilitySettings;
  const vis = settingsFor("visibility", input) as VisibilitySettings;
  const max = o.things ?? 4;
  const out: string[] = [];
  const shares = salienceAt(s, f, sal).slice(0, max);
  if (shares.length) out.push(`attention (salience): ${shares.map((x) => `${s.units[x.unit]} ${pct(x.share)}`).join(", ")}`);
  const all = s.items(f);
  const texts = all.filter((t) => t.kind === "text" && t.opacity >= leg.minOpacity && (t.text ?? "").trim());
  for (const t of texts.slice(0, 8)) {
    const angle = arcmin((t.size ?? 0) * leg.capHeight, viewing, s.W);
    const c = t.contrast === undefined ? "over a picture, contrast unknown" : `contrast ${t.contrast.toFixed(1)}:1`;
    out.push(`text "${(t.text ?? "").slice(0, 32)}" (${t.unit}) ${placeOf(t.box, s.W, s.H)}: cap height ${angle.toFixed(0)} arcmin (readable set at ${leg.readable}), ${c} (faint set under ${leg.contrastLow}:1)`);
  }
  if (texts.length > 8) out.push(`and ${texts.length - 8} more pieces of writing`);
  const moving = s.units.filter((_, u) => s.act[u]![f]);
  if (moving.length) out.push(`changing now: ${moving.slice(0, 6).join(", ")}${moving.length > 6 ? ` and ${moving.length - 6} more` : ""}`);
  const zones = UI(viewing, s.W, s.H);
  const frameBox = { x0: 0, y0: 0, x1: s.W, y1: s.H };
  const standings = s.things(f, vis.backdrop).map((t) => ({ t, st: standing(t.items, all, s.W, s.H, zones, vis) }));
  const covered = standings.filter((x) => x.st.covered).map((x) => x.t.unit);
  const union = (t: { items: { box: Rect }[] }) => t.items.reduce((b, i) => ({ x0: Math.min(b.x0, i.box.x0), y0: Math.min(b.y0, i.box.y0), x1: Math.max(b.x1, i.box.x1), y1: Math.max(b.y1, i.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const cut = standings.filter((x) => x.st.cut).map((x) => `${x.t.unit} (${pct(1 - area(meet(union(x.t), frameBox)) / Math.max(1, area(union(x.t))))} outside)`);
  const ui = standings.filter((x) => x.st.ui).map((x) => x.t.unit);
  if (covered.length) out.push(`covered by something painted over it: ${covered.join(", ")}`);
  if (cut.length) out.push(`cut by the frame edge: ${cut.join(", ")}`);
  if (ui.length) out.push(`inside ${viewing.uiZones.map((z) => z.what).join(" or ")}: ${ui.join(", ")}`);
  return out.join("\n");
}
