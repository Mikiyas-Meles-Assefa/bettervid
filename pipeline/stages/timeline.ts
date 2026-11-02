// Stage 6: timeline. Deterministic: shots and word times become frame-exact clips and caption pages.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scene } from "../../engine/core/types.ts";
import { build } from "../../engine/language/build.ts";
import type { Asset, Clip, Credits, Project, Timeline } from "../../schemas/project.ts";
import { dir, stage, style, topic } from "../lib/project.ts";
import { PYTHON } from "../lib/util.ts";
import { joinScene, sceneBuildOptions } from "./scene.ts";

const FPS = 30;
const TAIL = 0.6; // seconds of picture after the last word
const CREDITS = 4; // seconds of the end card

const line = (a: Asset) => [a.credit?.replace(/^(.+?)\1$/, "$1"), a.source, a.license].filter(Boolean).join(", ");

// Only what the video really uses: sources behind the facts in the script and on the source cards, and images that were shown.
// `board`: whether the board's drawings were shown. An engine scene lists every image it shows in `used` instead.
export function credits(p: Project, used: Asset[], board = true): Credits {
  const claims = new Set(p.script!.beats.flatMap((b) => b.claimIds));
  const ids = new Set(p.factSheet!.claims.filter((c) => claims.has(c.id)).flatMap((c) => c.sourceIds));
  const sources = p.factSheet!.sources.filter((s) => ids.has(s.id)).map((s) => s.publisher || s.title);
  const images = used.filter((a) => a.kind === "real").map(line);
  const made = used.some((a) => a.kind === "generated") || (board && p.board?.elements.some((e) => e.image)) ?["Illustrations made with Muse Image"] : [];
  return { sources: [...new Set(sources)], images: [...new Set(images), ...made] };
}

// Caption pages: 1 to 3 words, broken after punctuation, after an emphasis word and at beat changes (craft rule C1).
// Only the emphasis words are highlighted, and pages that start during a title card are dropped: the title is the text.
// A page never runs across a hold, so no word shows before it is said and nothing hangs through the silence.
export function captions(p: Project, titles: [number, number][]): Timeline["captions"] {
  const words = p.narration!.words;
  const held = new Set((p.narration!.holds ?? []).map((h) => h.afterWord));
  const emphasis = new Map(p.script!.beats.map((b) => [b.id, new Set(b.emphasis.flatMap((e) => e.toLowerCase().split(/\s+/)))]));
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const isEmph = (w: (typeof words)[number]) => !!emphasis.get(w.beatId)?.has(norm(w.text));
  const pages: { words: typeof words }[] = [];
  let cur: typeof words = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    // Up to 4 words only to keep an emphasis phrase like "bad air" on one page.
    const full = cur.length >= 3 && !(isEmph(w) && next && isEmph(next) && cur.length < 4);
    if (full || held.has(i) || /[.,!?;:]$/.test(w.text) || !next || next.beatId !== w.beatId || (isEmph(w) && !isEmph(next))) {
      pages.push({ words: cur });
      cur = [];
    }
  });
  return pages
    .map((pg, i) => {
      const last = pg.words.at(-1)!;
      const nextStart = pages[i + 1]?.words[0]!.start;
      const end = nextStart !== undefined ? Math.min(nextStart, last.end + 0.4) : last.end + 0.4;
      return {
        words: pg.words.map((w) => ({ text: w.text.replace(/[.,;:]$/, ""), highlight: isEmph(w) })),
        startFrame: Math.round(pg.words[0]!.start * FPS),
        endFrame: Math.round(end * FPS),
      };
    })
    .filter((c) => !titles.some(([a, b]) => c.startFrame >= a && c.startFrame < b));
}

export async function timeline(p: Project, force = false) {
  const s = style(p.input.style);
  await stage(p, "timeline", [p.shots, p.assets, p.board, p.stagePlan, p.scene, p.narration, s], 0, async () => {
    const grain = join(dir(p), "grain.png");
    if (!existsSync(grain)) execFileSync(PYTHON, ["-I", "pipeline/tools/make_grain.py", grain]);
    const paper = join(dir(p), "paper.png");
    if (s.surface?.paper && !existsSync(paper)) execFileSync(PYTHON, ["-I", "pipeline/tools/make_paper.py", paper]);
    const assets = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
    const story = Math.ceil((p.narration!.seconds + TAIL) * FPS);
    const frames = story + CREDITS * FPS;
    if (p.scene) {
      const { scene, theme, used } = await engineScene(p, story);
      const clips: Clip[] = [
        { shotId: "engine", type: "engine", from: 0, frames: story, scene, theme },
        { shotId: "credits", type: "credits", from: story, frames: CREDITS * FPS, credits: credits(p, used, false), theme },
      ];
      p.timeline = { fps: FPS, width: 1080, height: 1920, frames, audio: p.narration!.audio, style: s, clips, captions: captions(p, titleShots(p, story)) };
      return;
    }
    if (p.stagePlan && p.plan?.notation) {
      const stage = p.stagePlan.states.map((s) => ({ ...s, frame: Math.round((p.narration!.words[s.word]?.start ?? 0) * FPS) }));
      const clips: Clip[] = [
        { shotId: "stage", type: "stage", from: 0, frames: story, stage },
        { shotId: "credits", type: "credits", from: story, frames: CREDITS * FPS, credits: credits(p, []) },
      ];
      p.timeline = { fps: FPS, width: 1080, height: 1920, frames, audio: p.narration!.audio, style: s, clips, captions: captions(p, []) };
      return;
    }
    if (p.board) {
      const at = (word: number) => Math.round((p.narration!.words[word]?.start ?? 0) * FPS);
      const elements = p.board.elements.map((e) => ({ ...e, frame: at(e.word), moves: e.moves?.map((m) => ({ ...m, frame: at(m.word) })) }));
      // The last stop pulls back to the whole board and holds there.
      const boxes = p.board.camera.map((c) => [c.x, c.y, c.x + c.w, c.y + c.w * 1.5] as const);
      const [x0, y0, x1, y1] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
      const w = Math.max(x1 - x0, (y1 - y0) / 1.5) * 1.04;
      const camera = [
        ...p.board.camera.map((c) => ({ ...c, frame: at(c.word) })),
        { frame: story - 3.2 * FPS, x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * 1.5) / 2, w, hold: 1.8 },
      ];
      const clips: Clip[] = [
        { shotId: "board", type: "board", from: 0, frames: story, board: { elements, camera } },
        { shotId: "credits", type: "credits", from: story, frames: CREDITS * FPS, credits: credits(p, []) },
      ];
      p.timeline = { fps: FPS, width: 1080, height: 1920, frames, audio: p.narration!.audio, style: s, clips, captions: captions(p, []) };
      return;
    }
    const planned = p.shots!.map((shot, i) => {
      const from = Math.round(shot.start * FPS);
      const to = i + 1 < p.shots!.length ? Math.round(p.shots![i + 1]!.start * FPS) : story;
      const a = assets.get(shot.id);
      const type = a?.override?.type ?? shot.type;
      return { shotId: shot.id, type, from, frames: Math.max(1, to - from), image: a?.path, cutout: a?.cutout, text: a?.override?.text ?? shot.text, receipt: shot.receipt, size: a?.size, focus: a?.focus, zoom: a?.zoom, credit: a?.kind === "real" ? line(a) : undefined, marks: (a?.marks ?? []).map((m) => ({ ...m, frame: Math.round(p.narration!.words[m.word]!.start * FPS) - from })) };
    });
    // A shot with no honest image is dropped and the previous clip holds through it (at the very start, the next one).
    const clips: typeof planned = [];
    let carry = 0;
    for (const c of planned) {
      if (assets.get(c.shotId)?.missing) {
        const prev = clips.at(-1);
        if (prev) prev.frames += c.frames;
        else carry += c.frames;
        continue;
      }
      clips.push(carry ? { ...c, from: c.from - carry, frames: c.frames + carry } : c);
      carry = 0;
    }
    if (!clips.length) clips.push({ shotId: "title", type: "kinetic_title", from: 0, frames: story, text: topic(p) } as (typeof planned)[number]);
    // The same archival image twice in a row (e.g. one map for two beats) becomes a punch-in, not a repeat.
    const sameImage = (a?: string, b?: string) => !!a && !!b && readFileSync(join(dir(p), a)).equals(readFileSync(join(dir(p), b)));
    clips.forEach((c, i) => {
      const prev = clips[i - 1];
      if (prev && c.type === "photo_kenburns" && !c.focus && sameImage(prev.image, c.image)) Object.assign(c, { punch: true });
    });
    const used = clips.flatMap((c) => assets.get(c.shotId) ?? []);
    (clips as Clip[]).push({ shotId: "credits", type: "credits", from: story, frames: CREDITS * FPS, credits: credits(p, used) });
    const titles = clips.filter((c) => c.type === "kinetic_title").map((c): [number, number] => [c.from, c.from + c.frames]);
    p.timeline = { fps: FPS, width: 1080, height: 1920, frames, audio: p.narration!.audio, style: s, clips, captions: captions(p, titles) };
  }, force);
}

// The engine scene: the sections join in word order into one document, built for the project's style. A scene that does
// not build stops the run with every problem, named by section, so the scene stage is fixed rather than papered over.
export async function engineScene(p: Project, story: number) {
  const plan = p.scene!;
  if (!plan.sections.length) throw new Error("timeline: the scene has no sections");
  // Asset paths stay relative to the project folder, which is Remotion's public dir; the player serves them from there.
  for (const [name, file] of Object.entries(plan.assets)) {
    if (!existsSync(join(dir(p), file))) throw new Error(`timeline: scene asset ${name} points to ${file}, which is not in the project folder`);
  }
  // The same document and options the scene stage checked, with the real length of the story.
  const source = joinScene(plan);
  const opts = sceneBuildOptions(p, plan.assets);
  const r = await build(source, { ...opts, ctx: { ...opts.ctx, frames: story } });
  if (!r.scene) {
    const lines = source.split("\n");
    const where = (n: number) => (n ? `line ${n} (${lines[n - 1]?.trim().slice(0, 80)})` : "scene");
    throw new Error(`timeline: the scene does not build in style ${p.input.style}:\n${r.problems.map((x) => `- ${where(x.line)}: ${x.message}`).join("\n")}`);
  }
  return { scene: r.scene, theme: opts.ctx.theme, used: usedAssets(p, r.scene) };
}

// Frame ranges of the director's title shots, which the scene draws as big words (pipeline/lib/shots-scene.ts), so
// captions stay off them. Same rule as shots-scene: a title shot, or a shot with words and no picture, lasting until
// the next shot that is shown.
export function titleShots(p: Project, story: number): [number, number][] {
  const shots = p.shots ?? [];
  const assets = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
  const shown = shots.filter((s) => !assets.get(s.id)?.missing);
  return shown.flatMap((shot, i): [number, number][] => {
    const a = assets.get(shot.id);
    const title = (a?.override?.type ?? shot.type) === "kinetic_title" || (!a?.path && !!(a?.override?.text ?? shot.text));
    if (!title) return [];
    const next = shown[i + 1];
    return [[i ? Math.round(shot.start * FPS) : 0, next ? Math.round(next.start * FPS) : story]];
  });
}

// What each real image shows as its source line while it is on screen, by its path in the project folder.
export function imageCredits(p: Project): Record<string, string> {
  return Object.fromEntries((p.assets ?? []).filter((a) => a.kind === "real").flatMap((a) => [a.path, a.cutout].filter((f): f is string => !!f).map((f) => [f, line(a)])));
}

// The image files a compiled scene shows, matched to their asset records for the credits. An image with no record
// cannot be credited, so it stops the run.
export function usedAssets(p: Project, scene: Scene): Asset[] {
  const files = new Set<string>();
  for (const n of scene.nodes) if (n.kind === "image" && typeof n.props.src === "string" && n.props.src) files.add(n.props.src);
  for (const t of scene.tracks) if (t.prop === "src") for (const k of t.keys) if (typeof k.value === "string" && k.value) files.add(k.value);
  const generated = new Set((p.board?.elements ?? []).flatMap((e) => (e.image ? [e.image] : [])));
  return [...files].map((file): Asset => {
    const record = p.assets?.find((a) => a.path === file || a.cutout === file);
    if (record) return record;
    if (generated.has(file)) return { shotId: `scene:${file}`, kind: "generated", path: file };
    throw new Error(`timeline: the scene shows ${file}, but no asset record says where it came from, so it cannot be credited`);
  });
}
