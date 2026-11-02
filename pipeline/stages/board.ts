// For board styles, this replaces the director, assets and annotate: Spark plans scenes on the spoken words, code lays
// them out on one board, and the pictures are generated.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BoardElement, BoardPlan, MathToken, Project, Shot } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { asked, charge, dir, prompt, stage, style, topic } from "../lib/project.ts";
import { hash, PYTHON, write } from "../lib/util.ts";
import { generate } from "./assets.ts";

const str = { type: "string" } as const;
const token = {
  type: "object",
  additionalProperties: false,
  required: ["type", "text", "num", "den", "rows", "highlight", "bars"],
  properties: {
    type: { type: "string", enum: ["text", "frac", "matrix"] },
    text: str, num: str, den: str,
    rows: { type: "array", items: { type: "array", items: str } },
    highlight: { type: "array", items: { type: "integer" } },
    bars: { type: "boolean" },
  },
} as const;

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
        required: ["word", "heading", "layout", "size", "near", "side", "view", "bring", "items"],
        properties: {
          word: { type: "integer" },
          heading: str,
          size: { type: "string", enum: ["small", "medium", "large"] },
          near: { type: "integer" },
          side: { type: "string", enum: ["right", "left", "below", "above"] },
          view: { type: "string", enum: ["scene", "wide"] },
          bring: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "word"], properties: { id: str, word: { type: "integer" } } } },
          layout: { type: "string", enum: ["hero", "pair", "steps", "cycle", "work", "statement"] },
          items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "word", "picture", "label", "math", "closeUp"], properties: { id: str, word: { type: "integer" }, picture: str, label: str, math: { type: "array", items: token }, closeUp: { type: "boolean" } } } },
        },
      },
    },
  },
} as const;

type Item = { id: string; word: number; picture: string; label: string; math: MathToken[]; closeUp: boolean };
type Scene = { word: number; heading: string; layout: "hero" | "pair" | "steps" | "cycle" | "work" | "statement"; size: "small" | "medium" | "large"; near: number; side: "right" | "left" | "below" | "above"; view: "scene" | "wide"; bring: { id: string; word: number }[]; items: Item[] };

// Code does the layout, so pictures are big, nothing overlaps and every view is full. A scene is one 1080 by 1620 area.
const W = 1080;
const H = 1620;
const STEP = { x: 1320, y: 1860 };
const blank = { x: 0, y: 0, w: 0, h: 0, points: [] as [number, number][] };

function lay(raw: Scene, ox: number, oy: number): BoardElement[] {
  // A layout built for pictures, with none in it, would leave holes: notation becomes work, and words become a statement.
  const empty = !raw.items.some((it) => it.picture || it.math.length);
  const notes = raw.items.some((it) => it.math.length) && !raw.items.some((it) => it.picture);
  const scene = raw.layout === "work" || raw.layout === "statement" ? raw : { ...raw, layout: empty ? ("statement" as const) : notes ? ("work" as const) : raw.layout };
  const out: BoardElement[] = [];
  const text = (word: number, x: number, y: number, w: number, value: string, size: number, color: BoardElement["color"] = "ink", id?: string) =>
    value && out.push({ ...blank, id, kind: "text", word, x: ox + x, y: oy + y, w, text: value, size: Math.max(54, Math.min(size, Math.round((w * 5) / Math.max(4, value.length)))), color });
  const picture = (it: Item, x: number, y: number, w: number, h: number) =>
    it.picture && out.push({ ...blank, id: it.id || undefined, kind: "image", word: it.word, x: ox + x, y: oy + y, w, h, prompt: it.picture });
  const arrow = (word: number, x1: number, y1: number, x2: number, y2: number, color: BoardElement["color"] = "accent") =>
    out.push({ ...blank, kind: "arrow", word, points: [[ox + x1, oy + y1], [ox + x2, oy + y2]], color });
  const math = (it: Item, x: number, y: number, w: number, h: number, size = 76) => it.math.length && out.push({ ...blank, id: it.id || undefined, kind: "math", word: it.word, x: ox + x, y: oy + y, w, h, size, math: it.math });
  const items = scene.items.slice(0, scene.layout === "work" ? 3 : 4);
  const big = scene.layout === "statement";
  if (scene.layout === "work") {
    const row = (H - 210) / Math.max(1, items.length);
    items.forEach((it, i) => {
      const y = 200 + i * row;
      text(it.word, 60, y, W - 120, it.label, it.math.length ? 58 : 84, it.math.length ? "accent" : "ink");
      math(it, 60, y + 80, W - 120, row - 100, Math.min(120, (row - 100) / 1.7));
    });
    return out;
  }
  text(scene.word, 60, big ? 460 : 40, W - 120, scene.heading, big ? 150 : 100, big ? "accent" : "ink");
  // Below the heading, however many lines it wraps to.
  const below = 460 + Math.ceil((scene.heading.length * 150 * 0.72) / (W - 120)) * 180 + 60;
  if (big) items.forEach((it, i) => text(it.word, 60, below + i * 130, W - 120, it.label, 84));
  if (scene.layout === "hero") {
    const [first, ...rest] = items;
    if (first) {
      if (first.math.length) math(first, 60, 420, W - 120, 500, 100);
      else picture(first, 60, 220, 960, 900);
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
      if (it.math.length) math(it, 40, y + 20, 520, row - 80, 58);
      else picture(it, 40, y, 500, row - 60);
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

type Box = { x: number; y: number; w: number; h: number };

// Where an element really sits. Text height comes from its wrap width, at about 0.5 em per character.
function bounds(e: BoardElement): Box {
  if (e.kind === "text") {
    const size = e.size || 60;
    return { x: e.x, y: e.y, w: e.w, h: Math.ceil(((e.text ?? "").length * size * 0.62) / Math.max(1, e.w)) * size * 1.18 };
  }
  if (e.kind === "image" || e.kind === "math") return { x: e.x, y: e.y, w: e.w, h: e.h };
  const xs = e.points.map((p) => p[0]!);
  const ys = e.points.map((p) => p[1]!);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const union = (list: Box[]): Box => {
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return { x, y, w: Math.max(...list.map((b) => b.x + b.w)) - x, h: Math.max(...list.map((b) => b.y + b.h)) - y };
};
const overlaps = (a: Box, b: Box, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

// What the camera should frame: the box plus some margin, at the screen's shape. So the zoom follows the content.
function frame(b: Box, word: number, margin = 1.14) {
  const w = Math.min(1900, Math.max(b.w, b.h / 1.5) * margin); // any wider and text is too small to read on a phone
  return { word, x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - (w * 1.5) / 2, w };
}

const SCALE = { small: 0.62, medium: 0.85, large: 1.1 };
const GAP = 170;

// Lays each scene next to the idea it grows from, at the size it deserves. There is no grid: the board grows the way
// the story does, and the camera goes wherever the viewer needs to look.
function compose(scenes: Scene[], lastWord: number): BoardPlan {
  const clampWord = (w: number) => Math.min(lastWord, Math.max(0, w));
  const elements: BoardElement[] = [];
  const camera: BoardPlan["camera"] = [];
  const placed: Box[] = [];
  const named = new Map<string, BoardElement>();
  scenes.forEach((scene, i) => {
    const start = i ? clampWord(scene.word) : 0;
    const items = scene.items.map((it, k) => ({ ...it, word: clampWord(k ? Math.max(it.word, start) : Math.min(Math.max(it.word, start), start + 3)) }));
    const scale = SCALE[scene.size] ?? 0.85;
    const made = lay({ ...scene, word: start, items }, 0, 0).map((e) => ({
      ...e, x: e.x * scale, y: e.y * scale, w: e.w * scale, h: e.h * scale, size: e.size ? e.size * scale : e.size,
      points: e.points.map(([x, y]) => [x! * scale, y! * scale] as [number, number]),
    }));
    const box = union(made.map(bounds));
    // Next to the scene it grows from, slightly off line, so the board does not read as a grid.
    const near = placed[Math.min(Math.max(0, scene.near), i - 1)];
    let at = { x: 0, y: 0 };
    if (near) {
      const drift = ((i * 137) % 240) - 120;
      const step = { x: scene.side === "right" ? 1 : scene.side === "left" ? -1 : 0, y: scene.side === "below" ? 1 : scene.side === "above" ? -1 : 0 };
      at = step.x
        ? { x: step.x > 0 ? near.x + near.w + GAP : near.x - box.w - GAP, y: near.y + drift }
        : { x: near.x + drift, y: step.y > 0 ? near.y + near.h + GAP : near.y - box.h - GAP };
      for (let tries = 0; tries < 40 && placed.some((b) => overlaps({ ...box, x: at.x, y: at.y }, b, GAP / 2)); tries++) at = { x: at.x + step.x * 200, y: at.y + step.y * 200 };
    }
    const dx = at.x - box.x;
    const dy = at.y - box.y;
    const moved = made.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy, points: e.points.map(([x, y]) => [x! + dx, y! + dy] as [number, number]) }));
    const here = { ...box, x: at.x, y: at.y };
    // Earlier work carried over: it glides to the top of this scene, ready to be used again.
    let reach = here;
    scene.bring.forEach((b, k) => {
      const e = named.get(b.id);
      if (!e) return;
      const size = bounds(e);
      const slot = { x: here.x + k * (size.w * 0.7 + 60), y: here.y - size.h * 0.7 - 60 };
      (e.moves ??= []).push({ word: clampWord(Math.max(b.word, start)), x: slot.x, y: slot.y, scale: 0.7 });
      reach = union([reach, { ...slot, w: size.w * 0.7, h: size.h * 0.7 }]);
    });
    elements.push(...moved);
    for (const e of moved) if (e.id) named.set(e.id, e);
    placed.push(here);
    camera.push(frame(scene.view === "wide" && near ? union([near, reach]) : here, start));
    // A close-up on one item, when the detail is the point.
    for (const it of items.filter((x) => x.closeUp)) {
      const target = moved.find((e) => e.word === it.word && (e.kind === "math" || e.kind === "image"));
      if (target) camera.push(frame(bounds(target), it.word, 1.3));
    }
    if (near) {
      // A short arrow leaving the scene it grows from, pointing the way. Long lines would cut across the board.
      const c = { x: near.x + near.w / 2, y: near.y + near.h / 2 };
      const d = { x: here.x + here.w / 2, y: here.y + here.h / 2 };
      const across = Math.abs(d.x - c.x) > Math.abs(d.y - c.y);
      const dir = across ? Math.sign(d.x - c.x) : Math.sign(d.y - c.y);
      const from: [number, number] = across ? [dir > 0 ? near.x + near.w + 30 : near.x - 30, c.y] : [c.x, dir > 0 ? near.y + near.h + 30 : near.y - 30];
      const to: [number, number] = across ? [from[0] + dir * 110, from[1]] : [from[0], from[1] + dir * 110];
      elements.push({ ...blank, kind: "arrow", word: start, points: [from, to], color: "accent" });
    }
  });
  camera.sort((a, b) => a.word - b.word);
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
        execFileSync(PYTHON, ["-I", "pipeline/tools/trim_white.py", raw, file]);
      }
      e.image = rel;
    }));
    plan.elements = plan.elements.filter((e) => e.kind !== "image" || e.image);
    p.board = plan;
    charge(p, "board", usd + spend.usd, `${plan.elements.length} elements, ${plan.camera.length} scenes`);
  }, force);
}
