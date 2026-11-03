// The Project JSON: one file per run. Each pipeline stage reads earlier fields and writes its own.
// Types here are the contract between stages; the JSON Schemas below are what the models must return.
import type { Scene, Theme } from "../engine/core/types.ts";
import type { PartCard, Requirement } from "../engine/design/types.ts";

export type StageName = "material" | "plan" | "research" | "writer" | "direction" | "voice" | "director" | "board" | "stage" | "scene" | "assets" | "annotate" | "art" | "cutouts" | "timeline" | "mix" | "render" | "critic";

export type Project = {
  id: string;
  createdAt: string;
  input: Input;
  plan?: Plan;
  factSheet?: FactSheet;
  writing?: WritingStep[]; // the writer's prose at each step (draft, cut, review), kept for the trail
  script?: Script;
  direction?: DirectionPlan; // the moment-by-moment plan, written after the script and before the voice
  narration?: Narration;
  shots?: Shot[];
  board?: BoardPlan;
  stagePlan?: StagePlan;
  scene?: ScenePlan; // the engine scene, written by the scene stage
  assets?: Asset[];
  timeline?: Timeline;
  render?: { path: string; ms: number };
  critic?: { verdict: string; tickets: { shotId: string; action: string; note: string }[] };
  // The user's material read once into part cards, with what one file requires of the video (engine/design/material).
  // `key`: a hash of what was read, so unchanged material is not read again.
  // `uploaded`: which of these came from the user's uploaded files (input.files), so the scene stage adds its own
  // pictures beside them and never reads the uploads again.
  material?: { cards: PartCard[]; requirements: Requirement[]; problems: string[]; key?: string; uploaded?: { key: string; cards: string[]; problems: string[]; pictures: Record<string, string> } };
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
  frame?: [number, number]; // the frame's width and height in pixels; 1080 by 1920 (9:16) when absent
  // Who writes the scene: "language" (each part in the scene language) or "intent" (an intent plan per part, which the
  // design brain composes). Absent: the scene stage's default (SCENE_AUTHOR_DEFAULT).
  sceneAuthor?: "language" | "intent" | "toolbox"; // toolbox: the language with the design brain's abilities (path A)
  files?: InputFile[]; // the user's own files, stored in the project's material folder
};

export type InputFile = { name: string; type: string; size: number; hash: string };

// Stage 0: plan. What the user explicitly asked for in their message, sorted by which part of the work it concerns.
// Empty fields mean the user said nothing about it and each stage decides the usual way.
export type Plan = {
  topic: string;
  seconds: number; // 0 = not said; when set, it wins over input.seconds
  story: string[]; // content and structure: what to cover or skip, how to open, what to reveal when, how to end, who it is for
  tone: string;
  intent: string; // why they want it (studying for an exam, curious, a documentary, teaching a class...), read from the request, "" if unclear
  visuals: string[];
  sound: string[];
  material: string; // notes, facts or sources the user supplied, verbatim
  notation: boolean; // understanding it means seeing worked notation, so any style uses the teaching stage
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
  cue?: boolean; // a short line the direction added ("Watch the first swap."), never a new fact
  of?: string; // when a cue split a writer's beat, the later part names the beat it came from, so the split can be undone
};
export type Script = { title: string; takeaway: string; beats: Beat[] };
// `notes`: for a cut, the thread and what was left out; for a review, the issues it fixed.
// `check` is a director's read of the demonstrations and examples (notes only, narration unchanged); `revise` acts on it.
export type WritingStep = { step: "draft" | "cut" | "review" | "check" | "revise";title: string; takeaway: string; narration: string; notes: string[]; key?: string }; // key: hash of the writer inputs, for resuming

// Stage 2b: direction. Walks the script as the viewer and writes, moment by moment, what each stretch is for and
// what the picture and voice do about it (research/teaching-tempo.md). Word numbers are global and count the
// final script's words, cue lines included, which are the words the voice will time.
export type HoldPurpose = "look" | "predict" | "settle" | "recap" | "reveal";
export type Hold = {
  id: string; // "h2"
  afterWord: number; // the silence begins when this word ends
  seconds: number;
  purpose: HoldPurpose;
  does: string; // what the picture does during it
  shows?: string; // an on-screen prompt, for a predict hold
};
export type DemoPhase = {
  steps?: [number, number]; // which truth steps, from 1; omitted for a program or a replay
  pace: "slow" | "normal" | "fast";
  at: { word: number } | { hold: string };
  until?: { word: number } | { hold: string };
  replay?: boolean;
  why: string;
};
// `truth`: the truth kit thing that computes the demonstration, with the steps it really computes, so phases name real steps.
export type Demo = { what: string; truth?: { kind: string; data: Record<string, unknown>; steps: string[] }; phases: DemoPhase[] };
export type DirectionEvent = {
  id: string; // "e3"
  firstWord: number;
  lastWord: number;
  job: string; // this moment's purpose in plain words
  knows: string; // what the viewer knows by the end of it
  waiting: string; // the open question or stake carried through it, "" if none
  look: string; // the one thing the eye should be on
  feel: string;
  rhythm: "long" | "short";
  reveal?: { word: number; what: string };
  withhold?: { what: string; until: string }; // must not be shown or said before event `until`
  holds?: Hold[];
  demo?: Demo;
  sound?: string;
  camera?: string;
};
export type Cue = { beforeWord: number; text: string }; // beforeWord counts the script before cues were added
// `look`: the video-wide art direction every scene writer is given: what is emphasized and how, the scale things are
// shown at, motifs that recur, and the texture of the picture. Words for the writers, never values code applies.
export type ArtLook = { emphasis: string; scale: string; motifs: string; texture: string };
export type DirectionPlan = { goal: string; promise: string; arc: string; events: DirectionEvent[]; cues: Cue[]; look?: ArtLook };

// Stage 3: voice
export type Word = { text: string; start: number; end: number; beatId: string };
// `holds`: the silences the voice left for the direction's holds, in seconds on the narration clock.
export type Narration = { audio: string; voiceId: string; model: string; seconds: number; words: Word[]; holds?: { id: string; afterWord: number; start: number; seconds: number }[] };

// Stage 4: director (shot types are the build order in docs/PLAN.md section 5)
export type ShotType = "photo_kenburns" | "cutout_on_paper" | "receipt" | "kinetic_title" | "credits" | "board" | "stage" | "engine";
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
// `draw`: what the scene step should draw itself (a map, diagram, chart, timeline), for `kind` "drawn", or as the honest
// fallback of a real shot whose image is not found.
export type ImageType = "scene" | "object" | "diagram";
export type AssetRequest = { kind: "real" | "generated" | "drawn" | "own"; query: string; broadQuery?: string; prompt: string; idea?: string; draw?: string; imageType?: ImageType; subject?: string; focus?: string; mustBeReal?: boolean };
// A drawn mark. Points are fractions of the image; `word` is the index of the spoken word it starts on.
export type MarkTool = "ring" | "box" | "underline" | "arrow" | "line" | "dots" | "label" | "path";
export type Mark = { tool: MarkTool; points: [number, number][]; word: number; text?: string; color?: "accent" | "highlight" | "ink" };
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
  draw?: string; // no image: the scene step draws this here instead (a map, diagram, chart). Set together with `missing`, so older paths hold the previous shot
  why?: string; // why this picture was chosen, or why none was, in plain words
  size?: [number, number]; // image width and height in pixels
  look?: string; // what the viewer should look at here, for the annotate stage
  focus?: Box; // where that is in the image
  zoom?: boolean; // whether the camera moves in on the focus, or the whole image stays in view
  subject?: Box; // what the picture really shows, so a crop to the phone shape keeps it
  pan?: boolean; // a wide scene the camera travels across instead of cropping
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
export type Clip = { shotId: string; type: ShotType; from: number; frames: number; image?: string; cutout?: string; text?: string; receipt?: Shot["receipt"]; punch?: boolean; size?: [number, number]; focus?: Box; zoom?: boolean; marks?: TimedMark[]; credit?: string; credits?: Credits; stage?: StageState[]; scene?: Scene; theme?: Theme; board?: { elements: TimedElement[]; camera: BoardCamera[] } };
// The teaching stage: what is on the board at each spoken moment. An id that appears in two states is one thing, which travels.
export type StageAtom = { id: string; text: string };
export type StagePart = StageAtom & { type: "text" | "frac" | "matrix"; num: StageAtom[]; den: StageAtom[]; rows: StageAtom[][]; bars: boolean };
export type StageLine = { size: "big" | "normal" | "note"; parts: StagePart[] };
export type StageState = { word: number; frame: number; lines: StageLine[]; light: string[] };
export type StagePlan = { states: Omit<StageState, "frame">[] };
// A live whiteboard: everything is placed in board pixels and starts on a spoken word.
export type MathToken = { type: "text" | "frac" | "matrix"; text: string; num: string; den: string; rows: string[][]; highlight: number[]; bars: boolean };
export type BoardMove = { word: number; x: number; y: number; scale: number };
export type BoardElement = { kind: MarkTool | "text" | "image" | "math"; id?: string; moves?: BoardMove[]; math?: MathToken[]; word: number; x: number; y: number; w: number; h: number; points: [number, number][]; text?: string; size?: number; color?: "ink" | "accent" | "highlight"; prompt?: string; image?: string };
export type BoardPlan = { elements: BoardElement[]; camera: { word: number; x: number; y: number; w: number }[] };
export type TimedElement = Omit<BoardElement, "moves"> & { frame: number; moves?: (BoardMove & { frame: number })[] };
export type BoardCamera = { frame: number; x: number; y: number; w: number; hold?: number }; // hold: seconds the move takes
// The engine scene. Each section covers a run of spoken words and is written in the scene language
// (prompts/engine-language.md) with global word numbers, so the sections join into one document in order.
// `assets` maps the names a scene may use in `image id asset=NAME` to files in the project folder.
// `author` "intent": `source` is the part's intent plan (scripts/design-brain/intent-prompt.md), and the design brain
// composed it into a compiled scene kept in `design.file` (relative to the project folder), with what it decided.
// Absent or "language": `source` is scene language.
export type SceneSection = { id: string; firstWord: number; lastWord: number; source: string; ok: boolean; rounds: number; usd: number; author?: "language" | "intent"; design?: { file: string; decisions: string[]; notes: string[] } };
// `decisions`: what the design brain decided and every correction the director made to the plan, as visible notes.
export type ScenePlan = { sections: SceneSection[]; assets: Record<string, string>; decisions?: string[] };
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
  required: ["topic", "seconds", "story", "tone", "intent", "visuals", "sound", "material", "notation"],
  properties: { topic: str, seconds: { type: "integer" }, story: strArr, tone: str, intent: str, visuals: strArr, sound: strArr, material: str, notation: { type: "boolean" } },
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
