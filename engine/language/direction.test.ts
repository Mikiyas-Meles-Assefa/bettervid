// What the language gives direction: holds as moments, demonstrations played in phases that must fit their time,
// replays, withheld things, and words of order that must be true.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene } from "../core/types.ts";
import { KITS } from "../kits/index.ts";
import { sortPart } from "../kits/sort.ts";
import { truthSteps } from "../kits/steps.ts";
import { build, formatProblems, type BuildOptions } from "./build.ts";
import { expandHolds, holdMoments } from "./holds.ts";

// Words every half second, with a 4 second silence after word 10 (it ends at 5.2 s, word 11 starts at 9.5 s).
const words = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.5 + (i > 10 ? 4 : 0) }));
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 1200, words, kits: KITS, theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "a", body: "b", mono: "m" }, moveFrames: 10, ease: "linear" } };
const holds = [{ id: "h1", afterWord: 10, start: 5.2, seconds: 4 }];
const opts: BuildOptions = { ctx, holds };
const ok = async (src: string, o = opts) => {
  const r = await build(src, o);
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r.scene!;
};
const bad = async (src: string, o = opts) => {
  const r = await build(src, o);
  assert.ok(r.problems.length, "expected problems");
  return formatProblems(r.problems);
};
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => find(evaluate(s, f), id)?.props;

test("hold moments name the start and end of a silence on the narration clock", () => {
  const m = holdMoments(holds, ctx).get("h1")!;
  // Word 10 starts at 5 s (frame 150); the silence starts at 5.2 s (frame 156) and lasts 120 frames.
  assert.deepEqual(m, { id: "h1", word: 10, start: 6, end: 126 });
  const { source, problems } = expandHolds(`@h1 keep\ndo steps s until=@h1.end-6\n@h1+30 keep\ntext t "@h1 stays as words"\n@h9`, holdMoments(holds, ctx));
  assert.deepEqual(source.split("\n").slice(0, 4), ["@10+6 keep", "do steps s until=@10+120", "@10+36 keep", `text t "@h1 stays as words"`]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.message, /no hold called h9.*h1/);
  assert.equal(problems[0]!.line, 5);
});

test("a state at a hold starts in the silence, and a hold the video lacks is refused", async () => {
  const s = await ok(`@0\ntext a "before"\n@h1\ntext b "during the hold"\n@h1.end\ntext c "after"\n`);
  assert.ok(Number(at(s, 156 + 20, "b")?.opacity ?? 0) > 0.9, "the hold's state shows in the silence");
  assert.equal(Number(at(s, 150, "b")?.opacity ?? 0), 0);
  assert.ok(Number(at(s, 285 + 20, "c")?.opacity ?? 0) > 0.9);
  assert.match(await bad(`@0\ntext a "x"\n@h2\ntext b "y"\n`), /no hold called h2/);
});

test("phases play at their pace, and one that cannot fit says how many steps do", async () => {
  const data = "data=[38,27,43,10] algo=merge show=boxes";
  const steps = truthSteps("sort", "s", { data: [38, 27, 43, 10], algo: "merge", show: "boxes" }, ctx);
  assert.ok(steps.length > 10);
  // Two slow steps under words 0 to 10, two in the hold, the rest fast.
  await ok(`@0\nsort s ${data}\ndo steps s from=1 to=2 pace=slow until=@h1\n@h1 keep\ndo steps s from=3 to=4 pace=normal until=@h1.end\n@11 keep\ndo steps s from=5 to=${steps.length} pace=fast until=@30\n`);
  const err = await bad(`@0\nsort s ${data}\n@h1 keep\ndo steps s from=1 to=${steps.length} pace=slow until=@h1.end\n`);
  assert.match(err, /pace=slow/);
  assert.match(err, /steps fit \(to=\d+\)/);
  assert.match(err, /# needs HOLD \d+s/);
  // With no time given, the pace sets each step's length.
  const s = await ok(`@0\nsort s ${data}\ndo steps s from=1 to=1 pace=slow\n`);
  assert.ok(s);
  assert.match(await bad(`@0\nsort s ${data}\ndo steps s pace=crawl\n`), /pace must be slow, normal or fast/);
});

test("a replay is a second thing with the same input that plays its steps again", async () => {
  const s = await ok(`@0\nsort s data=[5,2,8,1] algo=insertion show=boxes\ndo steps s until=@8\n@10 keep\nsort again replay=s show=boxes\ndo steps again pace=fast until=@20\n`);
  const order = (id: string) => [1, 2, 3, 4].map((k) => ({ k, x: Number(at(s, 1199, sortPart.item(id, k))?.x) })).sort((a, b) => a.x - b.x).map((o) => o.k);
  assert.deepEqual(order("again"), order("s"));
  assert.match(await bad(`@0\nsort s data=[5,2] algo=bubble\ntext t "x"\nsort r replay=t\n`), /replay=t must name another sort/);
});

test("a withheld thing on screen before its moment is refused, and after it is fine", async () => {
  await ok(`withhold ans until=@12\n@0\ntext q "What is it?"\n@12 keep\ntext ans "It is this."\n`);
  const err = await bad(`withhold ans until=@20\n@0\ntext q "What is it?"\n@12 keep\ntext ans "It is this."\n`);
  assert.match(err, /line 1: ans is on screen at .* withheld until @20/);
  // Pieces of a withheld thing count too.
  assert.match(await bad(`withhold grp until=@20\n@0\nrow grp\n  text a "x"\n`), /grp(\.\S+)? is on screen/);
  await ok(`withhold none until=@20\n@0\ntext a "x"\n`);
  assert.match(await bad(`withhold a\n@0\ntext a "x"\n`), /until=@N/);
});

test("words that say numbers are in order must be true while they show", async () => {
  // A hand-made row of values that are not in order cannot be called sorted.
  const err = await bad(`@0\nrow pair\n  box a "38"\n  box b "27"\ntag pair "both sorted"\n`);
  assert.match(err, /"both sorted" says pair is sorted, but .* shows 38, 27/);
  await ok(`@0\nrow pair\n  box a "27"\n  box b "38"\ntag pair "sorted"\n`);
  await ok(`@0\nrow pair\n  box a "38"\n  box b "27"\ntag pair "not sorted yet"\n`);
  // On a kit: before the steps have played the claim is false, after them it is true.
  assert.match(await bad(`@0\nsort s data=[5,2,8,1] algo=bubble show=boxes\ntag s "sorted"\n`), /says s is sorted/);
  await ok(`@0\nsort s data=[5,2,8,1] algo=bubble show=boxes\ndo steps s until=@10\n@14 keep\ntag s "sorted"\n`);
});

test("merge sort shows its cuts and a finger on the front of each run", async () => {
  const steps = truthSteps("sort", "s", { data: [38, 27, 43, 10], algo: "merge" }, ctx);
  assert.equal(steps[0], "split 38 27 43 10 into 38 27 and 43 10");
  assert.ok(steps.some((x) => x.startsWith("merge 38 with 27: a finger on the front of each")));
  const levels = truthSteps("sort", "s", { data: [38, 27, 43, 10], algo: "merge", order: "levels" }, ctx);
  assert.deepEqual(levels.slice(0, 3), ["split 38 27 43 10 into 38 27 and 43 10", "split 38 27 into 38 and 27", "split 43 10 into 43 and 10"]);
  const s = await ok(`@0\nsort s data=[38,27,43,10] algo=merge order=levels show=boxes\ndo steps s from=1 to=1 at=@2\n@4 keep\ndo steps s from=2 to=4 at=@5,@7,@9\n`);
  // After the first cut there is a gap between the halves: 27 and 43 are further apart than 38 and 27.
  const x = (k: number, f: number) => Number(at(s, f, sortPart.item("s", k))?.x);
  const f = 2 * 15 + 40;
  assert.ok(x(3, f) - x(2, f) > (x(2, f) - x(1, f)) * 1.3, "a gap opens between the halves");
  // At the merge of 38 and 27 the two fingers sit under them.
  assert.ok(Number(at(s, 9 * 15 + 30, sortPart.finger("s", "a"))?.opacity) > 0.9);
  assert.ok(Math.abs(Number(at(s, 9 * 15 + 30, sortPart.finger("s", "b"))?.x) - x(2, 9 * 15 + 30)) < 1);
  // Played to the end, the values stand in order with no gaps left.
  const all = await ok(`@0\nsort s data=[38,27,43,10] algo=merge show=bars\ndo steps s until=@40\n`);
  const xs = [4, 2, 1, 3].map((k) => Number(at(all, 1199, sortPart.item("s", k))?.x));
  assert.ok(xs.every((v, i) => i === 0 || v > xs[i - 1]!), "10 27 38 43 left to right");
  assert.ok(Math.abs(xs[1]! - xs[0]! - (xs[3]! - xs[2]!)) < 1, "evenly spaced again");
});

test("a thing made done=K shows its state after step K and plays on from K + 1", async () => {
  const s = await ok(`@0\nsort s data=[38,27,43,10] algo=merge order=levels show=bars done=7\n@4 keep\ndo steps s from=8 to=11 until=@9\n`);
  // After step 7 (the first pair merged) 27 stands left of 38.
  assert.ok(Number(at(s, 2, sortPart.item("s", 2))?.x) < Number(at(s, 2, sortPart.item("s", 1))?.x));
  assert.match(await bad(`@0\nsort s data=[38,27,43,10] algo=merge order=levels show=bars done=7\n@4 keep\ndo steps s from=5 to=9 until=@9\n`), /line 4: s has already played steps 1 to 7 .*done=7.*from=8/);
  assert.match(await bad(`@0\nsort s data=[3,1] algo=bubble done=40\n`), /done= is how many/);
});

test("steps played twice are refused on their own line, and one id cannot take two inputs", async () => {
  assert.match(await bad(`@0\nsort s data=[5,2,8,1] algo=insertion show=boxes\ndo steps s from=1 to=3 until=@4\n@6 keep\ndo steps s from=2 to=4 until=@9\n`), /line 5: s has already played steps 1 to 3 before this line/);
  assert.match(await bad(`@0\nsort s data=[5,2,8,1] algo=merge show=boxes\n@6\nsort s data=[5,2,8,1] algo=merge order=levels show=boxes\n`), /line 4: s is made at line 2 .* makes it again/);
  await ok(`@0\nsort s data=[5,2,8,1] algo=merge show=boxes\n@6\nsort s data=[5,2,8,1] algo=merge show=boxes done=3\n`);
});

test("words a state puts up must be in view under the scene's camera", async () => {
  const err = await bad(`@0\nsort s data=[5,2,8,1,9,3,7,4] algo=merge show=boxes\ntext cap "a caption below the work" role=caption\n@4 keep\ncamera s.item.1 zoom=2.5\ntext cap "the caption now says something new" role=caption\n`);
  assert.match(err, /the caption now says something new/);
});

test("a tag riding a moving part onto the values is refused", async () => {
  const err = await bad(`@0\nsort s data=[5,1,7,3,6,2,8,4] algo=merge show=boxes form=row\n@4 keep\ndo steps s from=1 to=3 until=@8\n@10 keep\ntag s.finger.a "finger" side=left\ndo steps s from=4 to=7 until=@30\n`);
  assert.match(err, /"finger" is tagged on s\.finger\.a, which moves .* onto the value/);
});
