// Runs the direction check (pipeline/lib/direction-check.ts) on a project that has a direction plan and an engine scene,
// without the rest of the critic. Writes critic/direction-check.json in the project folder; project.json is not changed.
// The opening frames come from video.mp4 when there is one, else they are rendered from the scene. `--no-see` skips the
// look at the opening, so the run makes at most one text call (none when the id map is already on disk).
// BETTERVID_CHROME=... node --env-file=.env --experimental-strip-types scripts/direction-run.ts <projectId> [--no-see]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDirection } from "../pipeline/lib/direction-check.ts";
import { charge, dir, load } from "../pipeline/lib/project.ts";
import { closeRenderer, joinScene, renderStills, SCENE_KITS } from "../pipeline/stages/scene.ts";

const p = load(process.argv[2]!);
const see = !process.argv.includes("--no-see");
const clip = p.timeline?.clips.find((c) => c.type === "engine" && c.scene);
if (!p.direction || !clip?.scene || !p.scene) throw new Error("direction-run: the project needs a direction plan and an engine scene");
const folder = join(dir(p), "critic");
mkdirSync(folder, { recursive: true });
const video = join(dir(p), "video.mp4");
const frames = async (at: number[]) => {
  if (existsSync(video)) {
    return at.map((s, i) => {
      const file = join(folder, `opening-${i}.jpg`);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", s.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=648:-2", "-q:v", "3", file]);
      return file;
    });
  }
  return renderStills(clip.scene!, clip.theme!, at.map((s) => Math.round(s * clip.scene!.fps)), join(folder, "opening"), 0.6);
};
try {
  const kinds = SCENE_KITS.flatMap((k) => Object.keys(k.kinds ?? {})).filter((k) => k !== "graph");
  const t0 = Date.now();
  const r = await checkDirection(p, clip.scene, { source: joinScene(p.scene), kinds, frames: see ? frames : undefined });
  if (r.usd) charge(p, "critic", r.usd, `direction-run: ${r.report.tickets.length} tickets`);
  writeFileSync(join(folder, "direction-check.json"), JSON.stringify({ ...r.report, ids: r.ids, usd: r.usd }, null, 1));
  console.log(`${r.report.tickets.length} tickets, $${r.usd.toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const t of r.report.tickets) console.log(`${t.event} ${t.route}:${t.kind}:${t.severity} [${t.from.toFixed(1)}-${t.to.toFixed(1)} s] ${t.note}`);
  console.log(`tempo: spread across events ${r.report.tempo.cv.toFixed(2)}, gaps ${r.report.tempo.gapsCv.toFixed(2)}`);
  for (const x of r.report.tempo.rates) console.log(`  ${x.event} ${x.rhythm} ${x.rate.toFixed(2)}/s`);
  for (const x of r.report.look) console.log(`  look ${x.event}: ${Math.round(x.share * 100)}% of change, ${x.competing} competing`);
  for (const x of r.report.holds) console.log(`  hold ${x.id}: asked ${x.asked} s, silent ${x.silent.toFixed(2)} s, voiced ${x.voiced}`);
  for (const x of r.report.demo) console.log(`  demo ${x.event}.${x.phase} ${x.pace}: ${x.seconds.toFixed(1)} s, ${x.beats} changes${x.steps ? `, ${x.steps} steps` : ""}${x.settled !== undefined ? `, settled ${x.settled.toFixed(2)} s` : ""}`);
  console.log("ids:", JSON.stringify(r.ids));
} finally {
  await closeRenderer();
}
