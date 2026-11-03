// Ask with a placeholder: a question to the viewer, and a "?" standing in the slot the answer will take, which waits
// (a slow pulse) and dips away just before the answer arrives.
import type { St } from "./types.ts";
import type { Writer } from "./writer.ts";

export const PLACEHOLDER = "?";

export function placeholderWait(w: Writer, id: string, at: number, p: { size: number; frames: number }) {
  w.play(at, id, "pulse", { size: p.size, frames: p.frames });
}

/** The placeholder dips (shrinks a little) and fades as the answer takes its slot. Returns the frame the slot is free. */
export function placeholderDip(w: Writer, id: string, st: St, at: number, p: { shrink: number; frames: number }) {
  w.put(id, "scaleX", st.s * p.shrink, at, p.frames, "out");
  w.put(id, "scaleY", st.s * p.shrink, at, p.frames, "out");
  w.put(id, "opacity", 0, at + p.frames, Math.max(1, Math.round(p.frames * 0.8)), "in");
  return at + p.frames;
}
