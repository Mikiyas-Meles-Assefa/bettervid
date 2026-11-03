// What a depicted object does in place: any verb the author wrote, as its depiction declares it (d.act), written as
// timed property changes; and a value written beside a thing whose reading changes (a clock that runs). Every duration
// and size is a parameter.
import type { ActResult, PropSpec, StateValue, Timing } from "../depict/index.ts";
import { putChanges, type Placed } from "./flow.ts";
import type { Writer } from "./writer.ts";

/** The author's verb acted out by the depiction from frame `at`; an unknown verb is returned, not guessed. */
export function actOn(w: Writer, p: Placed, verb: string, arg: StateValue | undefined, at: number, timing: Timing, stretch = 1): ActResult {
  let r: ActResult;
  try {
    r = p.d.act(verb, arg, timing);
  } catch (e) {
    return { known: false, verb, notes: [(e as Error).message] };
  }
  if (r.known) putChanges(w, r.changes, at, stretch);
  return r;
}

/** A color the depicter named for the thing (the material's facts), by the author's words; undefined when not named. */
export function colorNamed(spec: PropSpec | undefined, name: string | undefined): string | undefined {
  if (!spec || !name) return undefined;
  const c = spec.colors ?? {};
  const k = Object.keys(c).find((x) => x.toLowerCase() === name.toLowerCase().trim());
  return k ? c[k] : /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(name.trim()) ? name.trim() : undefined;
}

/** A value written under a thing (what a clock now reads), shown from `at` until `until`. */
export function valueLabel(w: Writer, label: string, at: { x: number; y: number }, text: string, from: number, until: number, p: { fs: number; fade: number }) {
  w.put(label, "text", text, from);
  w.put(label, "x", at.x, from);
  w.put(label, "y", at.y + p.fs * 0.8, from);
  w.put(label, "scaleX", p.fs / 100, from);
  w.put(label, "scaleY", p.fs / 100, from);
  w.put(label, "opacity", 1, from, p.fade, "out");
  w.put(label, "opacity", 0, until, p.fade, "in");
}
