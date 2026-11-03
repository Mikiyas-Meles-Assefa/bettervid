// Judges a round of repairs made before every repair was gated: for each section, the version the full write kept (in
// its look folders) is compared with the version now in the project, by the same gate a repair passes. The version now
// stays only when it is better; otherwise the earlier one is put back. Charges the ledger.
// BETTERVID_CHROME=... node --env-file=.env --experimental-strip-types scripts/rejudge.ts <projectId>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { charge, dir, load, save } from "../pipeline/lib/project.ts";
import { closeRenderer, compareVersions, plainMoments, sceneBuildOptions } from "../pipeline/stages/scene.ts";

const [id] = process.argv.slice(2);
if (!id) throw new Error("usage: rejudge.ts <projectId>");
const p = load(id);
const root = join(dir(p), "scene");
let usd = 0;
try {
  for (const section of p.scene!.sections) {
    const folder = join(root, section.id);
    const file = join(folder, "section.json");
    const record = JSON.parse(readFileSync(file, "utf8"));
    const looks = String((record.notes as string[]).find((n) => n.startsWith("looks:")) ?? "");
    // The version the write kept: rewritten, fixed by the look, or as first looked at.
    const pick = looks.includes("rewritten") ? "rewrite" : /\bfixed\b/.test(looks) ? "look1b" : "look1";
    const earlier = join(folder, pick, "scene.txt");
    if (!looks || !existsSync(earlier)) {
      console.log(`${section.id}: no earlier version to compare (${looks || "no notes"})`);
      continue;
    }
    const before = plainMoments(readFileSync(earlier, "utf8"), sceneBuildOptions(p, {}));
    if (before.trim() === section.source.trim()) {
      console.log(`${section.id}: unchanged since the write`);
      continue;
    }
    const g = await compareVersions(p, section.id, before, section.source, {});
    usd += g.usd;
    console.log(`${section.id}: ${g.keep ? "the repaired version is better, kept" : "the repaired version is not better, the earlier one is put back"} (${g.why})`);
    if (!g.keep) {
      section.source = before;
      record.section = section;
      writeFileSync(file, JSON.stringify(record, null, 1));
      writeFileSync(join(folder, "scene.txt"), before);
    }
  }
} finally {
  if (usd) charge(p, "scene", usd, "judging earlier repairs again");
  await save(p);
  await closeRenderer();
}
