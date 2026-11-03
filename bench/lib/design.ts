// The bench's design steps: the design brain's search and look loop on a case folder prepared for the intent composer
// (scripts/design-brain/bench-setup.ts writes request.json and material.json; an intent author writes intent.txt).
//   design <run> [case ...] [--sheets] [--viewers]   runs the search; agent tasks wait in <case>/agents/ask/. When every
//                                                     moment is done, the kept design is compiled to composed.scene.json,
//                                                     which every later bench step (map, measure, render, grade) scores
//                                                     as it is, so a searched design is benchmarked like any author's.
// Rerun after answering the waiting tasks; answered steps replay from their answers.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { searchFolder } from "../../scripts/design-brain/search.ts";
import { folderOf } from "./paths.ts";

type Step = (run: string, ids: string[], flags: Set<string>) => Promise<void>;

export const design: Step = async (run, ids, flags) => {
  for (const id of ids) {
    const dir = folderOf(run, id);
    if (!existsSync(join(dir, "request.json")) || !existsSync(join(dir, "intent.txt"))) {
      console.log(`${id}: not prepared for the composer (scripts/design-brain/bench-setup.ts, then an intent.txt)`);
      continue;
    }
    const r = await searchFolder(dir, { sheets: flags.has("--sheets"), viewers: flags.has("--viewers") });
    const done = r.moments.filter((m) => m.status === "done").length;
    if (r.status === "done") copyFileSync(join(dir, "search.scene.json"), join(dir, "composed.scene.json"));
    console.log(`${id}: search ${r.status}, ${done} of ${r.moments.length} moments searched, ${r.calls} calls, ${(r.ms / 1000).toFixed(1)} s${r.pending.length ? `; answer ${r.pending[0]}` : "; composed.scene.json written"}`);
  }
};
