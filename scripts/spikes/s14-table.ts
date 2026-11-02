// S14: per-frame and per-kind tables from saved runs. No model calls.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAMES, type Kind } from "./s14-frames.ts";
import { grade, summary } from "./s14-can-spark-see.ts";

const OUT = join(process.cwd(), "media/spikes/s14/runs");
const names = process.argv.slice(2);
const runs = names.map((n) => [n, existsSync(join(OUT, `${n}.json`)) ? JSON.parse(readFileSync(join(OUT, `${n}.json`), "utf8")) : {}] as const);
summary();
console.log(`\n| Frame | Labelled | ${names.join(" | ")} |\n|---|---|${names.map(() => "---").join("|")}|`);
for (const f of FRAMES) {
  const cells = runs.map(([, d]) => {
    const r = d[f.id];
    if (!r) return "n.r.";
    const g = grade(f, r);
    return `${g.caught.length}/${f.problems.length}${g.extra.length ? ` +${g.extra.map((x: { kind: string }) => x.kind).join(",")}` : ""} (looks ${r.looks})`;
  });
  console.log(`| ${f.id} | ${f.problems.join(", ") || "none"} | ${cells.join(" | ")} |`);
}
const kinds = [...new Set(FRAMES.flatMap((f) => f.problems))] as Kind[];
console.log(`\n| Kind | ${names.join(" | ")} |\n|---|${names.map(() => "---").join("|")}|`);
for (const k of kinds) {
  const cells = runs.map(([, d]) => {
    const fs = FRAMES.filter((f) => f.problems.includes(k) && d[f.id]);
    return `${fs.filter((f) => grade(f, d[f.id]).caught.includes(k)).length}/${fs.length}`;
  });
  console.log(`| ${k} | ${cells.join(" | ")} |`);
}
