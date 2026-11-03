// What good means for one case. The measures are instruments: every threshold they score against is a setting read
// from here, never a constant in the code. A case declares its viewing context and any departure from the defaults in
// its `measure` block (written once per case, by a person or by an agent reading the request, intent, audience and
// platform, and recorded in the case file). Anything a case leaves out takes the default.
//
// The defaults are the derived settings for teaching on a phone: a 9:16 frame held at arm's length, the eye meant to be
// on the event's look, every silence working toward its purpose. Other intents change what they need to: a suspense beat
// may hide its subject (`look.hidden`), a deliberate still hold is declared still (`holds.still`), a frame meant for a
// TV or a desk changes `read`.

export type Context = {
  screen: string; // where it is watched: "phone", "laptop", "classroom screen", "tv"
  frame: string; // the frame's shape: "9:16", "16:9"
  distance: string; // how far the eye is, in words: "arm's length", "across a classroom"
  attention: string; // how the viewer watches: "glancing in a feed", "watching on purpose", "paused and studied"
  why: string; // what in the request, intent or audience says so
};

export type Settings = {
  derived?: string; // how the case came to these settings, in words
  context: Context;
  read: {
    small: number; // text height as a share of the frame's width that cannot be read at a glance (scores 0)
    comfortable: number; // text height that reads comfortably (scores 1)
    contrastLow: number; // WCAG ratio that cannot be read (0)
    contrastOk: number; // ratio that reads well (1)
    glance: number; // characters on screen that read at a glance
    page: number; // characters that make a page (density 0)
    pictureLow: number; // a picture's width share at which its detail is lost (0)
    pictureFull: number; // width share at which it reads in full (1)
    pictureWeight: number; // a picture counts as this many characters of words
    subject: number; // share of the usable frame the look should cover for full marks
    filledLow: number; // share of the usable frame in use below which the frame reads as empty (0)
    filledFull: number; // share in use that reads as full (1)
    band: number; // tallest empty band (share of height) that costs nothing
    bandSpan: number; // how much more band takes the space term to 0
    layoutFloor: number; // the frame score's share kept when the words read but the layout fails (0.5: half)
    weights: { density: number; subject: number; space: number }; // the layout's parts, summing to 1
    broken: number; // factor for a frame with words cut, written over or a covered picture
  };
  look: { hidden: string[] }; // events whose look is meant to stay hidden or still (eye skips them)
  lag: { before: number; after: number; late: number; full: number; half: number }; // seconds
  load: { newLine: number; pullLine: number }; // new things within two seconds, independent pulls within one
  pace: { varied: number }; // spread of change rates that counts as varied when the plan mixes long and short
  holds: {
    work: number; // share of a hold's frames working on its purpose that earns full marks
    distracted: number; // factor when unrelated change outweighs related change
    still: string[]; // holds meant to be still: they score on nothing unrelated moving, not on change
  };
  depict: { symbol: number; watchWeight: number }; // a bare symbol's score; the watch test's weight in the blend
};

export const DEFAULTS: Settings = {
  context: { screen: "phone", frame: "9:16", distance: "arm's length", attention: "glancing in a feed", why: "the default: a short vertical video watched on a phone" },
  // A 1080 px frame is about 65 mm across on a phone, so 1 px is about 0.06 mm: text of 7% of the width (75 px) reads at a
  // glance at 40 cm, 3.5% (38 px) does not.
  read: { small: 0.035, comfortable: 0.07, contrastLow: 1.5, contrastOk: 4.5, glance: 140, page: 360, pictureLow: 0.5, pictureFull: 0.95, pictureWeight: 40, subject: 0.3, filledLow: 0.12, filledFull: 0.45, band: 0.2, bandSpan: 0.35, layoutFloor: 0.5, weights: { density: 0.3, subject: 0.35, space: 0.35 }, broken: 0.4 },
  look: { hidden: [] },
  lag: { before: 0.5, after: 1, late: 3, full: 1, half: 2 },
  load: { newLine: 6, pullLine: 3 },
  pace: { varied: 0.4 },
  holds: { work: 0.5, distracted: 0.5, still: [] },
  depict: { symbol: 0.5, watchWeight: 0.6 },
};

type Deep<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? Deep<T[K]> : T[K] };
export type CaseSettings = Deep<Settings>;

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
  return out as T;
}

export const settingsOf = (c: { measure?: CaseSettings }): Settings => merge(DEFAULTS, c.measure);
