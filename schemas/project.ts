// The Project JSON: one file per run. Each pipeline stage reads earlier fields and writes its own.
// Types here are the contract between stages; the JSON Schemas below are what the models must return.

export type StageName = "research" | "writer" | "voice" | "director" | "assets" | "art" | "cutouts" | "timeline" | "render" | "critic";

export type Project = {
  id: string;
  createdAt: string;
  input: Input;
  factSheet?: FactSheet;
  script?: Script;
  narration?: Narration;
  shots?: Shot[];
  assets?: Asset[];
  timeline?: Timeline;
  render?: { path: string; ms: number };
  // Cache: the hash of each stage's inputs when it last ran, so unchanged stages are skipped.
  stages: Partial<Record<StageName, { hash: string; at: string; ms: number }>>;
  costs: Cost[];
};

export type Input = {
  prompt: string;
  style: string; // a file in styles/, e.g. "collage"
  mode: "explain" | "history" | "math" | "story";
  seconds: number; // target length
};

export type Cost = { stage: StageName; usd: number; detail: string; at: string };

// Stage 1: research
export type Source = { id: string; title: string; publisher: string; url: string; date?: string };
export type Claim = { id: string; text: string; number?: string; quote?: string; sourceIds: string[]; confidence: "high" | "medium" | "low" };
export type FactSheet = { topic: string; angle: string; misconception?: string; claims: Claim[]; sources: Source[] };

// Stage 2: writer
export type BeatRole = "hook" | "setup" | "but" | "therefore" | "reveal" | "ending";
export type Beat = {
  id: string;
  role: BeatRole;
  text: string; // exactly what the narrator says
  claimIds: string[];
  visual: string; // the one visual this beat calls for, concrete
  emphasis: string[]; // words to highlight in captions
};
export type Script = { title: string; beats: Beat[] };

// Stage 3: voice
export type Word = { text: string; start: number; end: number; beatId: string };
export type Narration = { audio: string; voiceId: string; model: string; seconds: number; words: Word[] };

// Stage 4: director (shot types are the build order in docs/PLAN.md section 5)
export type ShotType = "photo_kenburns" | "cutout_on_paper" | "receipt" | "kinetic_title";
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
export type AssetRequest = { kind: "real" | "generated"; query: string; prompt: string; subject?: string };

// Stages 5a to 5c: assets
export type Asset = {
  shotId: string;
  kind: "real" | "generated";
  path: string;
  cutout?: string; // PNG with outline and shadow baked in
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
export type Clip = { shotId: string; type: ShotType; from: number; frames: number; image?: string; cutout?: string; text?: string; receipt?: Shot["receipt"]; punch?: boolean };

// styles/*.json
export type StyleFile = {
  name: string;
  label: string;
  palette: { paper: string; ink: string; accent: string; highlight: string };
  fonts: { caption: string; title: string; body: string };
  artPrefix: string; // prepended to every Muse Image prompt
  grain: number; // 0 to 1
  vignette: number; // 0 to 1
  voice: { id: string; model: string };
};

// JSON Schemas for structured output (no recursion, depth under 10, per Meta's limits).
const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;

export const factSheetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "angle", "misconception", "claims", "sources"],
  properties: {
    topic: str,
    angle: str,
    misconception: str,
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
  required: ["title", "beats"],
  properties: {
    title: str,
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "text", "claimIds", "visual", "emphasis"],
        properties: {
          id: str,
          role: { type: "string", enum: ["hook", "setup", "but", "therefore", "reveal", "ending"] },
          text: str,
          claimIds: strArr,
          visual: str,
          emphasis: strArr,
        },
      },
    },
  },
} as const;
