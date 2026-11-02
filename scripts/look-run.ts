// Runs the scene step's look on sections already written, without rewriting them from scratch, and records what it
// caught and whether it settled. Writes look-run.json in the project's scene folder; the project itself is not changed.
// BETTERVID_CHROME=... node --env-file=.env --experimental-strip-types scripts/look-run.ts <projectDir> s6,s8 [--cap 0.4]
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { closeRenderer, lookAgain } from "../pipeline/stages/scene.ts";

const dir = process.argv[2]!;
const ids = process.argv[3]!.split(",");
const cap = Number(process.argv[process.argv.indexOf("--cap") + 1] || 0.4);
const p = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
const loadable = Object.fromEntries(Object.entries((p.scene?.assets ?? {}) as Record<string, string>).map(([name, path]) => [name, `data:image/jpeg;base64,${execFileSync("ffmpeg", ["-v", "error", "-i", join(dir, path), "-vf", "scale='min(720,iw)':-2", "-f", "mjpeg", "-q:v", "4", "-"], { maxBuffer: 1 << 26 }).toString("base64")}`]));
const out = join(dir, "scene", "look-run.json");
const record: Record<string, unknown> = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
let spent = 0;
try {
  for (const id of ids) {
    if (spent > cap) break;
    const started = Date.now();
    const r = await lookAgain(p, id, loadable);
    spent += r.usd;
    record[id] = { looks: r.looks, usd: +r.usd.toFixed(4), seconds: Math.round((Date.now() - started) / 1000), changed: r.before !== r.after, after: r.after };
    writeFileSync(out, JSON.stringify(record, null, 1));
    appendFileSync(join(process.cwd(), "media/spikes/s14/runs/spend.jsonl"), JSON.stringify({ at: new Date().toISOString(), condition: "look-run", frame: `${basename(dir)}/${id}`, usd: r.usd }) + "\n");
    console.log(`${id}: ${r.looks.join(", ")}, $${r.usd.toFixed(3)}`);
  }
} finally {
  await closeRenderer();
}
