// Timing against the voice:
// - lag: for each named thing, when it arrives or changes relative to the word that names it. Gaze reaches a named
//   object about 200 to 400 ms after its word starts (Allopenna, Magnuson and Tanenhaus 1998); visuals may lead their
//   sound but should not trail it far (temporal contiguity, Mayer; Ginns 2006). The agent decides the lead it wants.
// - dwell: how long each piece of words stays on screen against the time it takes to read.
// - holds: in each silence, the share of frames where something tied to the hold changes, something else changes, or
//   nothing does. A camera move is not a thing changing: it is reported on its own (the camera share).
// The word that names a thing is found from the thing itself: its plan name's parts, and the words it shows that no
// other thing shows. No lexicon. When the narration never says it, the word the plan anchors the thing's moment on
// (input.cues) is its cue, and the notes say so.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { mean, namesOf, round, sampled, unitsOf, windowOf } from "./sample.ts";

export type TimingSettings = {
  search: number; // seconds around a word to look for its thing's onset
  late: number; // seconds after the word past which a thing counts in lateShare
  readRate: number; // words a second a viewer reads on screen while listening
  settle: number; // seconds to find a piece of words before reading it
  why?: string;
};

const stem = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/(ing|ed|es|s)$/u, "");
const keysOf = (text: string) => text.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).map(stem).filter((w) => w.length >= 3 || /\d/.test(w));

export const timing: Instrument<TimingSettings> = {
  name: "timing",
  describe:
    "Timing against the voice. Values: lag.<name> (s from its cue word to its nearest arrival or change, negative before; cue: a word of its name or of words only it shows, else its moment's word), meanLag, maxLag (s), matched, cued (timed on a moment's word), already (named while shown, unchanged), missing (named, not shown), lateShare; dwellShort (texts shown under their reading time), minDwellRatio; hold.<id>.related, hold.<id>.unrelated, hold.<id>.still, hold.<id>.camera (shares of a silence's frames; camera moves apart), holdRelated, holdUnrelated, holdStill, holdCamera (means). Settings: search (s), late (s), readRate (words a second), settle (s).",
  suggest: (v: Viewing) => {
    const glance = /glanc|feed|scroll|passing/i.test(v.watch);
    return { search: 3, late: 1, readRate: glance ? 2.5 : 3.5, settle: 0.3, why: `suggested for ${v.watch}: gaze reaches a named thing 0.2 to 0.4 s after its word, so a second late is clearly behind; on-screen words read at about ${glance ? "2.5 words a second while listening in passing" : "3.5 words a second while listening"}` };
  },
  measure(input: MeasureInput, set: TimingSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const fps = s.fps;
    const names = namesOf(s, input);
    const named = !!input.ids && Object.keys(input.ids).length > 0;
    const values: Record<string, number> = {};
    const notes: string[] = [];

    // Lag.
    const textKeys = s.units.map((_, u) => new Set(keysOf(s.texts[u] ?? "")));
    const owners = new Map<string, number>();
    for (const ks of textKeys) for (const k of ks) owners.set(k, (owners.get(k) ?? 0) + 1);
    const spoken = input.words.map((w) => stem(w.text));
    const lags: number[] = [];
    let already = 0;
    let missing = 0;
    let late = 0;
    let cued = 0;
    const search = Math.round(set.search * fps);
    for (const [name, ids] of Object.entries(names)) {
      const us = unitsOf(s, ids);
      if (!us.length) continue;
      const keys = new Set([...(named ? keysOf(name) : []), ...us.flatMap((u) => [...textKeys[u]!].filter((k) => owners.get(k) === 1))]);
      if (!named && !us.some((u) => s.texts[u])) continue;
      const near = (i: number) => !!input.words[i] && input.words[i]!.start * fps >= range[0] - search && input.words[i]!.start * fps < range[1];
      let wi = spoken.findIndex((w, i) => keys.has(w) && near(i));
      // Its name is never said here: the word the plan anchors its moment on is its cue.
      const byCue = wi < 0 && named;
      if (byCue) {
        // The moment inside the window first; else the latest one just before it.
        const cs = (input.cues?.[name] ?? []).filter(near);
        const inside = cs.filter((i) => input.words[i]!.start * fps >= range[0]);
        wi = inside.length ? Math.min(...inside) : cs.length ? Math.max(...cs) : -1;
      }
      if (wi < 0) continue;
      if (byCue) cued++;
      const cue = byCue ? `its name is not spoken; the moment's word "${input.words[wi]!.text}" at ${input.words[wi]!.start.toFixed(1)} s is its cue` : "";
      const w0 = Math.round(input.words[wi]!.start * fps);
      let best: number | undefined;
      for (const u of us) for (const o of s.onsets[u]!) if (Math.abs(o - w0) <= search && (best === undefined || Math.abs(o - w0) < Math.abs(best - w0))) best = o;
      if (best === undefined) {
        if (us.some((u) => s.vis[u]![Math.min(s.frames - 1, w0)])) already++;
        else missing++;
        if (named) values[`lag.${name}`] = NaN;
        notes.push(`${name}: ${cue || `named by "${input.words[wi]!.text}" at ${input.words[wi]!.start.toFixed(1)} s`}; ${us.some((u) => s.vis[u]![Math.min(s.frames - 1, w0)]) ? "already on screen and nothing about it changes near the word" : "not on screen within the search span"}`);
        continue;
      }
      const lag = (best - w0) / fps;
      lags.push(lag);
      if (lag > set.late) late++;
      if (named) values[`lag.${name}`] = round(lag, 2);
      if (Math.abs(lag) > 0.5 || named) notes.push(`${name}: ${lag >= 0 ? `${lag.toFixed(2)} s after` : `${(-lag).toFixed(2)} s before`} "${input.words[wi]!.text}"${cue ? ` (${cue})` : ""}`);
    }
    for (const k of Object.keys(values)) if (Number.isNaN(values[k])) delete values[k];
    Object.assign(values, { meanLag: round(mean(lags), 2), maxLag: round(lags.length ? Math.max(...lags) : 0, 2), matched: lags.length, cued, already, missing, lateShare: round(lags.length ? late / lags.length : 0) });

    // Dwell.
    let short = 0;
    let minRatio = Infinity;
    s.units.forEach((u, i) => {
      const words = (s.texts[i] ?? "").split(/\s+/).filter(Boolean).length;
      if (!words) return;
      const v = s.vis[i]!;
      for (let f = range[0]; f < range[1]; f++) {
        if (!v[f] || (f > range[0] && v[f - 1])) continue;
        let e = f;
        while (e < s.frames && v[e]) e++;
        if (e >= range[1] && e < s.frames) continue; // runs past the window: not judged here
        const shown = (e - f) / fps;
        const need = words / set.readRate + set.settle;
        minRatio = Math.min(minRatio, shown / need);
        if (shown < need) {
          short++;
          if (short <= 3) notes.push(`${u} shows ${words} words for ${shown.toFixed(1)} s; reading takes about ${need.toFixed(1)} s`);
        }
      }
    });
    Object.assign(values, { dwellShort: short, minDwellRatio: round(Number.isFinite(minRatio) ? minRatio : 0, 2) });

    // Holds.
    const all = Object.values(input.ids ?? {}).flat();
    const rel: number[] = [];
    const unrel: number[] = [];
    const still: number[] = [];
    const cam: number[] = [];
    for (const h of input.holds ?? []) {
      const [a, b] = [Math.max(range[0], Math.round(h.from * fps)), Math.min(range[1], Math.round(h.to * fps))];
      if (b <= a) continue;
      const related = new Set(unitsOf(s, input.ids?.[h.id] ?? all));
      let r = 0;
      let o = 0;
      let z = 0;
      let c = 0;
      for (let f = a; f < b; f++) {
        let mine = false;
        let other = false;
        c += s.camera[f] ? 1 : 0;
        s.act.forEach((bits, u) => {
          if (!bits[f]) return;
          if (related.has(u)) mine = true;
          else other = true;
        });
        r += +mine;
        o += +other;
        z += +(!mine && !other);
      }
      const n = b - a;
      values[`hold.${h.id}.related`] = round(r / n, 2);
      values[`hold.${h.id}.unrelated`] = round(o / n, 2);
      values[`hold.${h.id}.still`] = round(z / n, 2);
      values[`hold.${h.id}.camera`] = round(c / n, 2);
      cam.push(c / n);
      rel.push(r / n);
      unrel.push(o / n);
      still.push(z / n);
      notes.push(`hold ${h.id} (${(n / fps).toFixed(1)} s): related change ${Math.round((r / n) * 100)}% of frames, unrelated ${Math.round((o / n) * 100)}%, still ${Math.round((z / n) * 100)}%; the camera moves ${Math.round((c / n) * 100)}% of frames (not counted as a change of things)${input.ids?.[h.id] ? "" : " (related: every named thing, as the ids map names nothing for this hold)"}`);
    }
    if (rel.length) Object.assign(values, { holdRelated: round(mean(rel), 2), holdUnrelated: round(mean(unrel), 2), holdStill: round(mean(still), 2), holdCamera: round(mean(cam), 2) });
    return { instrument: "timing", values, notes };
  },
};
