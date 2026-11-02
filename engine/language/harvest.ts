// Tests the programs a written scene invented, and saves the ones named here. Tests alone cannot tell whether a program
// is general rather than tied to one topic, so a person or reviewer picks; nothing is saved by default.
// Usage: node --experimental-strip-types engine/language/harvest.ts <scene.txt> [<program>=<library-name> ...]
import { readFileSync } from "node:fs";
import { harvest, saveProgram } from "./library.ts";
import { parse } from "./syntax.ts";

const [file, ...keep] = process.argv.slice(2);
const wanted = new Map(keep.map((k) => k.split("=") as [string, string]));
for (const { entry, problems } of await harvest(readFileSync(file!, "utf8"), (s) => parse(s).doc.programs)) {
  console.log(`${entry.name}: ${problems.length ? `not ready: ${problems.join("; ")}` : "passes"}`);
  const name = wanted.get(entry.name);
  if (name && !problems.length) console.log(`  saved ${await saveProgram({ ...entry, name })}`);
}
