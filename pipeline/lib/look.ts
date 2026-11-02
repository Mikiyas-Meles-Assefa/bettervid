// Looking at a built scene the way a viewer would, with what the engine knows to keep the judgement grounded.
//
// Two kinds of evidence, side by side:
// - Measured: where every visible thing is on a frame (from the compiled scene), and what the renderer really drew
//   (from stills rendered with and without the words, and without the pictures). From these come facts no model has to
//   guess: writing that is faint against what is behind it, writing over other writing or a busy picture, writing cut by
//   the frame edge or smaller than the style's floor, a picture that does not show, empty stretches of frame, how much
//   of the frame is dimmed. Measured findings carry numbers, so a change can be checked against them.
// - Seen: Spark looks at near full-size frames with the words said at each one, the exact on-screen text and the
//   research facts, as a demanding designer and teacher (research/spikes/S14-can-spark-see.md).
//
// A look round names problems, a fix changes only what was named, and the changed version is kept only if it measures
// and looks better. Then the round stops. A section with nothing named is never rewritten.
import { execFileSync } from "node:child_process";
import type { Resolved, Scene, Theme } from "../../engine/core/types.ts";
import { evaluate } from "../../engine/core/evaluate.ts";
import { estimate } from "../../engine/language/layout.ts";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Thing = {
  id: string;
  owner: string; // the thing a line of text belongs to: "card.l2" belongs to "card"
  kind: "text" | "image" | "shape";
  text?: string;
  box: Rect; // on the frame, in pixels
  opacity: number; // after every parent's fade
  size?: number; // text size on the frame, in pixels
  color?: string;
  filled?: boolean; // a shape with a fill, which can hide what is under it
  muted?: boolean; // drawn with lowered brightness or color
  order: number; // paint order: later is in front
};

export type FindingKind = "faint" | "covered" | "busy_behind" | "overlap" | "off_frame" | "small_text" | "hidden_picture" | "empty" | "dimmed";
export type Finding = { kind: FindingKind; ids: string[]; note: string; severity: 1 | 2 | 3; value?: number };

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
type M = [number, number, number, number, number, number];
const times = (m: M, o: M): M => [m[0] * o[0] + m[2] * o[1], m[1] * o[0] + m[3] * o[1], m[0] * o[2] + m[2] * o[3], m[1] * o[2] + m[3] * o[3], m[0] * o[4] + m[2] * o[5] + m[4], m[1] * o[4] + m[3] * o[5] + m[5]];
function local(a: Resolved["props"]): M {
  const r = (num(a.rotate) * Math.PI) / 180;
  const skew = Math.tan((num(a.skew) * Math.PI) / 180);
  const rot: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), num(a.x), num(a.y)];
  return times(times(rot, [1, 0, skew, 1, 0, 0]), [num(a.scaleX, 1), 0, 0, num(a.scaleY, 1), 0, 0]);
}
function place(m: M, r: Rect): Rect {
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]]);
  return { x0: Math.min(...pts.map((p) => p[0]!)), y0: Math.min(...pts.map((p) => p[1]!)), x1: Math.max(...pts.map((p) => p[0]!)), y1: Math.max(...pts.map((p) => p[1]!)) };
}
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const meet = (a: Rect, b: Rect): Rect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const painted = (v: unknown) => typeof v === "string" && v !== "none" && v !== "transparent" && !/^#[0-9a-f]{6}00$/i.test(v);

// Everything visible on one frame, with its box on the frame and its paint order.
export function inventory(scene: Scene, frame: number): Thing[] {
  const out: (Thing & { layer: number; seq: number })[] = [];
  let seq = 0;
  const walk = (list: Resolved[], m: M, opacity: number, muted: boolean, layer: number) => {
    const sorted = list.map((r, i) => ({ r, i })).sort((a, b) => num(a.r.props.z) - num(b.r.props.z) || a.i - b.i).map((x) => x.r);
    for (const r of sorted) {
      const a = r.props;
      const o = opacity * num(a.opacity, 1);
      if (o <= 0.02) continue;
      const w = times(m, local(a));
      const lay = num(a.layer) || layer;
      const dull = muted || num(a.brightness, 1) < 0.8 || num(a.saturation, 1) < 0.6 || (num(a.blur) > 2 && r.kind !== "image");
      let box: Rect | undefined;
      if (r.kind === "text" && String(a.text ?? "").trim()) {
        const size = num(a.size, 60);
        const width = estimate(String(a.text), size, typeof a.font === "string" && /mono|courier/i.test(a.font) ? "mono" : undefined);
        const anchor = String(a.anchor ?? "middle");
        const x0 = anchor === "start" ? 0 : anchor === "end" ? -width : -width / 2;
        box = place(w, { x0, y0: -size * 0.6, x1: x0 + width, y1: size * 0.6 });
        const scale = Math.hypot(w[0], w[1]);
        out.push({ id: r.id, owner: r.id.replace(/\.l\d+$/, ""), kind: "text", text: String(a.text), box, opacity: o, size: size * scale, color: typeof a.color === "string" ? a.color : undefined, muted: dull, order: 0, layer: lay, seq: seq++ });
      } else if (r.kind === "image") {
        const [iw, ih] = [num(a.w), num(a.h)];
        if (iw > 0 && ih > 0) out.push({ id: r.id, owner: r.id, kind: "image", box: place(w, { x0: -iw / 2, y0: -ih / 2, x1: iw / 2, y1: ih / 2 }), opacity: o, muted: dull, order: 0, layer: lay, seq: seq++ });
      } else if (r.kind === "path" && Array.isArray(a.points) && a.points.length >= 4) {
        const p = a.points as number[];
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i + 1 < p.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, p[i]!), Math.min(y0, p[i + 1]!), Math.max(x1, p[i]!), Math.max(y1, p[i + 1]!)];
        const filled = painted(a.fill) && num(a.fillOpacity, 1) * o > 0.85;
        out.push({ id: r.id, owner: r.id, kind: "shape", box: place(w, { x0, y0, x1, y1 }), opacity: o, filled, color: typeof a.fill === "string" ? a.fill : undefined, muted: dull, order: 0, layer: lay, seq: seq++ });
      }
      walk(r.children, w, o, dull, lay);
    }
  };
  walk(evaluate(scene, frame), [1, 0, 0, 1, 0, 0], 1, false, 0);
  return out.sort((a, b) => a.layer - b.layer || a.seq - b.seq).map(({ layer: _l, seq: _s, ...t }, i) => ({ ...t, order: i }));
}

// The words on screen, one line per thing, in reading order. These are exact, so the judge never has to read pixels.
export function wordsOnScreen(things: Thing[], minOpacity = 0.2): string[] {
  const owners = new Map<string, Thing[]>();
  for (const t of things) if (t.kind === "text" && t.opacity >= minOpacity) owners.set(t.owner, [...(owners.get(t.owner) ?? []), t]);
  return [...owners.values()]
    .sort((a, b) => a[0]!.box.y0 - b[0]!.box.y0 || a[0]!.box.x0 - b[0]!.box.x0)
    .map((lines) => `${lines.map((l) => l.text).join(" ")}${lines[0]!.opacity < 0.7 ? ` (at ${Math.round(lines[0]!.opacity * 100)}% opacity)` : ""}`);
}

export type Read = { text: number; dim: number };
const READ: Read = { text: 0.03, dim: 0.5 };
export const readOf = (theme: Theme): Read => ({ ...READ, ...theme.style?.read });

const quote = (t: Thing) => `"${(t.text ?? t.id).slice(0, 40)}"`;

// What the compiled scene alone shows about a frame: no pixels needed. On a frame caught while things change, what is
// fading in or out is not judged as faint, dimmed or empty; writing over writing still counts, a little less.
export function measureLayout(things: Thing[], W: number, H: number, read: Read, changing = false): Finding[] {
  const out: Finding[] = [];
  const texts = things.filter((t) => t.kind === "text" && t.opacity >= 0.2);
  const frame: Rect = { x0: 0, y0: 0, x1: W, y1: H };

  const cut = texts.filter((t) => area(t.box) > 0 && 1 - area(meet(t.box, frame)) / area(t.box) > 0.04);
  if (cut.length) out.push({ kind: "off_frame", ids: cut.map((t) => t.id), severity: 3, note: `cut by the frame edge: ${cut.slice(0, 4).map((t) => `${quote(t)} (${Math.round((1 - area(meet(t.box, frame)) / area(t.box)) * 100)}% outside)`).join(", ")}` });

  const floor = read.text * Math.min(W, H);
  const small = texts.filter((t) => (t.size ?? floor) < floor * 0.92);
  if (small.length) out.push({ kind: "small_text", ids: small.map((t) => t.id), severity: small.some((t) => t.size! < floor * 0.7) ? 3 : 2, note: `below this style's smallest readable size (${Math.round(floor)} px on a ${W} px frame): ${small.slice(0, 5).map((t) => `${quote(t)} at ${Math.round(t.size!)} px`).join(", ")}` });

  const clash: string[] = [];
  const ids = new Set<string>();
  let solid = false;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const [a, b] = [texts[i]!, texts[j]!];
      if (a.owner === b.owner) continue;
      const share = area(meet(a.box, b.box)) / Math.max(1, Math.min(area(a.box), area(b.box)));
      if (share > 0.2) {
        if (a.opacity >= 0.75 && b.opacity >= 0.75) solid = true;
        clash.push(`${quote(a)} and ${quote(b)} (${Math.round(share * 100)}% of the smaller)`);
        ids.add(a.id).add(b.id);
      }
    }
  }
  if (clash.length) out.push({ kind: "overlap", ids: [...ids], severity: solid || !changing ? 3 : 2, note: `writing on top of writing: ${clash.slice(0, 4).join("; ")}` });

  // A picture with an opaque shape painted over most of it does not show.
  for (const img of things.filter((t) => t.kind === "image" && t.opacity > 0.3 && area(t.box) > W * H * 0.01)) {
    const over = things.find((s) => s.kind === "shape" && s.filled && s.order > img.order && area(meet(s.box, img.box)) > area(img.box) * 0.6);
    if (over) out.push({ kind: "hidden_picture", ids: [img.id, over.id], severity: 3, note: `the picture ${img.id} is under ${over.id}, which is painted over ${Math.round((area(meet(over.box, img.box)) / area(img.box)) * 100)}% of it` });
  }

  // Empty stretches: a coarse grid over the area content may use (the bottom is left for captions).
  const top = H * 0.047;
  const bottom = H * 0.812;
  const [cols, rows] = [9, 16];
  const content = things.filter((t) => t.opacity >= 0.15 && !(t.kind === "shape" && area(t.box) > W * H * 0.8));
  const used = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const cell: Rect = { x0: (c * W) / cols, x1: ((c + 1) * W) / cols, y0: top + (r * (bottom - top)) / rows, y1: top + ((r + 1) * (bottom - top)) / rows };
    return content.some((t) => area(meet(t.box, cell)) > area(cell) * 0.15);
  }));
  const filled = used.flat().filter(Boolean).length / (rows * cols);
  let band = 0;
  let run = 0;
  for (const row of used) {
    run = row.some(Boolean) ? 0 : run + 1;
    band = Math.max(band, run);
  }
  const bandShare = band / rows;
  if (!changing && (bandShare >= 0.3 || filled < 0.2)) out.push({ kind: "empty", ids: [], severity: bandShare >= 0.45 || filled < 0.12 ? 3 : 2, value: filled, note: `${Math.round(filled * 100)}% of the usable frame has anything in it; the largest empty band is ${Math.round(bandShare * 100)}% of its height` });

  // How much of what is on screen is stepped back.
  const weight = (t: Thing) => Math.min(area(meet(t.box, frame)), W * H * 0.25);
  const total = content.reduce((s, t) => s + weight(t), 0);
  const dim = content.filter((t) => t.opacity < Math.max(0.75, read.dim + 0.2) || t.muted).reduce((s, t) => s + weight(t), 0);
  const share = total ? dim / total : 0;
  if (!changing && share > 0.4) out.push({ kind: "dimmed", ids: [], severity: share > 0.65 ? 3 : 2, value: share, note: `${Math.round(share * 100)}% of what is on screen is dimmed or faded` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pixels: what the renderer really drew. Three renders of one frame: as is, with every word hidden, and with every word
// and picture hidden. Where the first two differ are the words' own pixels, and the second shows what lies behind them.

export type Pixels = { w: number; h: number; rgb: Uint8Array | Buffer };

export function decode(file: string, width?: number): Pixels {
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",").map(Number);
  const [w, h] = width ? [width, Math.round((probe[1]! * width) / probe[0]! / 2) * 2] : [probe[0]!, probe[1]!];
  const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
  return { w, h, rgb };
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export type TextInk = { ink: number; ratio: number; busy: number }; // ink: share of the box that changed when the words were hidden

// The words' own pixels in a box, and how they stand out from what is behind them.
export function inkOf(shown: Pixels, bare: Pixels, box: Rect, scale: number): TextInk {
  const x0 = Math.max(0, Math.floor(box.x0 * scale));
  const y0 = Math.max(0, Math.floor(box.y0 * scale));
  const x1 = Math.min(shown.w, Math.ceil(box.x1 * scale));
  const y1 = Math.min(shown.h, Math.ceil(box.y1 * scale));
  const changed: { d: number; i: number }[] = [];
  const backL: number[] = [];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * shown.w + x) * 3;
      n++;
      backL.push(luminance(bare.rgb[i]!, bare.rgb[i + 1]!, bare.rgb[i + 2]!));
      const d = Math.max(Math.abs(shown.rgb[i]! - bare.rgb[i]!), Math.abs(shown.rgb[i + 1]! - bare.rgb[i + 1]!), Math.abs(shown.rgb[i + 2]! - bare.rgb[i + 2]!));
      if (d > 24) changed.push({ d, i });
    }
  }
  if (!n) return { ink: 0, ratio: 21, busy: 0 };
  const mean = backL.reduce((a, b) => a + b, 0) / backL.length;
  const busy = Math.sqrt(backL.reduce((a, b) => a + (b - mean) ** 2, 0) / backL.length);
  if (changed.length < 4) return { ink: changed.length / n, ratio: 1, busy };
  // The strongest third of the changed pixels is the body of the letters, not their soft edges or glow.
  const core = changed.sort((a, b) => b.d - a.d).slice(0, Math.max(3, Math.ceil(changed.length / 3)));
  const avg = (px: Pixels) => core.reduce((s, { i }) => s + luminance(px.rgb[i]!, px.rgb[i + 1]!, px.rgb[i + 2]!), 0) / core.length;
  return { ink: changed.length / n, ratio: contrast(avg(shown), avg(bare)), busy };
}

// Findings from the three renders. `scale` maps frame pixels to the renders' pixels.
export function measurePixels(things: Thing[], shown: Pixels, bare: Pixels, empty: Pixels | undefined, W: number, changing = false): Finding[] {
  const scale = shown.w / W;
  const out: Finding[] = [];
  const owners = new Map<string, Thing[]>();
  for (const t of things) if (t.kind === "text" && t.opacity >= (changing ? 0.75 : 0.2)) owners.set(t.owner, [...(owners.get(t.owner) ?? []), t]);
  const faint: string[] = [];
  const covered: string[] = [];
  const busy: string[] = [];
  const ids = { faint: [] as string[], covered: [] as string[], busy: [] as string[] };
  let worst = 21;
  for (const [owner, lines] of owners) {
    const inks = lines.map((l) => ({ l, k: inkOf(shown, bare, l.box, scale) }));
    const ink = inks.reduce((s, x) => s + x.k.ink, 0) / inks.length;
    const ratio = Math.min(...inks.map((x) => x.k.ratio));
    const spread = Math.max(...inks.map((x) => x.k.busy));
    const name = `"${lines.map((l) => l.text).join(" ").slice(0, 40)}"`;
    const tiny = lines.every((l) => (l.box.x1 - l.box.x0) * scale < 6);
    if (tiny) continue;
    if (ink < 0.015) {
      covered.push(name);
      ids.covered.push(owner);
    } else if (ratio < 3) {
      faint.push(`${name} at ${ratio.toFixed(1)}:1`);
      ids.faint.push(owner);
      worst = Math.min(worst, ratio);
    }
    // An uneven background matters when the words do not stand well clear of it.
    if (spread > 0.12 && ink >= 0.015 && ratio < 4.5) {
      busy.push(name);
      ids.busy.push(owner);
    }
  }
  if (covered.length) out.push({ kind: "covered", ids: ids.covered, severity: 3, note: `on screen in the scene but not visible in the frame (hidden behind something, or the same color as what is behind it): ${covered.slice(0, 4).join(", ")}` });
  if (faint.length) out.push({ kind: "faint", ids: ids.faint, severity: worst < 2 ? 3 : 2, value: worst, note: `writing with too little contrast against what is behind it (3:1 is the least for large text): ${faint.slice(0, 5).join(", ")}` });
  if (busy.length) out.push({ kind: "busy_behind", ids: ids.busy, severity: 2, note: `writing over a busy, uneven background: ${busy.slice(0, 4).join(", ")}` });

  if (empty) {
    for (const img of things.filter((t) => t.kind === "image" && t.opacity > 0.3 && area(t.box) > W * W * 0.02)) {
      const b = img.box;
      let diff = 0;
      let n = 0;
      for (let y = Math.max(0, Math.floor(b.y0 * scale)); y < Math.min(bare.h, b.y1 * scale); y += 2) {
        for (let x = Math.max(0, Math.floor(b.x0 * scale)); x < Math.min(bare.w, b.x1 * scale); x += 2) {
          const i = (y * bare.w + x) * 3;
          diff += Math.abs(bare.rgb[i]! - empty.rgb[i]!) + Math.abs(bare.rgb[i + 1]! - empty.rgb[i + 1]!) + Math.abs(bare.rgb[i + 2]! - empty.rgb[i + 2]!);
          n++;
        }
      }
      if (n && diff / n / 3 < 4) out.push({ kind: "hidden_picture", ids: [img.id], severity: 3, note: `the picture ${img.id} is in the scene but nothing of it shows in the frame` });
    }
  }
  return out;
}

// A copy of a scene with some primitives turned invisible, for the comparison renders.
export function hide(scene: Scene, kinds: ("text" | "image")[]): Scene {
  const gone = new Set(scene.nodes.filter((n) => (kinds as string[]).includes(n.kind)).map((n) => n.id));
  return { ...scene, nodes: scene.nodes.map((n) => (gone.has(n.id) ? { ...n, props: { ...n.props, opacity: 0 } } : n)), tracks: scene.tracks.filter((t) => !(gone.has(t.target) && t.prop === "opacity")) };
}

// Same kind on one frame from both sources is one finding; the layout one keeps its ids, the pixel one its numbers.
export function merge(a: Finding[], b: Finding[]): Finding[] {
  const out = [...a];
  for (const f of b) {
    const same = out.find((x) => x.kind === f.kind);
    if (same) {
      same.severity = Math.max(same.severity, f.severity) as Finding["severity"];
      if (!same.note.includes(f.note)) same.note += `; ${f.note}`;
    } else out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Moments: enough frames to see each state settled and the changes between them.

export type Moment = { frame: number; why: "settled" | "changing"; words: string };

// `starts` are the frames where each state begins, `end` the section's last frame. Each state is seen settled, just
// before the next begins; changes are seen a short way into a state, while things arrive and leave. At most `max`.
export function lookFrames(starts: number[], first: number, end: number, fps: number, max = 12): { frame: number; why: Moment["why"] }[] {
  const s = [...new Set(starts.filter((f) => f >= first && f <= end))].sort((a, b) => a - b);
  if (!s.length || s[0]! > first + fps) s.unshift(first);
  const settled = s.map((f, i) => ({ frame: Math.max(f, Math.min(end, (s[i + 1] ?? end + 1) - 2)), why: "settled" as const }));
  const changing = s.slice(1).filter((f, i) => (s[i + 2] ?? end) - f > fps * 0.8).map((f) => ({ frame: Math.min(end, f + Math.round(fps * 0.35)), why: "changing" as const }));
  const pick = <T,>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, k) => xs[Math.round((k * (xs.length - 1)) / Math.max(1, n - 1))]!));
  const keep = pick(settled, Math.max(1, Math.min(settled.length, Math.ceil(max * 0.65))));
  const room = max - keep.length;
  const all = [...keep, ...pick(changing, Math.max(0, room))];
  const seen = new Set<number>();
  return all.sort((a, b) => a.frame - b.frame).filter((m) => !seen.has(m.frame) && seen.add(m.frame));
}

// ---------------------------------------------------------------------------------------------------------------------
// Judging and settling.

export const ISSUE_KINDS = ["readability", "overlap", "cut_off", "too_small", "empty", "washed_out", "broken", "picture", "words", "fact", "timing", "design"] as const;
export type Issue = { id: string; frames: number[]; kind: (typeof ISSUE_KINDS)[number] | "measured"; what: string; want: string; severity: 1 | 2 | 3; source: "seen" | "measured" };

export const judgeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["issues", "design", "designNote"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["frames", "kind", "what", "want", "severity"],
        properties: {
          frames: { type: "array", items: { type: "integer" } },
          kind: { type: "string", enum: [...ISSUE_KINDS] },
          what: { type: "string" },
          want: { type: "string" },
          severity: { type: "integer", enum: [1, 2, 3] },
        },
      },
    },
    design: { type: "integer", enum: [1, 2, 3, 4, 5] },
    designNote: { type: "string" },
  },
} as const;
export type Judged = { issues: Omit<Issue, "id" | "source">[]; design: number; designNote: string };

export const recheckSchema = {
  type: "object",
  additionalProperties: false,
  required: ["named", "issues", "design", "designNote", "better"],
  properties: {
    named: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "fixed", "note"], properties: { id: { type: "string" }, fixed: { type: "string", enum: ["yes", "partly", "no"] }, note: { type: "string" } } } },
    issues: judgeSchema.properties.issues,
    design: judgeSchema.properties.design,
    designNote: { type: "string" },
    better: { type: "string", enum: ["after", "before", "same"] },
  },
} as const;
export type Rechecked = { named: { id: string; fixed: "yes" | "partly" | "no"; note: string }[]; issues: Judged["issues"]; design: number; designNote: string; better: "after" | "before" | "same" };

// Measured findings worth fixing become issues in the same list as what Spark saw, so a fix sees them all at once.
export function issuesFrom(judged: Judged["issues"], measured: { frame: number; findings: Finding[] }[]): Issue[] {
  const out: Issue[] = judged.filter((x) => x.severity >= 2).map((x, i) => ({ ...x, id: `s${i + 1}`, source: "seen" as const }));
  const byKind = new Map<string, { frames: number[]; notes: string[]; severity: number }>();
  measured.forEach((m, k) => {
    for (const f of m.findings) {
      if (f.severity < 2) continue;
      const e = byKind.get(f.kind) ?? { frames: [], notes: [], severity: 0 };
      e.frames.push(k + 1);
      if (e.notes.length < 3) e.notes.push(`frame ${k + 1}: ${f.note}`);
      e.severity = Math.max(e.severity, f.severity);
      byKind.set(f.kind, e);
    }
  });
  let i = 0;
  for (const [kind, e] of byKind) out.push({ id: `m${++i}`, frames: e.frames, kind: "measured", what: `${kind.replace("_", " ")}: ${e.notes.join(" | ")}`, want: WANT[kind as FindingKind], severity: e.severity as Issue["severity"], source: "measured" });
  return out;
}

const WANT: Record<FindingKind, string> = {
  faint: "every word stands out clearly from what is behind it",
  covered: "words that are on screen can be seen",
  busy_behind: "words over a picture sit on something calm that keeps them readable",
  overlap: "no writing sits on other writing",
  off_frame: "everything stays inside the frame",
  small_text: "every word is at least the style's readable size",
  hidden_picture: "a picture that is on screen can be seen",
  empty: "the frame is used: what matters fills the space it has",
  dimmed: "only what has stopped mattering steps back, and the frame still looks lit",
};

// A score for a version: lower is better. Measured findings count by severity; seen issues the same.
export const weight = (list: { severity: number }[]) => list.reduce((s, x) => s + (x.severity >= 3 ? 3 : x.severity === 2 ? 1 : 0), 0);

// Keep the changed version only when it is better: fewer and lighter problems, measured and seen, with no new severe
// one, and the second look does not prefer the version before.
export function better(o: { measuredBefore: number; measuredAfter: number; seenBefore: number; seenAfter: number; newSevere: number; prefer: Rechecked["better"] }): boolean {
  if (o.newSevere > 0 || o.prefer === "before") return false;
  if (o.measuredAfter > o.measuredBefore) return false;
  const before = o.measuredBefore + o.seenBefore;
  const after = o.measuredAfter + o.seenAfter;
  return after < before || (after === before && o.prefer === "after");
}
