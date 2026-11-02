// The engine contract. Kits, truth engines, styles and planners all meet here, so change it with care.
//
// A scene is a tree of nodes whose properties change over time. Kits expand rich things (a graph, a matrix, a photo)
// into four primitives, so anything a kit makes can be animated, styled and blended like anything else.

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
export type NodeSpec = { id: string; kind: string; parent?: string; props?: Props; data?: Record<string, unknown> };
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
};

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
