// For board styles, this replaces the director, assets and annotate: Spark plans scenes on the spoken words, code lays
// them out on one board, and the pictures are generated.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BoardElement, BoardPlan, Project, Shot } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { asked, charge, dir, prompt, stage, style, topic } from "../lib/project.ts";
import { hash, write } from "../lib/util.ts";
import { generate } from "./assets.ts";

const str = { type: "string" } as const;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "heading", "layout", "items"],
        properties: {
          word: { type: "integer" },
          heading: str,
          layout: { type: "string", enum: ["hero", "pair", "steps", "cycle", "statement"] },
          items: { type: "array", items: { type: "object", additionalProperties: false, required: ["word", "picture", "label"], properties: { word: { type: "integer" }, picture: str, label: str } } },
        },
      },
    },
  },
} as const;

type Item = { word: number; picture: string; label: string };
type Scene = { word: number; heading: string; layout: "hero" | "pair" | "steps" | "cycle" | "statement"; items: Item[] };

// Code does the layout, so pictures are big, nothing overlaps and every view is full. A scene is one 1080 by 1620 area.
const W = 1080;
const H = 1620;
const STEP = { x: 1320, y: 1860 };
const blank = { x: 0, y: 0, w: 0, h: 0, points: [] as [number, number][] };

function lay(scene: Scene, ox: number, oy: number): BoardElement[] {
  const out: BoardElement[] = [];
  const text = (word: number, x: number, y: number, w: number, value: string, size: number, color: BoardElement["color"] = "ink") =>
    value && out.push({ ...blank, kind: "text", word, x: ox + x, y: oy + y, w, text: value, size: Math.max(54, Math.min(size, Math.round((w * 5) / Math.max(4, value.length)))), color });
  const picture = (it: Item, x: number, y: number, w: number, h: number) =>
    it.picture && out.push({ ...blank, kind: "image", word: it.word, x: ox + x, y: oy + y, w, h, prompt: it.picture });
  const arrow = (word: number, x1: number, y1: number, x2: number, y2: number, color: BoardElement["color"] = "accent") =>
    out.push({ ...blank, kind: "arrow", word, points: [[ox + x1, oy + y1], [ox + x2, oy + y2]], color });
  const items = scene.items.slice(0, 4);
  const big = scene.layout === "statement";
  text(scene.word, 60, big ? 460 : 40, W - 120, scene.heading, big ? 150 : 100, big ? "accent" : "ink");
  if (big) items.forEach((it, i) => text(it.word, 60, 900 + i * 130, W - 120, it.label, 84));
  if (scene.layout === "hero") {
    const [first, ...rest] = items;
    if (first) {
      picture(first, 60, 220, 960, 900);
      text(first.word, 60, 1140, W - 120, first.label, 90, "accent");
    }
    rest.forEach((it, i) => text(it.word, 60, 1270 + i * 110, W - 120, it.label, 76));
  }
  if (scene.layout === "pair") {
    items.slice(0, 2).forEach((it, i) => {
      picture(it, 40 + i * 520, 260, 480, 700);
      text(it.word, 40 + i * 520, 980, 480, it.label, 80, i ? "accent" : "ink");
    });
    if (items[1]) arrow(items[1].word, 470, 610, 570, 610);
    items.slice(2).forEach((it, i) => text(it.word, 60, 1220 + i * 110, W - 120, it.label, 70));
  }
  if (scene.layout === "steps") {
    const row = (H - 230) / Math.max(1, items.length);
    items.forEach((it, i) => {
      const y = 230 + i * row;
      picture(it, 40, y, 500, row - 60);
      text(it.word, 570, y + row / 2 - 110, 470, it.label, 84, i === items.length - 1 ? "accent" : "ink");
      if (i) arrow(it.word, 290, y - 66, 290, y + 2);
    });
  }
  if (scene.layout === "cycle") {
    const [middle, ...around] = items;
    if (middle) {
      picture(middle, 370, 660, 340, 340);
      text(middle.word, 340, 1005, 400, middle.label, 64, "accent");
    }
    const spots = around.length === 1 ? [[40, 300]] : around.length === 2 ? [[40, 300], [640, 300]] : [[40, 300], [640, 300], [340, 1160]];
    around.forEach((it, i) => {
      const [x, y] = spots[i]!;
      picture(it, x!, y!, 400, 340);
      text(it.word, x!, y! + 345, 400, it.label, 64);
      // Each item points at the center, so the eye reads them as one system.
      arrow(it.word, x! + 200 + (340 - x!) * 0.25, y! + 345 + (660 - y! - 345) * 0.2, 540 + (x! - 340) * 0.2, 840 + (y! - 660) * 0.3);
    });
  }
  return out;
}

function compose(scenes: Scene[], lastWord: number): BoardPlan {
  const cols = 2;
  const elements: BoardElement[] = [];
  const camera: BoardPlan["camera"] = [];
  const clampWord = (w: number) => Math.min(lastWord, Math.max(0, w));
  scenes.forEach((scene, i) => {
    const row = Math.floor(i / cols);
    const col = row % 2 ? cols - 1 - (i % cols) : i % cols;
    const ox = col * STEP.x;
    const oy = row * STEP.y;
    // The camera arrives with something to see: the first item lands just after the heading, whatever else comes later.
    const start = i ? clampWord(scene.word) : 0;
    const items = scene.items.map((it, k) => ({ ...it, word: clampWord(k ? Math.max(it.word, start) : Math.min(Math.max(it.word, start), start + 3)) }));
    const fixed = { ...scene, word: start, items };
    elements.push(...lay(fixed, ox, oy));
    camera.push({ word: fixed.word, x: ox, y: oy, w: W });
    const prev = camera[i - 1];
    if (prev) {
      // A connector drawn across the gap as the camera follows it.
      const across = prev.y === oy;
      const dir = Math.sign(ox - prev.x);
      const from: [number, number] = across ? [prev.x + (dir > 0 ? W + 10 : -10), oy + H / 2] : [ox + W / 2, prev.y + H + 10];
      const to: [number, number] = across ? [ox + (dir > 0 ? -30 : W + 30), oy + H / 2] : [ox + W / 2, oy - 30];
      elements.push({ ...blank, kind: "arrow", word: fixed.word, points: [from, to], color: "accent" });
    }
  });
  return { elements, camera };
}

export async function board(p: Project, force = false) {
  const words = p.narration!.words;
  const s = style(p.input.style);
  const spoken = words.map((w, i) => `${i} ${w.start.toFixed(1)}s ${w.text}`).join("\n");
  const wishes = asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])]);
  const claims = p.factSheet!.claims.map((c) => `- ${c.text}`).join("\n");
  const user = `Topic: ${topic(p)}\n\n${wishes ? `${wishes}\n\n` : ""}Claims:\n${claims}\n\nSpoken words (number, time, word):\n${spoken}`;
  await stage(p, "board", [user, prompt("board"), s.art], 0.15, async () => {
    const r = await json<{ scenes: Scene[] }>({ system: prompt("board"), user, schema, schemaName: "board", effort: "high" });
    const plan = compose(r.value.scenes, words.length - 1);
    const usd = r.usd;
    console.log(`  ${r.value.scenes.length} scenes: ${r.value.scenes.map((x) => x.layout).join(", ")}`);
    const spend = { usd: 0, notes: [] as string[] };
    const pics = plan.elements.filter((e) => e.kind === "image");
    await Promise.all(pics.map(async (e) => {
      // Named by what it shows, so a re-plan reuses pictures it already paid for.
      const rel = `assets/board-${hash(e.prompt, s.art.object)}.jpg`;
      const file = join(dir(p), rel);
      if (!existsSync(file)) {
        const shot = { id: "board", asset: { kind: "generated", query: "", prompt: e.prompt, imageType: "object" } } as Shot;
        const img = await generate(shot, s, spend);
        if (!img) return;
        const raw = await write(`${file}.raw.jpg`, img);
        execFileSync("python3", ["-I", "pipeline/tools/trim_white.py", raw, file]);
      }
      e.image = rel;
    }));
    plan.elements = plan.elements.filter((e) => e.kind !== "image" || e.image);
    p.board = plan;
    charge(p, "board", usd + spend.usd, `${plan.elements.length} elements, ${plan.camera.length} scenes`);
  }, force);
}
