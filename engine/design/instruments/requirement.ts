// Requirement: for one requirement on a piece of the user's material (a PartCard), whether the required piece is on
// screen, how large it looks (visual angle of its shorter side), and for how long, clear of covers, the frame's edge and
// UI zones. Values only: whether "on screen for 3 s" or "legible" is met is the agent's reading of the requirement.
import type { Instrument, MeasureInput, PartCard, Reading, Requirement, Viewing } from "../types.ts";
import { UI, arcmin, covers, framesOf, round, sampled, windowOf, type Item } from "./sample.ts";
import { standing, type VisibilitySettings } from "./visibility.ts";

export type RequirementSettings = {
  requirement?: Requirement;
  card?: PartCard;
  /** The card's part the requirement is about; found from `requirement.applies` when absent. */
  part?: string;
  /** Scene ids that show the card (or the part); from the ids map by the card's name when absent. */
  target?: string[];
  perSecond: number;
  visibility: VisibilitySettings;
  why?: string;
};

/** The part a requirement is about: named in `applies` as "card.part" or "part", or in the source's place. */
export function partOf(req: Requirement | undefined, card: PartCard | undefined): string | undefined {
  if (!req || !card) return undefined;
  const keys = Object.keys(card.parts);
  for (const said of [req.applies, req.source.where]) {
    if (!said) continue;
    const tail = said.startsWith(`${card.name}.`) ? said.slice(card.name.length + 1) : said;
    if (keys.includes(tail)) return tail;
  }
  return undefined;
}

export const requirement: Instrument<RequirementSettings> = {
  name: "requirement",
  describe:
    "For a requirement on the user's material: is the required piece on screen, how large it looks, for how long. The piece is the card's part (its box inside the picture) or the whole card, found through the ids map by the card's name or `target`. " +
    "Values: seconds (clear on screen), share (of the window), angle (smallest visual angle of the piece's shorter side while shown, arcmin), meanAngle, covered, cut, ui (seconds), firstSeen (seconds from the window's start; -1 never). " +
    "Settings: requirement, card, part, target, perSecond, visibility (what counts as covered, cut, in a UI zone).",
  suggest: (v: Viewing) => ({ perSecond: 4, visibility: { perSecond: 4, covered: 0.5, cut: 0.04, ui: 0.25, backdrop: 0.8 }, why: `suggested for ${v.screen}; the requirement and card come from the material reader` }),
  measure(input: MeasureInput, set: RequirementSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const frames = framesOf(s.fps, range, set.perSecond);
    const dt = (range[1] - range[0]) / Math.max(1, frames.length) / s.fps;
    const card = set.card;
    const part = set.part ?? partOf(set.requirement, card);
    const target = set.target ?? (card ? (input.ids?.[part ? `${card.name}.${part}` : card.name] ?? input.ids?.[card.name] ?? []) : []);
    const box = part ? card?.parts[part]?.box : undefined;
    const zones = UI(input.viewing, s.W, s.H);
    let clear = 0;
    let cov = 0;
    let cut = 0;
    let ui = 0;
    let first = -1;
    const angles: number[] = [];
    for (const f of frames) {
      const all = s.items(f);
      const mine = all.filter((it) => target.some((x) => covers(x, it)));
      if (!mine.length) continue;
      // The part's box inside the picture, on the frame; or the target's own items.
      const pic = mine.find((it) => it.kind === "image");
      const shown: Item[] = box && pic ? [{ ...pic, box: { x0: pic.box.x0 + box[0] * (pic.box.x1 - pic.box.x0), x1: pic.box.x0 + box[2] * (pic.box.x1 - pic.box.x0), y0: pic.box.y0 + box[1] * (pic.box.y1 - pic.box.y0), y1: pic.box.y0 + box[3] * (pic.box.y1 - pic.box.y0) } }] : mine;
      const st = standing(shown, all, s.W, s.H, zones, set.visibility);
      if (st.covered) cov++;
      if (st.cut) cut++;
      if (st.ui) ui++;
      if (st.covered || st.cut || st.ui) continue;
      clear++;
      if (first < 0) first = (f - range[0]) / s.fps;
      const b = shown.reduce((r, t) => ({ x0: Math.min(r.x0, t.box.x0), y0: Math.min(r.y0, t.box.y0), x1: Math.max(r.x1, t.box.x1), y1: Math.max(r.y1, t.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      angles.push(arcmin(Math.min(b.x1 - b.x0, b.y1 - b.y0), input.viewing, s.W));
    }
    const seconds = clear * dt;
    const values = {
      seconds: round(seconds, 2),
      share: round(seconds / Math.max(1e-6, (range[1] - range[0]) / s.fps)),
      angle: round(angles.length ? Math.min(...angles) : 0, 1),
      meanAngle: round(angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : 0, 1),
      covered: round(cov * dt, 2),
      cut: round(cut * dt, 2),
      ui: round(ui * dt, 2),
      firstSeen: round(first, 2),
    };
    const what = card ? `${card.name}${part ? `.${part}` : ""}` : "the required piece";
    const notes = [
      set.requirement ? `${set.requirement.kind}: ${set.requirement.detail}` : "no requirement given",
      !target.length ? `${what}: no scene ids show it (the ids map names nothing for it)` : seconds ? `${what}: clear on screen ${seconds.toFixed(1)} s from ${first.toFixed(1)} s, its shorter side at least ${values.angle} arcmin` : `${what}: never clear on screen in this window`,
    ];
    if (box && !mine(frames, s, target)) notes.push(`${what}: the card's part has a box but no picture of it is on screen`);
    return { instrument: "requirement", values, notes };
  },
};

const mine = (frames: number[], s: ReturnType<typeof sampled>, target: string[]) => frames.some((f) => s.items(f).some((it) => it.kind === "image" && target.some((x) => covers(x, it))));
