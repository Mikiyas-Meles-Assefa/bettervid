// The Project JSON: one file per run. Each pipeline stage reads earlier fields and writes its own.
// Types here are the contract between stages; the JSON Schemas below are what the models must return.

export type StageName = "plan" | "research" | "writer" | "voice" | "director" | "assets" | "annotate" | "art" | "cutouts" | "timeline" | "mix" | "render" | "critic";

export type Project = {
  id: string;
  createdAt: string;
  input: Input;
  plan?: Plan;
  factSheet?: FactSheet;
  writing?: WritingStep[]; // the writer's prose at each step (draft, cut, review), kept for the trail
  script?: Script;
  narration?: Narration;
  shots?: Shot[];
  assets?: Asset[];
  timeline?: Timeline;
  render?: { path: string; ms: number };
  critic?: { verdict: string; tickets: { shotId: string; action: string; note: string }[] };
  // Cache: the hash of each stage's inputs when it last ran, so unchanged stages are skipped.
  stages: Partial<Record<StageName, { hash: string; at: string; ms: number }>>;
  costs: Cost[];
};

export type Input = {
  prompt: string;
  style: string; // a file in styles/, e.g. "collage"
  persona: string; // a file in personas/: who narrates, in what voice; "auto" lets the writer choose
  mode: "explain" | "history" | "math" | "story";
  seconds: number; // target length; 0 means as long as the story needs
};

// Stage 0: plan. What the user explicitly asked for in their message, sorted by which part of the work it concerns.
// Empty fields mean the user said nothing about it and each stage decides the usual way.
export type Plan = {
  topic: string;
  seconds: number; // 0 = not said; when set, it wins over input.seconds
  story: string[]; // content and structure: what to cover or skip, how to open, what to reveal when, how to end, who it is for
  tone: string;
  visuals: string[];
  sound: string[];
  material: string; // notes, facts or sources the user supplied, verbatim
};

export type Cost = { stage: StageName; usd: number; detail: string; at: string };

// Stage 1: research
export type Source = { id: string; title: string; publisher: string; url: string; date?: string };
export type Claim = { id: string; text: string; number?: string; quote?: string; sourceIds: string[]; confidence: "high" | "medium" | "low" };
// `story` is the sourced account of what happened, in order, with claim ids inline ([c3]), so the writer has a story
// to tell and not just a list of facts.
export type FactSheet = { topic: string; angle: string; misconception?: string; story: string; claims: Claim[]; sources: Source[] };

// Stage 2: writer
// What a beat does for the viewer. A vocabulary, not a template: the writer uses whichever the story needs.
export type BeatRole = "hook" | "setup" | "explain" | "example" | "but" | "therefore" | "twist" | "reveal" | "ending";
export type Beat = {
  id: string;
  role: BeatRole;
  text: string; // exactly what the narrator says
  claimIds: string[];
  visual: string; // the one visual this beat calls for, concrete
  emphasis: string[]; // words to highlight in captions
};
export type Script = { title: string; takeaway: string; beats: Beat[] };
// `notes`: for a cut, the thread and what was left out; for a review, the issues it fixed.
export type WritingStep = { step: "draft" | "cut" | "review"; title: string; takeaway: string; narration: string; notes: string[]; key?: string }; // key: hash of the writer inputs, for resuming

// Stage 3: voice
export type Word = { text: string; start: number; end: number; beatId: string };
export type Narration = { audio: string; voiceId: string; model: string; seconds: number; words: Word[] };

// Stage 4: director (shot types are the build order in docs/PLAN.md section 5)
export type ShotType = "photo_kenburns" | "cutout_on_paper" | "receipt" | "kinetic_title" | "credits";
export type Shot = {
  id: string;
  beatId: string;
  type: ShotType;
  start: number; // seconds, snapped to word times
  end: number;
  asset?: AssetRequest;
  text?: string; // kinetic_title words, receipt quote
  receipt?: { outlet: string; date?: string; url: string; quote: string };
};
// `focus`: the part of the image the narration is talking about ("the brewery"); the shot zooms to it and circles it.
// `mustBeReal`: a real document, map, person or place (or the user asked for real images only), so no generated stand-in.
// `idea`: an honest illustration of the idea behind a must-be-real shot, with no likeness or fake document, for when the real thing cannot be found.
export type ImageType = "scene" | "object" | "diagram";
export type AssetRequest = { kind: "real" | "generated"; query: string; broadQuery?: string; prompt: string; idea?: string; imageType?: ImageType; subject?: string; focus?: string; mustBeReal?: boolean };
// A drawn mark. Points are fractions of the image; `word` is the index of the spoken word it starts on.
export type MarkTool = "ring" | "box" | "underline" | "arrow" | "line" | "dots" | "label" | "path";
export type Mark = { tool: MarkTool; points: [number, number][]; word: number; text?: string; color?: "accent" | "highlight" };
export type TimedMark = Mark & { frame: number }; // frame inside its clip
export type Box = { x: number; y: number; w: number; h: number }; // fractions of the image size

// Stages 5a to 5c: assets
// The asset stage never edits the director's shots. When a shot can't be made as planned (no cutout, a refused
// prompt, no portrait of a real person), `override` says how the timeline should show it instead.
export type Asset = {
  shotId: string;
  kind: "real" | "generated" | "none";
  path?: string;
  override?: { type: ShotType; text?: string };
  cutout?: string; // PNG with outline and shadow baked in
  missing?: boolean; // no honest image could be found or made; the timeline holds the previous shot instead
  size?: [number, number]; // image width and height in pixels
  look?: string; // what the viewer should look at here, for the annotate stage
  focus?: Box; // where that is in the image
  zoom?: boolean; // whether the camera moves in on the focus, or the whole image stays in view
  marks?: Mark[];
  title?: string;
  source?: string;
  license?: string;
  credit?: string;
  page?: string;
};

// Stage 6: timeline, the exact props the Remotion composition renders
export type Timeline = {
  fps: number;
  width: number;
  height: number;
  frames: number;
  audio: string;
  style: StyleFile;
  clips: Clip[];
  captions: { words: { text: string; highlight: boolean }[]; startFrame: number; endFrame: number }[];
};
// `punch` marks a clip that reuses the previous clip's image, so it zooms in harder instead of repeating.
export type Clip = { shotId: string; type: ShotType; from: number; frames: number; image?: string; cutout?: string; text?: string; receipt?: Shot["receipt"]; punch?: boolean; size?: [number, number]; focus?: Box; zoom?: boolean; marks?: TimedMark[]; credit?: string; credits?: Credits };
// The end card: every source the facts rest on, and who made each image.
export type Credits = { sources: string[]; images: string[] };

// personas/*.json: the narrator. Separate from the visual style so either can change on its own.
export type Persona = {
  name: string;
  label: string;
  brief: string; // how this narrator talks and thinks, given to the writer
  expertise?: string; // what this narrator knows deeply and notices
  voice?: { id: string; model: string }; // overrides the style's voice when set
};

// styles/*.json
export type StyleFile = {
  name: string;
  label: string;
  palette: { paper: string; ink: string; accent: string; highlight: string };
  fonts: { caption: string; title: string; body: string };
  // How generated images are drawn, by what they show. The subject stays clear; texture belongs to `surface`.
  art: Record<ImageType, string>;
  // Added by the video, over real and generated images alike, so the look never eats the subject.
  surface?: { filter?: string; paper?: number }; // a CSS filter, and the opacity of the paper texture
  motion?: "cuts" | "board"; // how shots connect: hard cuts, or one big board with a moving camera
  hand?: { wobble: number; weight: number }; // how marks are drawn: wobble in pixels, and a line weight multiplier
  // "prefer": real archival images wherever they exist (documentary collage).
  // "proof": real images only for proof (real people, documents, events); everything else is generated in the style.
  realAssets: "prefer" | "proof";
  grain: number; // 0 to 1
  vignette: number; // 0 to 1
  voice: { id: string; model: string };
};

// JSON Schemas for structured output (no recursion, depth under 10, per Meta's limits).
const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "seconds", "story", "tone", "visuals", "sound", "material"],
  properties: { topic: str, seconds: { type: "integer" }, story: strArr, tone: str, visuals: strArr, sound: strArr, material: str },
} as const;

export const factSheetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "angle", "misconception", "story", "claims", "sources"],
  properties: {
    topic: str,
    angle: str,
    misconception: str,
    story: str,
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "number", "quote", "sourceIds", "confidence"],
        properties: { id: str, text: str, number: str, quote: str, sourceIds: strArr, confidence: { type: "string", enum: ["high", "medium", "low"] } },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "publisher", "url", "date"],
        properties: { id: str, title: str, publisher: str, url: str, date: str },
      },
    },
  },
} as const;

export const scriptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "takeaway", "beats"],
  properties: {
    title: str,
    takeaway: str,
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "text", "claimIds", "visual", "emphasis"],
        properties: {
          id: str,
          role: { type: "string", enum: ["hook", "setup", "explain", "example", "but", "therefore", "twist", "reveal", "ending"] },
          text: str,
          claimIds: strArr,
          visual: str,
          emphasis: strArr,
        },
      },
    },
  },
} as const;
