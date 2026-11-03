// Renders every accepted scene in one style with no scene changes, and measures sync from the pixels.
// node --experimental-strip-types scripts/manim/matrix.ts <runDir> <style>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HERE, lint, problems, render } from "./lib.ts";

const OUT = resolve(process.argv[2]!);
const style = process.argv[3]!;
const rows: any[] = [];
for (const id of ["matrix-column", "function-graph", "pendulum-energy", "quicksort-partition", "pin-tumbler-lock"]) {
  const dir = join(OUT, id);
  const name = JSON.parse(readFileSync(join(dir, "review.json"), "utf8")).final;
  const words = join(dir, "words.json");
  const duration = JSON.parse(readFileSync(words, "utf8")).duration;
  const out = join(dir, `style-${style}`);
  const g = render(join(dir, name), words, style, out);
  if (!g.ok) {
    rows.push({ id, style, ok: false, error: g.error.slice(-300) });
    continue;
  }
  const sync = JSON.parse(execFileSync("/opt/homebrew/Cellar/manim/0.21.0/libexec/bin/python", [join(HERE, "measure.py"), g.video, join(out, "report.json")], { encoding: "utf8" }));
  rows.push({ id, style, ok: true, scene: name, video: g.video, duration, seconds: g.seconds, ratio: g.seconds / duration, checks: problems(g.report).length, sync: { ...sync, rows: undefined }, lint: lint(readFileSync(join(dir, name), "utf8")).length });
  console.log(id, style, g.seconds.toFixed(1), (g.seconds / duration).toFixed(2), JSON.stringify(rows.at(-1).sync));
}
writeFileSync(join(OUT, `matrix-${style}.json`), JSON.stringify(rows, null, 1));
