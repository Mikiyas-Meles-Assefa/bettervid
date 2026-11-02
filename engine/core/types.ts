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
};

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
};
export type Behavior = (a: { target: string; start: number; args: Record<string, Value>; ctx: CompileContext; now: (prop: string) => Value | undefined }) => Track[];

// A truth engine does real work and reports what happened, in order. Animations follow this record, so they cannot lie.
export type TruthEvent<T = Record<string, unknown>> = { type: string } & T;

// Real text measurement, in ems. `clusters` are the pieces drawn on their own, and `edges` holds the kerned width up to
// the end of each. Compile may pass its own measure; otherwise kits ask the browser that renders the video.
export type MeasureRequest = { clusters: string[]; font: string; weight: number };
export type Measured = { edges: number[]; ascent: number; descent: number };
export type TextMeasure = (request: MeasureRequest) => Measured;
