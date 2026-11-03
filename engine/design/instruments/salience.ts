// Salience: where attention is likely to go, as a share per thing. Analytic, from what the scene knows: size, contrast
// against what is behind, how recently it arrived or started to change, whether it moves now, distance from the frame's
// center, and whether it is words, a picture or a shape. Grounded in the bottom-up saliency literature (Itti and Koch
// 1998 for contrast, onsets capture attention: Yantis and Jonides 1984; motion: Abrams and Christ 2003; the center
// bias of screen viewing: Tatler 2007; text and faces draw fixations: Cerf et al. 2009). A learned model on keyframes
// can replace `salienceAt` later behind the same values.
//
// It reports shares, a top share, and how spread attention is (entropy), never whether that is good: one goal wants a
// single focal point, another wants none, another wants the threat to stay unnoticed.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { STREAMS, streamGroups, type StreamSettings } from "./load.ts";
import { clamp, covers, frameDegrees, framesOf, label, mean, round, sampled, windowOf, type Sampled, type Thing } from "./sample.ts";

export type SalienceSettings = {
  perSecond: number; // frames sampled a second
  size: number; // weight of size (square root of the frame share it covers)
  contrast: number; // weight of contrast against what is behind (log of the WCAG ratio)
  pictureContrast: number; // 0 to 1: the contrast a picture is taken to have (the scene does not know its pixels)
  onset: number; // how much an arrival or the start of a change adds to a thing's pull
  onsetFade: number; // seconds for that boost to fall to a third
  onsetSize: number; // 0 to 1: how much an onset's pull scales with the thing's own size and contrast (0: an onset pulls alike whatever its size, as abrupt onsets capture attention regardless, Yantis and Jonides 1984)
  fadeIn: number; // exponent on opacity: below 1, a thing still fading in already pulls (its arrival is the cue)
  motion: number; // how much changing now multiplies its pull
  center: number; // 0 to 1: how strongly distance from the center lowers pull
  centerSpread: number; // the center bias's spread, as a share of the frame's half diagonal
  kinds: { text: number; picture: number; shape: number }; // pull by kind
  backdrop: number; // a shape over this share of the frame is a backdrop, not a thing
  /** Look-alike things in one flow (drops, particles) are one thing to the eye; null measures each on its own. */
  streams: StreamSettings | null;
  why?: string;
};

/** Per thing (a stream counts once, under its first member), highest share first. */
export type Shares = { unit: number; members: number[]; share: number; raw: number }[];

const CACHE = new WeakMap<Sampled, Map<string, Shares>>();

/** Attention share per visible thing on one frame, highest first. Cached per scene, frame and settings. */
export function salienceAt(s: Sampled, f: number, set: SalienceSettings): Shares {
  const key = `${f}|${set.size}|${set.contrast}|${set.pictureContrast}|${set.onset}|${set.onsetFade}|${set.motion}|${set.center}|${set.centerSpread}|${set.kinds.text}|${set.kinds.picture}|${set.kinds.shape}|${set.backdrop}|${set.streams ? Object.values(set.streams).join(",") : ""}`;
  const memo = CACHE.get(s) ?? (CACHE.set(s, new Map()), CACHE.get(s)!);
  const hit = memo.get(key);
  if (hit) return hit;
  const things = s.things(f, set.backdrop);
  const half = Math.hypot(s.W, s.H) / 2;
  const fade = Math.max(1, set.onsetFade * s.fps);
  const raw: { unit: number; base: number; recency: number; moving: number; seen: number; raw?: number }[] = things.map((t: Thing) => {
    const u = s.unitIndex.get(t.unit);
    const size = Math.sqrt(t.area / (s.W * s.H));
    const c = t.contrast === undefined ? set.pictureContrast : clamp(Math.log(t.contrast) / Math.log(21));
    const [cx, cy] = [(t.box.x0 + t.box.x1) / 2, (t.box.y0 + t.box.y1) / 2];
    const d = Math.hypot(cx - s.W / 2, cy - s.H / 2) / half;
    const center = 1 - set.center + set.center * Math.exp(-(d * d) / (2 * set.centerSpread * set.centerSpread));
    let last = -Infinity;
    if (u !== undefined) for (const o of s.onsets[u]!) if (o <= f) last = o;
    const recency = Number.isFinite(last) ? Math.exp(-(f - last) / fade) : 0;
    const moving = u !== undefined && s.act[u]![f] ? 1 : 0;
    const base = (set.size * size + set.contrast * c) * center * set.kinds[t.kind];
    return { unit: u ?? -1, base, recency, moving, seen: Math.min(1, t.opacity) ** set.fadeIn };
  });
  // An onset adds pull scaled partly by the thing's own base and partly by the frame's typical base.
  const typical = raw.length ? raw.reduce((a, r) => a + r.base, 0) / raw.length : 0;
  for (const r of raw) Object.assign(r, { raw: (r.base * (1 + set.motion * r.moving) + set.onset * r.recency * (set.onsetSize * r.base + (1 - set.onsetSize) * typical)) * r.seen });
  const total = raw.reduce((a, b) => a + b.raw!, 0);
  // A stream's members pull together, as one thing.
  const groups = set.streams ? streamGroups(s, set.streams) : undefined;
  const merged = new Map<number, { unit: number; members: number[]; raw: number }>();
  for (const r of raw) {
    if (r.unit < 0) continue;
    const rep = groups ? groups.rep[r.unit]! : r.unit;
    const m = merged.get(rep) ?? { unit: rep, members: [], raw: 0 };
    m.members.push(r.unit);
    m.raw += r.raw!;
    merged.set(rep, m);
  }
  const out = [...merged.values()].map((r) => ({ ...r, share: total ? r.raw / total : 0 })).sort((a, b) => b.share - a.share);
  memo.set(key, out);
  return out;
}

/** Normalized entropy of shares: 0 all on one thing, 1 spread evenly. */
export const entropyOf = (shares: number[]) => {
  const xs = shares.filter((x) => x > 0);
  if (xs.length < 2) return 0;
  return -xs.reduce((a, p) => a + p * Math.log(p), 0) / Math.log(xs.length);
};

/** A named thing's share on a frame: whole units count fully; a part of a unit counts by its share of the unit's area. */
export function shareOf(s: Sampled, f: number, shares: Shares, ids: string[], backdrop: number): number {
  let total = 0;
  const things = s.things(f, backdrop);
  const boxArea = (it: { box: { x0: number; y0: number; x1: number; y1: number } }) => Math.max(0, it.box.x1 - it.box.x0) * Math.max(0, it.box.y1 - it.box.y0);
  for (const sh of shares) {
    // A stream is named when any of its members is.
    if (sh.members.some((m) => ids.some((x) => s.units[m] === x || s.units[m]!.startsWith(`${x}.`)))) {
      total += sh.share;
      continue;
    }
    const t = things.find((x) => x.unit === s.units[sh.unit]);
    if (!t || sh.members.length > 1) continue;
    const part = t.items.filter((it) => ids.some((x) => covers(x, it))).reduce((a, it) => a + boxArea(it), 0);
    const whole = t.items.reduce((a, it) => a + boxArea(it), 0);
    if (part && whole) total += sh.share * Math.min(1, part / whole);
  }
  return total;
}

export function suggestSalience(v: Viewing): SalienceSettings {
  // A frame that fills more of the eye's field spreads the center bias over less of the frame (Tatler 2007 measured it
  // in degrees of view, not frame shares).
  const deg = frameDegrees(v);
  const spread = clamp(0.5 * (20 / Math.max(5, deg)), 0.2, 0.6);
  return {
    perSecond: 6,
    size: 0.6,
    contrast: 0.4,
    pictureContrast: 0.6,
    onset: 6,
    onsetFade: 1,
    onsetSize: 0.5,
    fadeIn: 1,
    motion: 1.5,
    center: 0.5,
    centerSpread: round(spread, 2),
    kinds: { text: 1.3, picture: 1.1, shape: 1 },
    backdrop: 0.8,
    streams: (({ why: _w, ...st }) => st)(STREAMS(v)),
    why: `suggested for ${v.screen} (${deg.toFixed(0)} degrees wide): an arrival or a change pulls strongly for about a second whatever its size (the bench's follow viewers name the newest thing in most 2 s windows), words and pictures draw more fixations than plain shapes, and the center bias spreads over ${Math.round(spread * 100)}% of the half diagonal`,
  };
}

export const salience: Instrument<SalienceSettings> = {
  name: "salience",
  describe:
    "Analytic attention share per thing on each sampled frame (size, contrast against what is behind, recent arrival or change, motion now, center bias, words or picture or shape), averaged over the window. " +
    "Values: share.<plan name> (mean share of the named thing; ids map needed), top (mean share of the most salient thing), lead (top minus second), entropy (0 all on one thing, 1 spread evenly), things (mean count on screen). " +
    "Series per frame: top, entropy, and share.<name>. Settings: weights of each cue, onsetFade, centerSpread, kinds, perSecond.",
  suggest: suggestSalience,
  measure(input: MeasureInput, set: SalienceSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const frames = framesOf(s.fps, range, set.perSecond);
    const names = input.ids ?? {};
    const series: Reading["series"] = [];
    const tops: number[] = [];
    const leads: number[] = [];
    const ents: number[] = [];
    const counts: number[] = [];
    const named: Record<string, number[]> = {};
    const leaders = new Map<number, number>();
    for (const f of frames) {
      const sh = salienceAt(s, f, set);
      const values: Record<string, number> = {};
      const top = sh[0]?.share ?? 0;
      tops.push(top);
      leads.push(top - (sh[1]?.share ?? 0));
      const e = entropyOf(sh.map((x) => x.share));
      ents.push(e);
      counts.push(sh.length);
      if (sh[0]) leaders.set(sh[0].unit, (leaders.get(sh[0].unit) ?? 0) + 1);
      values.top = round(top);
      values.entropy = round(e);
      for (const [name, ids] of Object.entries(names)) {
        const v = shareOf(s, f, sh, ids, set.backdrop);
        (named[name] ??= []).push(v);
        values[`share.${name}`] = round(v);
      }
      series.push({ frame: f, values });
    }
    const values: Record<string, number> = { top: round(mean(tops)), lead: round(mean(leads)), entropy: round(mean(ents)), things: round(mean(counts), 1) };
    for (const [name, xs] of Object.entries(named)) values[`share.${name}`] = round(mean(xs));
    const notes: string[] = [];
    const lead = [...leaders].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const groups = set.streams ? streamGroups(s, set.streams) : undefined;
    const name = (u: number) => (groups && groups.members[u]!.length > 1 ? `${label(s, u)} and ${groups.members[u]!.length - 1} alike` : label(s, u));
    if (lead.length) notes.push(`most salient: ${lead.map(([u, n]) => `${name(u)} on ${Math.round((n / frames.length) * 100)}% of frames`).join(", ")}`);
    for (const [name, xs] of Object.entries(named)) notes.push(`${name}: mean share ${mean(xs).toFixed(2)}, peak ${Math.max(0, ...xs).toFixed(2)}, the most salient thing on ${Math.round((xs.filter((x, i) => x > 0 && x >= tops[i]! - 1e-9).length / Math.max(1, xs.length)) * 100)}% of frames`);
    return { instrument: "salience", values, notes, series };
  },
};
