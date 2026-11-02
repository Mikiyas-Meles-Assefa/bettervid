// The engine contract. Kits, truth engines, styles and planners all meet here, so change it with care.
//
// A scene is a tree of nodes whose properties change over time. Kits expand rich things (a graph, a matrix, a photo)
// into four primitives, so anything a kit makes can be animated, styled and blended like anything else.

export type Value = number | string | number[];
export type Props = Record<string, Value>;

// When something happens. Tied to a spoken word wherever possible, so visuals follow the voice if narration changes.
export type Moment = number | { word: number; offset?: number }; // a number is a frame

export type Ease = "linear" | "smooth" | "in" | "out" | "spring" | "bounce" | "step";
export type Key = { at: number; value: Value; ease?: Ease };
export type Track = { target: string; prop: string; keys: Key[] };

export type Primitive = "group" | "path" | "text" | "image";

// What a planner or kit writes. `kind` is a primitive or a kit's kind. A node's id may use dots to name its parts.
export type NodeSpec = { id: string; kind: string; parent?: string; props?: Props; data?: Record<string, unknown> };
export type SceneNode = { id: string; kind: Primitive; parent?: string; props: Props };

// One moment in a scene document. Everything is optional: a step can change one color or build a whole diagram.
export type Step = {
  at: Moment;
  add?: NodeSpec[];
  enter?: "fade" | "draw" | "pop" | "none";
  set?: Record<string, Props>;
  remove?: string[];
  move?: { frames?: number; ease?: Ease };
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
export type StyleSpec = { line: LineStyle; fill: FillStyle; surface: SurfaceStyle; type: TypeStyle; motion: MotionStyle };

export type CompileContext = {
  fps: number;
  width: number;
  height: number;
  frames: number;
  theme: Theme;
  words?: { start: number }[];
  kits?: Kit[];
};

// A kit adds kinds of thing and behaviors. It can never add a new primitive, which is what keeps everything blendable.
export type Kit = {
  name: string;
  kinds?: Record<string, (node: NodeSpec, ctx: CompileContext) => NodeSpec[]>;
  behaviors?: Record<string, Behavior>;
};
export type Behavior = (a: { target: string; start: number; args: Record<string, Value>; ctx: CompileContext; now: (prop: string) => Value | undefined }) => Track[];

// A truth engine does real work and reports what happened, in order. Animations follow this record, so they cannot lie.
export type TruthEvent<T = Record<string, unknown>> = { type: string } & T;
