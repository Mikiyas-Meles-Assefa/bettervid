import assert from "node:assert/strict";
import { test } from "node:test";
import { mend, unwrap } from "../lib/mend.ts";

test("a slip the build names with one fix is mended in code; anything ambiguous is left for the writer", () => {
  const src = '@0\ntext a "pulse it" role=title\n@3 keep\ndo plse a\n';
  const r = mend(src, [{ line: 4, message: "There is no behavior called plse. Did you mean pulse? Available: ..." }]);
  assert.equal(r.source.split("\n")[3], "do pulse a");
  assert.deepEqual(r.fixed, ["line 4: plse -> pulse"]);
  // Two words in the line are that close: the fix is not certain, so nothing changes.
  const two = mend("@0\ndo plse plsee\n", [{ line: 2, message: "Did you mean pulse?" }]);
  assert.equal(two.fixed.length, 0);
  // Words inside quotes are the writer's own and never changed.
  const quoted = mend('@0\ntext a "plse"\n', [{ line: 2, message: "Did you mean pulse?" }]);
  assert.equal(quoted.fixed.length, 0);
  assert.equal(unwrap("```\n@0\ntext a “x”\n```"), '@0\ntext a "x"');
});
