// Legibility: each piece of text as the viewer's eye receives it. Size becomes visual angle from how wide the frame looks
// (frameWidthMm at distanceMm), so the same pixels read differently on a phone at arm's length, a laptop and a TV across
// a room. Contrast is taken after every fade, against what is drawn behind the text's center. Reported per piece and
// as shares weighted by length; a long line of faint small words weighs more than a one-word tag.
//
// Basis: reading speed holds above a critical print size of about 0.2 degrees of x-height (Legge et al. 1985, Legge
// 2007), and text read at a glance, as in a feed, needs more; WCAG 2 gives 3:1 for large text and 4.5:1 for body text.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { arcmin, area, framesOf, mean, meet, round, sampled, windowOf } from "./sample.ts";

export type LegibilitySettings = {
  perSecond: number;
  readable: number; // arcminutes of cap height under which a piece counts in shareBelow
  contrastLow: number; // WCAG ratio under which a piece counts as faint
  capHeight: number; // the font's cap height as a share of its size (a font metric; 0.7 for most text faces)
  minOpacity: number; // pieces fainter than this are arriving or leaving, not read
  why?: string;
};

export function suggestLegibility(v: Viewing): LegibilitySettings {
  const glance = /glanc|feed|scroll|background|passing/i.test(v.watch);
  return {
    perSecond: 4,
    readable: glance ? 27 : 18,
    contrastLow: 3,
    capHeight: 0.7,
    minOpacity: 0.5,
    why: glance
      ? `suggested for ${v.watch}: text read in passing needs about 27 arcmin of cap height (the bench's 7% of a phone frame's width at arm's length), and 3:1 contrast at the least (WCAG large text)`
      : `suggested for ${v.watch}: reading on purpose holds its speed above about 18 arcmin of cap height (critical print size, Legge 2007), and 3:1 contrast at the least`,
  };
}

export const legibility: Instrument<LegibilitySettings> = {
  name: "legibility",
  describe:
    "Every piece of text as the eye receives it: cap height as visual angle (arcminutes) from the frame's physical width and viewing distance, and WCAG contrast after fades against what is behind it. " +
    "Values: chars (characters read, summed over sampled frames), minAngle and medianAngle (arcmin), shareBelow (share of characters under the `readable` angle), faintShare (share under `contrastLow`), minContrast, overPicture (share of characters over a picture, contrast unknown), cut (share cut by the frame edge), sizes (distinct text sizes on a frame, mean). " +
    "Settings: readable, contrastLow, capHeight, minOpacity, perSecond.",
  suggest: suggestLegibility,
  measure(input: MeasureInput, set: LegibilitySettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const frames = framesOf(s.fps, range, set.perSecond);
    const frame = { x0: 0, y0: 0, x1: s.W, y1: s.H };
    let chars = 0;
    let below = 0;
    let faint = 0;
    let over = 0;
    let cut = 0;
    const angles: number[] = [];
    const contrasts: number[] = [];
    const sizes: number[] = [];
    const small = new Map<string, number>();
    const pale = new Map<string, number>();
    const series: Reading["series"] = [];
    for (const f of frames) {
      const texts = s.items(f).filter((t) => t.kind === "text" && t.opacity >= set.minOpacity && (t.text ?? "").trim());
      sizes.push(new Set(texts.map((t) => Math.round((t.size ?? 0) / 2))).size);
      let fmin = Infinity;
      for (const t of texts) {
        const n = (t.text ?? "").replace(/\s+/g, "").length;
        const angle = arcmin((t.size ?? 0) * set.capHeight, input.viewing, s.W);
        chars += n;
        angles.push(angle);
        fmin = Math.min(fmin, angle);
        if (angle < set.readable) {
          below += n;
          const k = `"${(t.text ?? "").slice(0, 28)}"`;
          small.set(k, Math.min(small.get(k) ?? Infinity, angle));
        }
        if (t.contrast === undefined) over += n;
        else {
          contrasts.push(t.contrast);
          if (t.contrast < set.contrastLow) {
            faint += n;
            const k = `"${(t.text ?? "").slice(0, 28)}"`;
            pale.set(k, Math.min(pale.get(k) ?? Infinity, t.contrast));
          }
        }
        if (area(t.box) > 0 && 1 - area(meet(t.box, frame)) / area(t.box) > 0.04) cut += n;
      }
      series.push({ frame: f, values: { minAngle: round(Number.isFinite(fmin) ? fmin : 0, 1), texts: texts.length } });
    }
    const sorted = [...angles].sort((a, b) => a - b);
    const values = {
      minAngle: round(sorted[0] ?? 0, 1),
      medianAngle: round(sorted[Math.floor(sorted.length / 2)] ?? 0, 1),
      shareBelow: round(chars ? below / chars : 0),
      faintShare: round(chars ? faint / chars : 0),
      minContrast: round(contrasts.length ? Math.min(...contrasts) : 0, 2),
      chars,
      overPicture: round(chars ? over / chars : 0),
      cut: round(chars ? cut / chars : 0),
      sizes: round(mean(sizes), 1),
    };
    const notes: string[] = [];
    if (!chars) notes.push("no text on screen in this window");
    if (small.size) notes.push(`under ${set.readable} arcmin: ${[...small].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([k, a]) => `${k} ${a.toFixed(0)}`).join(", ")}`);
    if (pale.size) notes.push(`under ${set.contrastLow}:1: ${[...pale].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([k, c]) => `${k} ${c.toFixed(1)}:1`).join(", ")}`);
    if (over) notes.push(`${Math.round(values.overPicture * 100)}% of the characters sit over a picture, whose contrast the scene cannot know`);
    return { instrument: "legibility", values, notes, series };
  },
};
