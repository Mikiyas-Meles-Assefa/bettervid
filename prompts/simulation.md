You write one small simulation for a vertical explainer video. It runs real rules, so what the viewer sees emerges from those rules and is not drawn by hand. It is drawn on a 1080 by 1920 canvas at 30 frames per second.

Reply with one JavaScript module and nothing else, in this shape:

export default {
  setup({ width, height, rng, kit }) { return state; },
  step(state, { t, dt, rng, cues }) { },
  draw(state, kit, { t, cues }) { },
  measure(state) { return { name: number }; },
};

- `setup` creates the starting state. `step` runs once per frame in order and changes `state`. `draw` only draws and must not change `state`.
- `measure` returns the one to three numbers that prove the idea is happening. It is read once per second, with no drawing, to check the simulation behaves as asked, so choose numbers that would look different if it were wrong.
- `t` is the time in seconds and `dt` is 1/30. `cues` maps each cue name to the second it happens: compare `t` against it to change what happens, so the change lands exactly on the spoken word.
- Use `rng()` for all randomness; it returns a number from 0 to 1 and gives the same sequence every run. Never use Math.random, Date, timers, fetch, import, eval, document or window.
- Draw only with `kit`, which belongs to the video's style. Never pick your own colors or fonts:
  - `kit.background()` fills the frame; call it first.
  - `kit.dot(x, y, r, { color })`, `kit.ring(x, y, r, { color, width })`, `kit.line(x1, y1, x2, y2, { color, width })`, `kit.path(points, { color, width })` where points is an array of [x, y], `kit.label(text, x, y, { size, color, align })`.
  - `color` is one of "ink", "accent", "highlight", "paper". "highlight" is pale, so never use it for a label.
- The story's timing comes first. If the real process is slower or faster than the narration, tune it (the starting conditions, the strength of an effect, several rule updates per frame) until what the viewer should see happens at the cues, while the rules stay real.
- Nothing is on screen before the cue that introduces it. Until then, draw only what the brief says already exists; a result appears at the step that produces it.
- A result is always computed, every frame, from the same values you draw for its inputs, using the real operation, so it is correct at every moment, including while things move. Never fade, scale or swap a result toward the outcome you want: change the inputs and let the result follow. `measure` reads those same values.
- Keep everything inside `kit.safe`, an object { x, y, w, h }: the rest of the frame belongs to the captions.
- It will be seen on a phone, once, while someone talks: one clear idea, big shapes, strong contrast, very few words on screen, no label under 48 px, and the picture fills most of `kit.safe`. Show the important thing in "accent".
- Keep it fast: every frame must take well under 10 ms.
