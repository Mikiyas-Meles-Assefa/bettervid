// Eye path: the likely order the eye visits things over time, from salience over time, and the changes it may miss.
// The eye stays on a thing until another pulls clearly harder (it does not flick between near equals) and dwells a
// least time per visit (a fixation and a look around, about a quarter second or more). A change is likely missed when
// the eye does not reach it soon after it starts: during a camera move or right after a cut (change blindness, Rensink,
// O'Regan and Clark 1997; Simons and Levin 1997), or while something stronger holds the eye.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { framesOf, label, namesOf, round, sampled, unitsOf, windowOf, type Sampled } from "./sample.ts";
import { streamGroups } from "./load.ts";
import { salienceAt, suggestSalience, type SalienceSettings } from "./salience.ts";

export type EyePathSettings = {
  perSecond: number;
  switchRatio: number; // the eye moves when another thing's share is this many times the current one's
  minDwell: number; // seconds: least time per visit
  reach: number; // seconds: a change the eye does not visit within this is likely missed
  afterCut: number; // seconds after a cut in which changes are likely missed
  cutZoom: number; // a frame-to-frame zoom ratio over this is a cut
  cutShift: number; // a frame-to-frame pan over this share of the shorter side is a cut
  cutSwap: number; // share of the things on screen that arrive or leave on one frame for it to be a cut
  salience: SalienceSettings;
  why?: string;
};

export type Visit = { unit: number; from: number; to: number };

/** Frames where the picture cuts: a camera jump, or most of what is on screen swapping at once. */
export function cutsOf(s: Sampled, set: Pick<EyePathSettings, "cutZoom" | "cutShift" | "cutSwap">, [a, b]: [number, number]): number[] {
  const short = Math.min(s.W, s.H);
  const out = new Set<number>();
  for (const j of s.jumps) if (j.frame >= a && j.frame < b && (j.zoom > set.cutZoom || j.shift > set.cutShift * short)) out.add(j.frame);
  for (let f = Math.max(1, a); f < b; f++) {
    let before = 0;
    let swapped = 0;
    for (let u = 0; u < s.units.length; u++) {
      const [p, n] = [s.vis[u]![f - 1]!, s.vis[u]![f]!];
      before += p;
      if (p !== n) swapped++;
    }
    if (before >= 2 && swapped / Math.max(1, before) >= set.cutSwap) out.add(f);
  }
  return [...out].sort((x, y) => x - y);
}

export function eyeVisits(s: Sampled, frames: number[], set: EyePathSettings): Visit[] {
  const visits: Visit[] = [];
  const dwell = Math.round(set.minDwell * s.fps);
  for (const f of frames) {
    const sh = salienceAt(s, f, set.salience);
    if (!sh.length) continue;
    const cur = visits.at(-1);
    const mine = cur ? sh.find((x) => x.unit === cur.unit) : undefined;
    const top = sh[0]!;
    const stay = cur && mine && (f - cur.from < dwell || top.unit === cur.unit || top.share < mine.share * set.switchRatio);
    if (cur && stay) cur.to = f;
    else if (cur && cur.unit === top.unit) cur.to = f;
    else visits.push({ unit: top.unit, from: f, to: f });
  }
  return visits;
}

export const eyePath: Instrument<EyePathSettings> = {
  name: "eyePath",
  describe:
    "Likely order the eye visits things (from salience), and the changes it may miss. Values: visits, switchesPerSecond, changes, missed, missedCamera (during a camera move), missedCut (just after a cut), missedCompeting (while something stronger holds the eye), cuts, firstVisit.<name> (s from the window's start; -1 never), dwell.<name> (s). Settings: switchRatio, minDwell (s), reach (s), afterCut (s), cutZoom, cutShift, cutSwap (what counts as a cut), salience (its settings), perSecond.",
  suggest: (v: Viewing) => ({
    perSecond: 8,
    switchRatio: 1.3,
    minDwell: 0.3,
    reach: 0.6,
    afterCut: 0.25,
    cutZoom: 1.15,
    cutShift: 0.15,
    cutSwap: 0.6,
    // The salience instrument's own suggestion, without its reason (which the salience entry gives).
    salience: (({ why: _w, ...rest }) => rest)(suggestSalience(v)) as SalienceSettings,
    why: `suggested for ${v.screen}: a fixation and a look around take about 0.3 s; a change the eye has not reached within about 0.6 s is likely missed; the eye recovers about a quarter second after a cut`,
  }),
  measure(input: MeasureInput, set: EyePathSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const frames = framesOf(s.fps, range, set.perSecond);
    const visits = eyeVisits(s, frames, set);
    const cuts = cutsOf(s, set, range);
    const reach = Math.round(set.reach * s.fps);
    const afterCut = Math.round(set.afterCut * s.fps);
    const onEye = (f: number) => visits.find((v) => f >= v.from && f <= v.to + Math.max(1, Math.round(s.fps / set.perSecond)));
    const changes: { u: number; f: number; why?: "camera" | "cut" | "competing"; by?: number }[] = [];
    // A stream changes as one thing: a member's onset counts only when no member changed or showed just before.
    const groups = set.salience.streams ? streamGroups(s, set.salience.streams) : undefined;
    const gap = set.salience.streams ? Math.round(set.salience.streams.gap * s.fps) : 0;
    const name = (u: number) => (groups && groups.members[u]!.length > 1 ? `${label(s, u)} and ${groups.members[u]!.length - 1} alike` : label(s, u));
    s.units.forEach((_, u) => {
      const members = groups ? groups.members[u]! : [u];
      if (!members.length) return;
      const list = [...new Set(members.flatMap((m) => s.onsets[m]!))].sort((a, b) => a - b);
      const fresh = members.length === 1 ? list : list.filter((f) => !members.some((m) => { for (let g = Math.max(0, f - gap); g < f; g++) if (s.act[m]![g] || s.vis[m]![g]) return true; return false; }));
      for (const f of fresh) {
        if (f < range[0] || f >= range[1]) continue;
        const seen = visits.some((v) => v.unit === u && v.to >= f && v.from <= f + reach);
        if (seen) {
          changes.push({ u, f });
          continue;
        }
        const why = s.camera[f] ? "camera" : cuts.some((c) => f >= c && f - c <= afterCut) ? "cut" : "competing";
        changes.push({ u, f, why, by: onEye(f)?.unit });
      }
    });
    const missed = changes.filter((c) => c.why);
    const seconds = (range[1] - range[0]) / s.fps;
    const values: Record<string, number> = {
      visits: visits.length,
      switchesPerSecond: round(Math.max(0, visits.length - 1) / Math.max(0.1, seconds), 2),
      changes: changes.length,
      missed: missed.length,
      missedCamera: missed.filter((c) => c.why === "camera").length,
      missedCut: missed.filter((c) => c.why === "cut").length,
      missedCompeting: missed.filter((c) => c.why === "competing").length,
      cuts: cuts.length,
    };
    if (input.ids && Object.keys(input.ids).length) {
      for (const [name, ids] of Object.entries(namesOf(s, input))) {
        const us = new Set(unitsOf(s, ids).map((u) => (groups ? groups.rep[u]! : u)));
        const mine = visits.filter((v) => us.has(v.unit));
        values[`firstVisit.${name}`] = mine.length ? round((mine[0]!.from - range[0]) / s.fps, 2) : -1;
        values[`dwell.${name}`] = round(mine.reduce((t, v) => t + (v.to - v.from + Math.round(s.fps / set.perSecond)), 0) / s.fps, 2);
      }
    }
    const notes: string[] = [];
    if (visits.length) notes.push(`eye: ${visits.slice(0, 8).map((v) => `${name(v.unit)} ${(v.from / s.fps).toFixed(1)}-${(v.to / s.fps).toFixed(1)} s`).join(" > ")}${visits.length > 8 ? ` and ${visits.length - 8} more` : ""}`);
    for (const m of missed.slice(0, 5)) notes.push(`likely missed: ${name(m.u)} changes at ${(m.f / s.fps).toFixed(1)} s ${m.why === "camera" ? "during a camera move" : m.why === "cut" ? "right after a cut" : `while the eye is on ${m.by !== undefined ? name(m.by) : "something else"}`}`);
    return { instrument: "eyePath", values, notes, series: visits.map((v) => ({ frame: v.from, values: { unit: v.unit, to: v.to } })) };
  },
};
