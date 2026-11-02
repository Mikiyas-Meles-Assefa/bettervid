// Writes one section again from the start, as the scene step does (build repairs, then the look), with the guide and
// engine as they are now. The project is not changed: the new source goes to scene/<id>/again/, with its frames.
// BETTERVID_CHROME=... node --env-file=.env --experimental-strip-types scripts/write-again.ts <projectDir> <sectionId>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeRenderer, writeAgain } from "../pipeline/stages/scene.ts";

const [folder, id] = process.argv.slice(2);
if (!folder || !id) throw new Error("usage: write-again.ts <projectDir> <sectionId>");
const p = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
const loadable = Object.fromEntries(Object.entries((p.scene?.assets ?? {}) as Record<string, string>).map(([name, path]) => [name, `data:image/jpeg;base64,${execFileSync("ffmpeg", ["-v", "error", "-i", join(folder, path), "-vf", "scale='min(720,iw)':-2", "-f", "mjpeg", "-q:v", "4", "-"], { maxBuffer: 1 << 26 }).toString("base64")}`]));
try {
  const w = await writeAgain(p, id, loadable);
  const out = join(folder, "scene", id, "again");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "scene.txt"), w.source);
  writeFileSync(join(out, "result.json"), JSON.stringify({ problems: w.problems, warnings: w.warnings, looks: w.looks, rounds: w.rounds, usd: w.usd }, null, 1));
  console.log(`${id}: ${w.problems.length ? `FAILED: ${w.problems.slice(0, 3).join(" | ")}` : "built"}, rounds ${w.rounds}, looks ${w.looks.join(", ") || "none"}, $${w.usd.toFixed(3)}`);
} finally {
  await closeRenderer();
}
