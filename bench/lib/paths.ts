// Where a bench run keeps its files. `work/` holds everything bulky and is not committed; `results/` holds the summary.
import { join } from "node:path";

export const BENCH = join(import.meta.dirname, "..");
export const WORK = join(BENCH, "work");
export const RESULTS = join(BENCH, "results");
// Remotion bundles (about 200 MB each) kept across cases and runs, one per entry, rebuilt when sources change.
export const BUNDLES = join(WORK, ".bundles");
process.env.BETTERVID_BUNDLE_CACHE ??= BUNDLES;
export const folderOf = (run: string, id: string) => join(WORK, run, id);
