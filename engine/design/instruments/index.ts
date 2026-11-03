// The instruments: measure any property of a compiled scene and report numbers and plain notes, never pass or fail.
// Every instrument has settings an agent chooses for this video; `suggest(viewing)` offers a starting point with its
// reason, which the agent may replace. All of them share one cached sampling of the scene (sample.ts), so a search loop
// can call them many times per moment.
import type { Instrument, MeasureInput, Reading } from "../types.ts";
import { eyePath } from "./eye-path.ts";
import { fill } from "./fill.ts";
import { legibility } from "./legibility.ts";
import { load } from "./load.ts";
import { requirement } from "./requirement.ts";
import { salience } from "./salience.ts";
import { steadiness } from "./steadiness.ts";
import { timing } from "./timing.ts";
import { visibility } from "./visibility.ts";

export { eyePath, fill, legibility, load, requirement, salience, steadiness, timing, visibility };
export { countLoad, streamGroups, streams, STREAMS, type LoadSettings, type Row, type Stream, type StreamSettings } from "./load.ts";
export { salienceAt, entropyOf, shareOf, suggestSalience, type SalienceSettings } from "./salience.ts";
export { eyeVisits, cutsOf, type EyePathSettings, type Visit } from "./eye-path.ts";
export { suggestLegibility, type LegibilitySettings } from "./legibility.ts";
export { partOf, type RequirementSettings } from "./requirement.ts";
export { sampled, arcmin, frameDegrees, framesOf, type Item, type Sampled, type Thing } from "./sample.ts";

export const instruments: Record<string, Instrument<any>> = { salience, legibility, load, eyePath, visibility, timing, fill, steadiness, requirement };

type Over = Record<string, unknown>;
// Settings merge: an agent's choice replaces the suggestion key by key (objects merge, lists and values replace).
function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over ?? base) as T;
  const out: Over = { ...(base as Over) };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? merge(out[k], v) : v;
  return out as T;
}

/** The settings an instrument would run with: its suggestion for this viewing, with the agent's choices on top. */
export const settingsFor = (name: string, input: MeasureInput, chosen?: Over) => merge(instruments[name]!.suggest(input.viewing), chosen);

/**
 * Every instrument (or the ones named in `only`) on one input. `settingsByName` holds the agent's choices per
 * instrument; anything left out takes the suggestion. The requirement instrument runs only when given a requirement.
 */
export function measureAll(input: MeasureInput, settingsByName: Record<string, Over> = {}, only?: string[]): Reading[] {
  const names = only ?? Object.keys(instruments).filter((n) => n !== "requirement" || settingsByName.requirement?.requirement);
  return names.map((n) => instruments[n]!.measure(input, settingsFor(n, input, settingsByName[n])));
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Readings as short plain lines an agent reads beside the frames: one line of values per instrument, then its notes. */
export function readingsText(readings: Reading[], o: { notes?: number } = {}): string {
  const lines: string[] = [];
  for (const r of readings) {
    lines.push(`${r.instrument}: ${Object.entries(r.values).map(([k, v]) => `${k} ${fmt(v)}`).join(", ")}`);
    for (const n of r.notes.slice(0, o.notes ?? 4)) lines.push(`  ${n}`);
  }
  return lines.join("\n");
}
