// The engine contract. Kits, truth engines, styles and planners all meet here, so change it with care.
//
// A scene is a tree of nodes whose properties change over time. Kits expand rich things (a graph, a matrix, a photo)
// into four primitives, so anything a kit makes can be animated, styled and blended like anything else.

import type { Design } from "../style/design.ts";

export type Value = number | string | number[];
export type Props = Record<string, Value>;

// When something happens. Tied to a spoken word wherever possible, so visuals follow the voice if narration changes.
export type Moment = number | { word: number; offset?: number }; // a number is a frame

export type Ease = "linear" | "smooth" | "in" | "out" | "spring" | "bounce" | "step" | "anticipate" | "overshoot" | "swing" | "elastic";
export type Key = { at: number; value: Value; ease?: Ease };
// With no `blend` a track replaces the value. "add" and "multiply" tracks are offsets on top of it (engine/motion/compose.ts).
export type Track = { target: string; prop: string; keys: Key[]; blend?: "add" | "multiply" };

export type Primitive = "group" | "path" | "text" | "image";

// Everything the renderer reads beyond position, size and fade. All optional, all plain values, so all animate.
// Any paint (fill, stroke, color, background) may be a gradient string; see parseGradient in engine/core/evaluate.ts.
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity" | "plus-lighter";
export type RenderProps = {
  // Any primitive: order
  z: number; // order among siblings, higher in front
  layer: number; // not 0: lifted out of its group and drawn over (or, below 0, under) the whole scene
  // Any primitive: light and color
  blur: number; glow: number; glowColor: string; glowOpacity: number;
  shadowX: number; shadowY: number; shadowBlur: number; shadowColor: string; shadowOpacity: number;
  brightness: number; saturation: number; contrast: number; hue: number; tint: string; tintAmount: number;
  // Any primitive: compositing
  blend: BlendMode; isolate: number;
  clip: number[]; clipSmooth: number; feather: number; // a shape in the part's own coordinates
  mask: string; maskMode: "alpha" | "luminance"; maskInvert: number; // the id of the part to use as a matte
  // Paths and text
  strokeOpacity: number;
  // Paths
  d: string; fillOpacity: number; fillRule: "nonzero" | "evenodd";
  dash: number[]; dashOffset: number; lineCap: "round" | "butt" | "square"; lineJoin: "round" | "miter" | "bevel"; trimStart: number; trimEnd: number;
  // Text
  tracking: number;
  // Images
  crop: number[]; srcW: number; srcH: number; fit: "contain" | "cover" | "fill"; // crop is [x, y, w, h] as fractions
  shader: string; params: number[]; time: number; density: number; colorA: string; colorB: string; colorC: string;
};

// What a planner or kit writes. `kind` is a primitive or a kit's kind. A node's id may use dots to name its parts.
// `under`: drawn just beneath that node when it already exists, so a card added after its words still sits behind them.
export type NodeSpec = { id: string; kind: string; parent?: string; props?: Props; data?: Record<string, unknown>; under?: string };
export type SceneNode = { id: string; kind: Primitive; parent?: string; props: Props };

// One moment in a scene document. Everything is optional: a step can change one color or build a whole diagram.
export type Step = {
  at: Moment;
  add?: NodeSpec[];
  enter?: "fade" | "draw" | "pop" | "none";
  set?: Record<string, Props>;
  remove?: string[];
  // `blend: "add"` sums with moves already running instead of taking over. `stagger` delays each added or set target by that many frames.
  move?: { frames?: number; ease?: Ease; blend?: "takeover" | "add"; stagger?: number };
  play?: { behavior: string; target: string; args?: Record<string, Value> }[];
  emit?: SceneEvent[]; // for sound and other listeners
};

export type SceneEvent = { name: string; at?: number; data?: Record<string, unknown> };
export type SceneDoc = { background?: string; steps: Step[] };

export type Scene = { fps: number; width: number; height: number; frames: number; background: string; nodes: SceneNode[]; tracks: Track[]; events: SceneEvent[] };

// Tree of nodes with every property worked out for one frame. This is all a renderer sees.
export type Resolved = { id: string; kind: Primitive; props: Props; children: Resolved[] };

export type Theme = {
  colors: Record<string, string>; // named colors, such as ink, accent, highlight, paper
  fonts: { title: string; body: string; mono?: string };
  moveFrames: number; // how long a change takes by default
  ease: Ease; // how motion feels in this style
  enter?: "fade" | "draw" | "pop"; // how things arrive when a step does not say
  style?: StyleSpec; // how this style draws. Without it, things are drawn plainly
  roles?: Partial<Record<Role, RoleLook>>; // how this style shows each role; a scene names the role, the style decides the look
  design?: Design; // the style's design layer (engine/style/design.ts): surfaces, panels, captions, tables, dimming, pictures
};

// What a thing is for, so a scene says the meaning and the style decides the look. Spark picks a role; it does not
// pick colors, glows or cards. A style must define every role so that any pairing it allows stays readable.
export const ROLES = [
  "title", // the one main line of a moment
  "heading", // a section or step name
  "body", // ordinary words and values
  "label", // names things on a diagram or picture
  "note", // a quiet aside
  "key", // what the viewer must look at now
  "answer", // a result the moment arrives at
  "muted", // context that stays but steps back
  "wrong", // a mistake, a crossed-out idea
  "code", // code and literal values
  "panel", // a surface that groups things (a card, a strip, a board inside the board)
  "caption", // words over a picture, always on something that keeps them readable
  "pointer", // arrows, rings and marks that direct the eye
] as const;
export type Role = (typeof ROLES)[number];
// A role's look in one style. Colors are theme color names; sizes are shares of the frame's shorter side.
export type RoleLook = {
  color?: string;
  back?: string; // the surface it sits on, if it brings its own
  size?: number;
  weight?: number;
  font?: "title" | "body" | "mono";
  case?: "asis" | "upper";
  glow?: number; // 0 to 1
  opacity?: number; // for muted: how far back it steps (a style may instead change color, blur or thin the line)
  stroke?: number; // line weight multiplier, for pointers and panels
};

// How a style draws: a renderer, not a color filter. Written by hand or by a model, see engine/style/format.ts.
export type Pen = "vector" | "marker" | "ink" | "chalk" | "drafting" | "neon";
export type LineStyle = {
  pen: Pen;
  weight: number; // multiplies every stroke width
  wobble: number; // how far a hand strays from the true line, in pixels. Fixed per object, so lines never crawl
  pressure: number; // 0 to 1: how much the width swells and tapers
  nib: number; // 0 to 1: how much the width depends on direction, like a chisel tip
  passes: number; // 1 to 3: how many times a line is gone over
  grain: number; // 0 to 1: how much a dry stick breaks the line up
  glow: number; // 0 to 1: light around the line
  overshoot: number; // pixels a faint construction line runs past each end
};
export type FillKind = "solid" | "hatch" | "scribble" | "wash";
export type FillStyle = {
  kind: FillKind;
  base: number; // 0 to 1: how solid the color is under the texture. Words sit on this, so it stays high
  spacing: number; // pixels between hatch or scribble strokes
  angle: number; // degrees
  cross: number; // 0 or 1: hatch a second time across
  offset: number; // pixels the color sits off its outline, like a misprint
  shadow: number; // pixels of hard shadow under a colored shape
  glow: number; // 0 to 1: light around a colored shape
  outline: number; // 0 to 1: how much outline a colored shape keeps
};
export type SurfaceKind = "plain" | "paper" | "slate" | "board" | "blueprint" | "night";
export type SurfaceStyle = {
  kind: SurfaceKind;
  grain: number; // 0 to 1: fine tooth of the surface
  smudge: number; // 0 to 1: broad marks left on the surface
  light: number; // 0 to 1: soft pool of light in the middle
  grid: number; // pixels between grid lines, 0 for none
  major: number; // every how many grid lines one is stronger, 0 for none
};
export type TypeStyle = {
  title: string; // CSS font stacks, so a missing font falls back to something readable
  body: string;
  mono: string;
  bold: number; // what weight 700 becomes, for fonts with no bold of their own
  tracking: number; // extra letter spacing, as a share of the font size
  case: "asis" | "upper";
  jitter: number; // 0 to 1: letters sit slightly off the line, as if written by hand
  grain: number; // 0 to 0.5: dryness of the letters. Kept low, because words must stay clear
  glow: number; // 0 to 1
};
export type MotionFeel = "springy" | "calm" | "snappy" | "steady";
export type MotionStyle = { feel: MotionFeel; frames: number; ease: Ease; enter: "fade" | "draw" | "pop" };
// What keeps a frame readable. A scene may override either for itself.
export type ReadStyle = {
  text: number; // the smallest text, as a share of the frame's shorter side. Nothing the engine places is drawn smaller
  dim: number; // 0 to 1: the lowest opacity that dim and focus take the rest of the frame to, so it stays readable
};
export type StyleSpec = { line: LineStyle; fill: FillStyle; surface: SurfaceStyle; type: TypeStyle; motion: MotionStyle; read?: ReadStyle };

export type CompileContext = {
  fps: number;
  width: number;
  height: number;
  frames: number;
  theme: Theme;
  words?: { start: number }[];
  kits?: Kit[];
  measure?: TextMeasure;
};

// A kit adds kinds of thing and behaviors. It can never add a new primitive, which is what keeps everything blendable.
export type Kit = {
  name: string;
  kinds?: Record<string, (node: NodeSpec, ctx: CompileContext) => NodeSpec[]>;
  behaviors?: Record<string, Behavior>;
  docs?: Record<string, string>; // one line each for kinds and behaviors, so the language guide can teach them to a planner
};
export type Behavior = ((a: { target: string; start: number; args: Record<string, Value>; ctx: CompileContext; now: (prop: string) => Value | undefined; tools: MotionTools }) => Track[]) & {
  selects?: boolean; // takes a whole pattern such as "g.node.*" as its target, instead of running once per match
};

// Reads the finished scene while constraints are solved, so a follower can see moves written after it.
export type Reader = { value: (id: string, prop: string, frame: number) => Value | undefined; matrix: (id: string, frame: number) => number[] };
// A property worked out from other things, frame by frame, from `start` to `end`. Pure: it may only use what it is given.
export type Constraint = { target: string; props: string[]; start: number; end: number; solve: (frame: number, read: Reader, own: (prop: string) => Value | undefined) => Record<string, Value> };

// What a behavior can ask of the scene while it is compiled. `value` and `matrix` see what has been written so far.
export type MotionTools = {
  select: (pattern: string) => string[]; // "*" is one dotted part, "**" is any depth
  has: (id: string) => boolean;
  kind: (id: string) => Primitive;
  parent: (id: string) => string | undefined;
  props: (id: string) => Props; // what it starts as, before any track
  children: (id: string) => string[];
  value: (id: string, prop: string, frame: number) => Value | undefined;
  matrix: (id: string, frame: number) => number[];
  spawn: (node: NodeSpec, place?: { before?: string }) => void; // adds a part with no entrance
  run: (behavior: string, target: string, start: number, args?: Record<string, Value>) => void;
  write: (track: Track) => void;
  constrain: (c: Constraint) => void;
  emit: (event: SceneEvent) => void;
};

// A truth engine does real work and reports what happened, in order. Animations follow this record, so they cannot lie.
export type TruthEvent<T = Record<string, unknown>> = { type: string } & T;

// Real text measurement, in ems. `clusters` are the pieces drawn on their own, and `edges` holds the kerned width up to
// the end of each. Compile may pass its own measure; otherwise kits ask the browser that renders the video.
export type MeasureRequest = { clusters: string[]; font: string; weight: number };
export type Measured = { edges: number[]; ascent: number; descent: number };
export type TextMeasure = (request: MeasureRequest) => Measured;
// What the understanding loop hands to repair. It says what went wrong and when, in words a repairer can act on. It never
// says how to teach: `wrong` describes the failure for a viewer, and the fix is the repairer's choice.
export type TicketProblem =
  | "not_shown" // the thing being spoken about cannot be found on screen
  | "left_screen" // something the viewer needs right now has gone
  | "frozen" // the voice has moved on and the screen has not
  | "competing" // the screen pulls attention away from what is being said
  | "unreadable" // it is there but cannot be read or made out
  | "viewer_lost" // a sound-off viewer stopped being able to follow
  | "idea_missing" // an idea in the script never reached the sound-off viewer
  | "not_learned" // a first-time learner failed a quiz question on this
  | "false_claim" // the screen says something wrong
  | "unsupported_claim"; // the screen says something nothing backs up

export type RepairTicket = {
  reviewer: "sound_off" | "learner" | "truth" | "sequence";
  problem: TicketProblem;
  at: Moment; // tied to a spoken word, so a ticket survives a change of timing
  until: Moment;
  from: number; // seconds in this cut, for a person reading the report
  to: number;
  said: string; // what the voice says here
  seen: string; // what is on screen here
  wrong: string; // what fails for the viewer
  severity: 1 | 2 | 3; // 3 stops understanding, 1 is a blemish
};
