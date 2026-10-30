// Stage 5d: annotate. Spark looks at each shot the director wants to guide the eye on, a second time at a crop around
// the first answer, and plans drawn marks on the spoken words. Tools are options: most shots get few marks or none.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Asset, Box, Mark, Project, Shot } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { asked, charge, dir, prompt, stage } from "../lib/project.ts";

const PARALLEL = 5;

type Plan = { zoom: boolean; target: Box & { found: boolean }; marks: Mark[] };
const num = { type: "number" } as const;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["zoom", "target", "marks"],
  properties: {
    zoom: { type: "boolean" },
    target: { type: "object", additionalProperties: false, required: ["found", "x", "y", "w", "h"], properties: { found: { type: "boolean" }, x: num, y: num, w: num, h: num } },
    marks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "points", "word", "text", "color"],
        properties: {
          tool: { type: "string", enum: ["ring", "box", "underline", "arrow", "line", "dots", "label", "path"] },
          points: { type: "array", items: { type: "array", items: num } },
          word: { type: "integer" },
          text: { type: "string" },
          color: { type: "string", enum: ["accent", "highlight"] },
        },
      },
    },
  },
} as const;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

function jpeg(image: string, out: string, filter: string): string {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", image, "-vf", filter, "-q:v", "3", out]);
  return `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
}

async function look(p: Project, shot: Shot, what: string, url: string, usd: { n: number }): Promise<Plan> {
  const all = p.narration!.words;
  const spoken = all.map((w, i) => ({ w, i })).filter(({ w }) => w.start >= shot.start && w.start < shot.end).map(({ w, i }) => `${i} ${w.text}`).join("\n");
  const wishes = asked(p.plan?.visuals ?? []);
  const r = await json<Plan>({
    system: prompt("annotate"),
    user: [
      { type: "input_image", image_url: url },
      { type: "input_text", text: `${wishes ? `${wishes}\n\n` : ""}What the viewer should look at: ${what}\n\nSpoken while this image is on screen (number, word):\n${spoken}` },
    ],
    schema,
    schemaName: "marks",
    effort: "medium",
  });
  usd.n += r.usd;
  return r.value;
}

async function one(p: Project, shot: Shot, a: Asset, usd: { n: number }): Promise<void> {
  const image = join(dir(p), a.path!);
  const first = await look(p, shot, a.look!, jpeg(image, `${image}.look.jpg`, "scale='min(iw,1024)':-2"), usd);
  const t = first.target;
  if (!t.found || t.w <= 0 || t.h <= 0) {
    a.marks = [];
    return;
  }
  // A second look at a crop around the target: small errors in the whole image show once the camera moves in.
  const cw = Math.max(t.w * 2.5, 0.3);
  const ch = Math.max(t.h * 2.5, 0.3);
  let plan = first;
  let map = (x: number, y: number): [number, number] => [x, y];
  if (cw < 1 && ch < 1) {
    const cx = Math.min(Math.max(t.x + t.w / 2 - cw / 2, 0), 1 - cw);
    const cy = Math.min(Math.max(t.y + t.h / 2 - ch / 2, 0), 1 - ch);
    plan = await look(p, shot, a.look!, jpeg(image, `${image}.crop.jpg`, `crop=iw*${cw}:ih*${ch}:iw*${cx}:ih*${cy},scale=1024:-2:flags=lanczos`), usd);
    map = (x, y) => [cx + x * cw, cy + y * ch];
    const [x, y] = map(plan.target.x, plan.target.y);
    plan = { ...plan, zoom: first.zoom, target: { found: true, x, y, w: plan.target.w * cw, h: plan.target.h * ch } };
    if (!plan.target.w || !plan.target.h) plan.target = t;
  }
  a.focus = { x: clamp(plan.target.x), y: clamp(plan.target.y), w: clamp(plan.target.w), h: clamp(plan.target.h) };
  a.zoom = plan.zoom;
  const words = p.narration!.words;
  a.marks = plan.marks
    .filter((m) => m.points.length && m.points.every((q) => q.length === 2) && words[m.word])
    .map((m) => ({ ...m, points: m.points.map(([x, y]) => map(clamp(x!), clamp(y!))), text: m.tool === "label" ? m.text : undefined }));
}

export async function annotate(p: Project, force = false) {
  const assets = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
  const todo = p.shots!.filter((s) => assets.get(s.id)?.look && assets.get(s.id)?.path);
  await stage(p, "annotate", [todo.map((s) => [s.id, assets.get(s.id)?.look, assets.get(s.id)?.path]), prompt("annotate")], todo.length * 0.03, async () => {
    const usd = { n: 0 };
    try {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        await Promise.all(todo.slice(i, i + PARALLEL).map((s) => one(p, s, assets.get(s.id)!, usd).catch((e) => console.log(`  ${s.id} annotate error: ${e.message}`))));
      }
    } finally {
      charge(p, "annotate", usd.n, `${todo.length} shots, ${todo.reduce((n, s) => n + (assets.get(s.id)?.marks?.length ?? 0), 0)} marks`);
    }
    for (const s of todo) console.log(`  ${s.id}: ${(assets.get(s.id)?.marks ?? []).map((m) => m.tool).join(", ") || "no marks"}`);
  }, force);
}
