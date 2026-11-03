// Change load: how many new things arrive around each second, and how many independent changes pull at the eye at once
// (working memory holds about four chunks, Cowan 2001; Lang's limited capacity model). Reports counts, never a line.
//
// Things that are seen as one are counted as one:
// - common fate: things that change on the same frames are one pull (four boxes lit together), as the bench did.
// - streams: look-alike things that keep arriving from one place or moving one way within a short span (drops from a
//   tap, sparks, bubbles, a flock, rain) are one flow, not a new thing per element. The grouping reads only structure:
//   the same kinds of parts with the same geometry, size and words (never color or id names), repeated arrivals, and
//   shared start or shared direction of motion.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { label, round, sampled, windowOf, type Sampled } from "./sample.ts";

export type StreamSettings = {
  gap: number; // seconds: arrivals of look-alike things closer than this continue one stream
  min: number; // distinct arrival moments a stream needs (two things arriving together are two things)
  move: number; // share of the frame's shorter side a member travels while it shows, to count as flowing
  near: number; // share of the shorter side: members starting within this of each other share a source
  sameWay: number; // 0 to 1: how aligned members' directions are (length of their mean unit direction) to share a way
};

export type LoadSettings = StreamSettings & {
  span: number; // seconds: new things are counted in a span this long around each second
  sameFate: number; // share of changing frames two things share to be one pull
  why?: string;
};

export type Stream = { ids: string[]; arrivals: number; from: number; to: number };

// ---------------------------------------------------------------------------------------------------------------------
// Streams.

export function streams(s: Sampled, set: StreamSettings, range: [number, number] = [0, s.frames]): Stream[] {
  const short = Math.min(s.W, s.H);
  const gap = Math.max(1, Math.round(set.gap * s.fps));
  type Ev = { u: number; f: number; start: [number, number]; d: [number, number] };
  const bySig = new Map<string, Ev[]>();
  s.units.forEach((_, u) => {
    for (const f of s.arrivals[u]!) {
      if (f < range[0] - gap || f >= range[1]) continue;
      let end = f;
      const v = s.vis[u]!;
      while (end + 1 < s.frames && v[end + 1] && end - f < s.fps * 2) end++;
      const a = s.pos(u, f);
      const b = s.pos(u, end);
      const list = bySig.get(s.signature[u]!) ?? [];
      list.push({ u, f, start: a, d: [b[0] - a[0], b[1] - a[1]] });
      bySig.set(s.signature[u]!, list);
    }
  });
  // Union-find over units, so a pooled element reused by several chains joins them.
  const parent = s.units.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const join = (a: number, b: number) => (parent[find(a)] = find(b));
  const info = new Map<number, { arrivals: number; from: number; to: number }>();
  for (const evs of bySig.values()) {
    if (evs.length < set.min) continue;
    evs.sort((a, b) => a.f - b.f);
    const chains: Ev[][] = [];
    for (const e of evs) {
      const last = chains.at(-1);
      if (last && e.f - last.at(-1)!.f <= gap) last.push(e);
      else chains.push([e]);
    }
    for (const c of chains) {
      if (new Set(c.map((e) => e.f)).size < set.min) continue;
      // A flow: most members travel, from one source or one way. A recurrence: look-alike things arriving again and
      // again at one place (ripples, blooms, sparks of one spot), which the eye takes as one repeating event.
      const moving = c.filter((e) => Math.hypot(...e.d) > set.move * short);
      const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const [mx, my] = [med(c.map((e) => e.start[0])), med(c.map((e) => e.start[1]))];
      const near = c.filter((e) => Math.hypot(e.start[0] - mx, e.start[1] - my) <= set.near * short).length >= c.length / 2;
      const dirs = moving.map((e) => [e.d[0] / Math.hypot(...e.d), e.d[1] / Math.hypot(...e.d)] as const);
      const way = dirs.length > 0 && Math.hypot(dirs.reduce((t, d) => t + d[0], 0), dirs.reduce((t, d) => t + d[1], 0)) / dirs.length >= set.sameWay;
      const flows = moving.length >= c.length / 2 && (near || way);
      if (!flows && !near) continue;
      for (const e of c) join(e.u, c[0]!.u);
      const root = find(c[0]!.u);
      const prev = info.get(root);
      info.set(root, { arrivals: (prev?.arrivals ?? 0) + c.length, from: Math.min(prev?.from ?? Infinity, c[0]!.f), to: Math.max(prev?.to ?? 0, c.at(-1)!.f) });
    }
  }
  // Roots move as chains join; settle each chain's numbers on its final root.
  const settled = new Map<number, { arrivals: number; from: number; to: number }>();
  for (const [k, i] of info) {
    const r = find(k);
    const p = settled.get(r);
    settled.set(r, { arrivals: (p?.arrivals ?? 0) + i.arrivals, from: Math.min(p?.from ?? Infinity, i.from), to: Math.max(p?.to ?? 0, i.to) });
  }
  const groups = new Map<number, string[]>();
  s.units.forEach((u, i) => {
    const r = find(i);
    if (settled.has(r)) groups.set(r, [...(groups.get(r) ?? []), u]);
  });
  return [...groups].map(([r, ids]) => ({ ids, ...settled.get(r)! }));
}

const WHOLE = new WeakMap<Sampled, Map<string, Stream[]>>();

/**
 * The streams of the whole scene, cached. A window never decides on its own what a stream is: where it starts (a
 * moment's lead moves it) would cut a stream's earlier arrivals off, so the same blooms would read as one stream in one
 * candidate and as separate things in another.
 */
export function sceneStreams(s: Sampled, set: StreamSettings): Stream[] {
  const key = `${set.gap}|${set.min}|${set.move}|${set.near}|${set.sameWay}`;
  const memo = WHOLE.get(s) ?? (WHOLE.set(s, new Map()), WHOLE.get(s)!);
  const hit = memo.get(key);
  if (hit) return hit;
  const out = streams(s, set);
  memo.set(key, out);
  return out;
}

const GROUPS = new WeakMap<Sampled, Map<string, { rep: Int32Array; members: number[][] }>>();

/** Per unit, the stream it belongs to: `rep[u]` is the stream's first unit (itself when alone). Whole scene, cached. */
export function streamGroups(s: Sampled, set: StreamSettings): { rep: Int32Array; members: number[][] } {
  const key = `${set.gap}|${set.min}|${set.move}|${set.near}|${set.sameWay}`;
  const memo = GROUPS.get(s) ?? (GROUPS.set(s, new Map()), GROUPS.get(s)!);
  const hit = memo.get(key);
  if (hit) return hit;
  const rep = Int32Array.from(s.units.map((_, i) => i));
  for (const st of sceneStreams(s, set)) {
    const us = st.ids.map((id) => s.unitIndex.get(id)!).sort((a, b) => a - b);
    for (const u of us) rep[u] = us[0]!;
  }
  const members = s.units.map(() => [] as number[]);
  rep.forEach((r, u) => members[r]!.push(u));
  const out = { rep, members };
  memo.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Counting, shared with the bench (bench/lib/measure.ts calls it on its own samples, so both read the same way).

export type Row = { id: string; visible: Uint8Array; active: Uint8Array };
export type LoadCount = { seconds: number; perSecond: { t: number; new: number; pull: number; ids: string[] }[]; peakNew: number; peakPull: number; newPerSecond: number; meanNew: number; meanPull: number };

/**
 * New things around each second (a span of `span` frames centered on its start) and independent pulls within it.
 * `groups`: streams, each counted as one thing that arrives when it starts (or starts again after `gap` frames with
 * none of it showing) and one pull. With no groups this is exactly the bench's earlier count.
 */
export function countLoad(rows: Row[], fps: number, frames: number, groups: string[][], o: { gap: number; span: number; sameFate: number }, range: [number, number] = [0, frames]): LoadCount {
  const inGroup = new Map<string, number>();
  groups.forEach((g, k) => g.forEach((id) => inGroup.set(id, k)));
  type G = { ids: string[]; arrivals: number[]; active: Uint8Array };
  const merged: G[] = [];
  const at = new Map<number, G>();
  for (const r of rows) {
    const k = inGroup.get(r.id);
    if (k === undefined) {
      const arr: number[] = [];
      for (let f = 0; f < frames; f++) if (r.visible[f] && (f === 0 || !r.visible[f - 1])) arr.push(f);
      merged.push({ ids: [r.id], arrivals: arr, active: r.active });
      continue;
    }
    if (at.has(k)) continue;
    const members = rows.filter((x) => inGroup.get(x.id) === k);
    const vis = new Uint8Array(frames);
    const active = new Uint8Array(frames);
    const starts: number[] = [];
    for (const m of members) {
      for (let f = 0; f < frames; f++) {
        vis[f] |= m.visible[f]!;
        active[f] |= m.active[f]!;
        if (m.visible[f] && (f === 0 || !m.visible[f - 1])) starts.push(f);
      }
    }
    starts.sort((a, b) => a - b);
    // The stream arrives when it starts, and again only after a pause of `gap` frames with none of it showing.
    const arrivals: number[] = [];
    let last = -Infinity;
    for (const f of starts) {
      let quiet = f - last > o.gap;
      for (let g = Math.max(0, f - o.gap); quiet && g < f; g++) if (vis[g]) quiet = false;
      if (quiet) arrivals.push(f);
      last = f;
    }
    const g = { ids: members.map((m) => m.id), arrivals, active };
    at.set(k, g);
    merged.push(g);
  }
  const all = merged.flatMap((g) => g.arrivals.map((f) => ({ f, id: g.ids[0]! }))).sort((a, b) => a.f - b.f);
  const half = Math.round(o.span / 2);
  const per: LoadCount["perSecond"] = [];
  const first = Math.floor(range[0] / fps);
  const seconds = Math.max(1, Math.floor((range[1] - range[0]) / fps));
  for (let k = first; k < first + seconds; k++) {
    const from = k * fps;
    const hits = all.filter((x) => x.f >= from - half && x.f < from + half);
    const pull = pullsOf(merged, from, from + fps, o.sameFate).length;
    per.push({ t: k, new: hits.length, pull, ids: hits.map((x) => x.id) });
  }
  const inRange = all.filter((x) => x.f >= range[0] && x.f < range[1]).length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    seconds,
    perSecond: per,
    peakNew: Math.max(0, ...per.map((p) => p.new)),
    peakPull: Math.max(0, ...per.map((p) => p.pull)),
    newPerSecond: round(inRange / ((range[1] - range[0]) / fps), 2),
    meanNew: round(mean(per.map((p) => p.new)), 2),
    meanPull: round(mean(per.map((p) => p.pull)), 2),
  };
}

// Common fate, as the bench's direction check: greedy, most active first, each compared with a group's first member.
function pullsOf(list: { ids: string[]; active: Uint8Array }[], from: number, to: number, same: number): string[][] {
  const count = (bits: Uint8Array) => {
    let n = 0;
    for (let f = Math.max(0, from); f < Math.min(bits.length, to); f++) n += bits[f]!;
    return n;
  };
  const busy = list.map((g) => ({ g, n: count(g.active) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const out: { ids: string[]; bits: Uint8Array }[] = [];
  for (const { g } of busy) {
    const bits = g.active.subarray(Math.max(0, from), Math.min(g.active.length, to));
    const hit = out.find((o) => {
      let both = 0;
      let either = 0;
      for (let f = 0; f < bits.length; f++) {
        both += bits[f]! & o.bits[f]!;
        either += bits[f]! | o.bits[f]!;
      }
      return either && both / either >= same;
    });
    if (hit) hit.ids.push(...g.ids);
    else out.push({ ids: [...g.ids], bits });
  }
  return out.map((o) => o.ids);
}

// ---------------------------------------------------------------------------------------------------------------------
// The instrument.

export const STREAMS = (v: Viewing): StreamSettings & { why: string } => ({
  gap: 0.6,
  min: 3,
  move: 0.03,
  near: 0.08,
  sameWay: 0.8,
  why: `suggested for ${v.screen}: arrivals under 0.6 s apart read as one flow (apparent motion and grouping by common fate); a member must travel 3% of the shorter side to flow`,
});

export const load: Instrument<LoadSettings> = {
  name: "load",
  describe:
    "Change load around each second: arrivals, and independent changes at once (things changing together are one pull; a stream of look-alikes is one thing). Values: peakNew, meanNew (arrivals in a span), newPerSecond, peakPull, meanPull (independent changes at once), streams, streamMembers (counts). Series per second: new, pull. Settings: span (s), sameFate (share of frames shared to be one pull), gap (s), min (count), move, near (shares of the frame), sameWay (share): what makes a stream.",
  suggest: (v) => ({ ...STREAMS(v), span: 2, sameFate: 0.8, why: `suggested for ${v.screen}, ${v.watch}: 2 s spans and 80% shared frames as the bench used; working memory holds about four chunks (Cowan 2001)` }),
  measure(input: MeasureInput, set: LoadSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    // Streams of the whole scene that show in the window: a stream is the same stream whatever the window cuts off.
    const shows = (st: Stream) => st.ids.some((id) => {
      const v = s.vis[s.unitIndex.get(id)!]!;
      for (let f = range[0]; f < range[1]; f++) if (v[f]) return true;
      return false;
    });
    const found = sceneStreams(s, set).filter(shows);
    const rows = s.units.map((id, u) => ({ id, visible: s.vis[u]!, active: s.act[u]! }));
    const c = countLoad(rows, s.fps, s.frames, found.map((x) => x.ids), { gap: Math.round(set.gap * s.fps), span: Math.round(set.span * s.fps), sameFate: set.sameFate }, range);
    const notes: string[] = [];
    for (const st of found) notes.push(`${st.ids.length} look-alike things (${st.ids.slice(0, 3).join(", ")}${st.ids.length > 3 ? " ..." : ""}) arrive ${st.arrivals} times from ${(st.from / s.fps).toFixed(1)} to ${(st.to / s.fps).toFixed(1)} s: counted as one stream`);
    const busiest = [...c.perSecond].sort((a, b) => b.new - a.new)[0];
    if (busiest && busiest.new) notes.push(`most new things around ${busiest.t} s: ${busiest.new} (${[...new Set(busiest.ids)].slice(0, 5).map((id) => label(s, s.unitIndex.get(id)!)).join(", ")})`);
    const pulled = [...c.perSecond].sort((a, b) => b.pull - a.pull)[0];
    if (pulled && pulled.pull > 1) notes.push(`most independent changes at once: ${pulled.pull} in second ${pulled.t}`);
    return {
      instrument: "load",
      values: { peakNew: c.peakNew, meanNew: c.meanNew, newPerSecond: c.newPerSecond, peakPull: c.peakPull, meanPull: c.meanPull, streams: found.length, streamMembers: found.reduce((t, x) => t + x.ids.length, 0) },
      notes,
      series: c.perSecond.map((p) => ({ frame: p.t * s.fps, values: { new: p.new, pull: p.pull } })),
    };
  },
};
