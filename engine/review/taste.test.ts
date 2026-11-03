import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ask, Part } from "./model.ts";
import { tasteNotes, tasteRequest, tasteReview, type TasteContext } from "./taste.ts";

const pic: Part = { type: "input_image", image_url: "x" };
const ctx: TasteContext = {
  words: "the bigger cup holds twice as much",
  purpose: "compare two quantities, the point is the gap",
  intent: "a cafe's customers learning about refills",
  style: { name: "flat", palette: ["cream", "brown"], fonts: ["Inter"] },
  audience: "adults, no background",
  platform: "phone, vertical",
};

function fake(answer: unknown) {
  const calls: any[] = [];
  const ask = (async (c: any) => {
    calls.push(c);
    return answer;
  }) as Ask;
  return { ask, calls };
}

test("the request carries every piece of context and the frames in order with their times", () => {
  const parts = tasteRequest([{ at: 0.5, image: pic }, { at: 2, image: pic }], ctx);
  const said = parts.filter((p) => p.type === "input_text").map((p: any) => p.text).join("\n");
  for (const s of [ctx.words, ctx.purpose, ctx.intent!, "flat", "cream, brown", "Inter", ctx.audience!, ctx.platform!, "At 0.5 s", "At 2.0 s"]) assert.ok(said.includes(s), s);
  assert.equal(parts.filter((p) => p.type === "input_image").length, 2);
});

test("a revise verdict becomes repair notes, weakest first; ship gives none", async () => {
  const { ask, calls } = fake({ verdict: "revise", weakest: "the two cups are small in a mostly empty frame", fixes: ["make the cups fill the lower two thirds", "drop the heading"], reason: "The gap is the point and it is hard to see." });
  const v = await tasteReview(ask, [{ at: 0, image: pic }], ctx);
  assert.equal(calls[0].name, "taste");
  assert.equal(calls[0].model, "muse-spark-1.3");
  assert.ok(calls[0].system.includes("art director"));
  const notes = tasteNotes(v);
  assert.equal(notes.length, 3);
  assert.ok(notes[0]!.includes("weakest element is the two cups"));
  assert.ok(notes[1]!.includes("fill the lower two thirds"));
  assert.deepEqual(tasteNotes({ verdict: "ship", weakest: "", fixes: [], reason: "" }), []);
});

test("the model is the caller's choice", async () => {
  const { ask, calls } = fake({ verdict: "ship", weakest: "", fixes: [], reason: "" });
  await tasteReview(ask, [{ at: 0, image: pic }], ctx, "muse-wonder-1.0");
  assert.equal(calls[0].model, "muse-wonder-1.0");
});

test("no frames, or revise without fixes, is an error rather than a silent pass", async () => {
  await assert.rejects(tasteReview(fake({}).ask, [], ctx), /no frames/);
  await assert.rejects(tasteReview(fake({ verdict: "revise", weakest: "x", fixes: [], reason: "y" }).ask, [{ at: 0, image: pic }], ctx), /no fixes/);
});
