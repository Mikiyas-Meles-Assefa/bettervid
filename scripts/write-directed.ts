// Writes chosen sections of a project again from the start, as the scene step does, at the same time, and charges the
// spend to the ledger. For trying a change to the scene step on a few sections of a directed project. The project
// itself is not changed: each new source goes to scene/<id>/again/, with its frames.
// BETTERVID_CHROME=... node --env-file=.env --experimental-strip-types scripts/write-directed.ts <projectId> <sectionId>...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { charge, dir, load, save } from "../pipeline/lib/project.ts";
import { closeRenderer, writeAgain } from "../pipeline/stages/scene.ts";

const [id, ...sections] = process.argv.slice(2);
if (!id || !sections.length) throw new Error("usage: write-directed.ts <projectId> <sectionId>...");
const p = load(id);
try {
  await Promise.all(sections.map(async (s) => {
    const w = await writeAgain(p, s, {});
    const out = join(dir(p), "scene", s, "again");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "scene.txt"), w.source);
    writeFileSync(join(out, "result.json"), JSON.stringify({ problems: w.problems, warnings: w.warnings, looks: w.looks, rounds: w.rounds, usd: w.usd }, null, 1));
    charge(p, "scene", w.usd, `write again ${s}`);
    console.log(`${s}: ${w.problems.length ? `FAILED: ${w.problems.slice(0, 3).join(" | ")}` : "built"}, rounds ${w.rounds}, looks ${w.looks.join(", ") || "none"}, $${w.usd.toFixed(3)}`);
  }));
} finally {
  await save(p);
  await closeRenderer();
}
