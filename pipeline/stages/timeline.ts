// Stage 6: timeline. Deterministic: shots and word times become frame-exact clips and caption pages.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, Timeline } from "../../schemas/project.ts";
import { dir, stage, style, topic } from "../lib/project.ts";

const FPS = 30;
const TAIL = 0.6; // seconds of picture after the last word

// Caption pages: 1 to 3 words, broken after punctuation, after an emphasis word and at beat changes (craft rule C1).
// Only the emphasis words are highlighted, and pages that start during a title card are dropped: the title is the text.
function captions(p: Project, titles: [number, number][]): Timeline["captions"] {
  const words = p.narration!.words;
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
    if (full || /[.,!?;:]$/.test(w.text) || !next || next.beatId !== w.beatId || (isEmph(w) && !isEmph(next))) {
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
  await stage(p, "timeline", [p.shots, p.assets, p.narration, s], 0, async () => {
    const grain = join(dir(p), "grain.png");
    if (!existsSync(grain)) execFileSync("python3", ["-I", "pipeline/tools/make_grain.py", grain]);
    const assets = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
    const frames = Math.ceil((p.narration!.seconds + TAIL) * FPS);
    const planned = p.shots!.map((shot, i) => {
      const from = Math.round(shot.start * FPS);
      const to = i + 1 < p.shots!.length ? Math.round(p.shots![i + 1]!.start * FPS) : frames;
      const a = assets.get(shot.id);
      const type = a?.override?.type ?? shot.type;
      return { shotId: shot.id, type, from, frames: Math.max(1, to - from), image: a?.path, cutout: a?.cutout, text: a?.override?.text ?? shot.text, receipt: shot.receipt, size: a?.size, focus: a?.focus };
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
    if (!clips.length) clips.push({ shotId: "title", type: "kinetic_title", from: 0, frames, text: topic(p) } as (typeof planned)[number]);
    // The same archival image twice in a row (e.g. one map for two beats) becomes a punch-in, not a repeat.
    const sameImage = (a?: string, b?: string) => !!a && !!b && readFileSync(join(dir(p), a)).equals(readFileSync(join(dir(p), b)));
    clips.forEach((c, i) => {
      const prev = clips[i - 1];
      if (prev && c.type === "photo_kenburns" && !c.focus && sameImage(prev.image, c.image)) Object.assign(c, { punch: true });
    });
    const titles = clips.filter((c) => c.type === "kinetic_title").map((c): [number, number] => [c.from, c.from + c.frames]);
    p.timeline = { fps: FPS, width: 1080, height: 1920, frames, audio: p.narration!.audio, style: s, clips, captions: captions(p, titles) };
  }, force);
}
