// Builds one section with the engine as it is now and shows every state settled, side by side, with the engine's
// measured look findings and how far things that stay on screen moved between states. For before and after checks of
// layout changes; no model is called.
// Usage: BETTERVID_CHROME=... node --experimental-strip-types scripts/state-sheet.ts <projectDir> <sectionId> <outDir>
// SRC=<file> builds that source in place of the section's own scene.txt.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { when } from "../engine/core/compile.ts";
import { evaluate } from "../engine/core/evaluate.ts";
import type { Resolved } from "../engine/core/types.ts";
import { build } from "../engine/language/build.ts";
import { parse } from "../engine/language/syntax.ts";
import { inventory, keptAt, lookFrames, measureLayout, readOf, type Rect } from "../pipeline/lib/look.ts";
import { closeRenderer, kitKinds, plainMoments, renderStills, sceneBuildOptions } from "../pipeline/stages/scene.ts";
import type { Project } from "../schemas/project.ts";

const [folder, id, out] = process.argv.slice(2);
if (!folder || !id || !out) throw new Error("usage: state-sheet.ts <projectDir> <sectionId> <outDir>");
const p: Project = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
const named: Record<string, string> = p.scene?.assets ?? {};
const assets = Object.fromEntries(Object.entries(named).map(([k, f]) => [k, `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(folder, f)).toString("base64")}`]));
const source = readFileSync(process.env.SRC || join(folder, "scene", id, "scene.txt"), "utf8");
const opts = sceneBuildOptions(p, assets);
const r = await build(source, opts);
console.log(`${folder} ${id}: ${r.problems.length} problems`);
for (const x of r.problems.slice(0, 8)) console.log(`  line ${x.line}: ${x.message}`);
if (!r.scene) process.exit(1);
const ctx = opts.ctx;
const starts = parse(plainMoments(source, opts), kitKinds()).doc.states.map((s) => when(s.at, ctx));
const first = Math.min(...starts);
const end = Math.max(...starts) + ctx.fps * 3;
const frames = lookFrames(starts, first, Math.min(ctx.frames - 1, end), ctx.fps, 40).filter((m) => m.why === "settled").map((m) => m.frame);
const files = await renderStills(r.scene, ctx.theme, frames, resolve(out), 0.3);
await closeRenderer();
const read = readOf(ctx.theme);
const box = (b: Rect) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0 });
let prev = new Map<string, ReturnType<typeof box>>();
const report: string[] = [];
for (const f of frames) {
  const things = inventory(r.scene, f).filter((t) => t.opacity >= 0.15 && !(t.kind === "shape" && (t.box.x1 - t.box.x0) * (t.box.y1 - t.box.y0) > ctx.width * ctx.height * 0.8));
  const findings = measureLayout(things, ctx.width, ctx.height, read, false, process.env.NOKEPT ? [] : keptAt(r.scene, f));
  const top = Math.min(...things.map((t) => t.box.y0));
  const bottom = Math.max(...things.map((t) => t.box.y1));
  // Words that stay on screen and moved or changed size: a jump the viewer sees.
  const now = new Map(things.filter((t) => t.kind !== "shape").map((t) => [t.id, box(t.box)]));
  // A kit moves its own parts as it plays; where the kit itself sits is its root group's place and scale.
  const roots = (list: Resolved[]): Resolved[] => list.flatMap((x) => (typeof x.props.truth === "string" ? [x] : roots(x.children)));
  for (const k of roots(evaluate(r.scene, f))) now.set(k.id, { x: Number(k.props.x ?? 0), y: Number(k.props.y ?? 0), w: Number(k.props.scaleX ?? 1) * 100, h: Number(k.props.scaleY ?? 1) * 100 });
  const jumps = [...now].filter(([k, b]) => prev.has(k) && !/\.(item|value|finger|pointer)\b/.test(k)).map(([k, b]) => [k, Math.hypot(b.x - prev.get(k)!.x, b.y - prev.get(k)!.y), b.h / prev.get(k)!.h] as const).filter(([, d, s]) => d > 6 || Math.abs(s - 1) > 0.03);
  prev = now;
  report.push(`${f}: content y ${Math.round(top)}-${Math.round(bottom)} (${Math.round(((bottom - top) / (ctx.height * 0.765)) * 100)}% of safe height); ${findings.map((x) => `${x.kind}[${x.severity}] ${x.note}`).join("; ") || "no findings"}${jumps.length ? `; moved: ${jumps.map(([k, d, s]) => `${k} ${Math.round(d)}px x${s.toFixed(2)}`).join(", ")}` : ""}`);
}
writeFileSync(join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
const cols = Math.min(8, files.length);
execFileSync("ffmpeg", ["-v", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}]pad=iw+8:ih+8:4:4:white[p${i}]`).join(";")};${files.map((_, i) => `[p${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => "w0").join("+") : "0"}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => "h0").join("+") : "0"}`).join("|")}:fill=white`, join(out, "sheet.jpg")]);
console.log(join(out, "sheet.jpg"));
