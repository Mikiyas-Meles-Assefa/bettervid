// The timeline's engine path: sections join in word order, a scene that does not build stops the run with its problems
// named by section, and every image a scene shows must have a record for the credits.
// Run: node --experimental-strip-types --test pipeline/stages/timeline.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scene } from "../../engine/core/types.ts";
import type { Project, SceneSection } from "../../schemas/project.ts";
import { credits, engineScene, usedAssets } from "./timeline.ts";

const section = (id: string, firstWord: number, lastWord: number, source: string): SceneSection => ({ id, firstWord, lastWord, source, ok: true, rounds: 0, usd: 0 });

function project(sections: SceneSection[], assets: Record<string, string> = {}): Project {
  const words = "one two three four five six seven eight".split(" ").map((text, i) => ({ text, start: i * 0.6, end: i * 0.6 + 0.5, beatId: "b1" }));
  return {
    id: "timeline-test-does-not-exist",
    createdAt: "",
    input: { prompt: "", style: "whiteboard", persona: "auto", mode: "explain", seconds: 0 },
    narration: { audio: "narration.mp3", voiceId: "", model: "", seconds: 4.8, words },
    script: { title: "", takeaway: "", beats: [{ id: "b1", role: "hook", text: "", claimIds: ["c1"], visual: "", emphasis: [] }] },
    factSheet: { topic: "", angle: "", story: "", claims: [{ id: "c1", text: "", sourceIds: ["s1"], confidence: "high" }], sources: [{ id: "s1", title: "T", publisher: "Pub", url: "" }] },
    scene: { sections, assets },
    stages: {},
    costs: [],
  };
}

test("sections join in word order, whatever order they arrive in", async () => {
  const p = project([section("b", 4, 7, `@4\ntext second "later" size=big`), section("a", 0, 3, `@0\ntext first "hello" size=big`)]);
  const { scene, theme, used } = await engineScene(p, 160);
  assert.equal(scene.frames, 160);
  assert.ok(scene.nodes.some((n) => n.id === "first"));
  assert.ok(scene.nodes.some((n) => n.id === "second"));
  assert.equal(theme.colors.paper, "#ffffff");
  assert.deepEqual(used, []);
});

test("a scene that does not build throws, naming the section and its line", async () => {
  const p = project([section("a", 0, 3, `@0\ntext first "hello" size=big`), section("b", 4, 7, `@4\ntext second "x" color=purple`)]);
  await assert.rejects(engineScene(p, 160), (e: Error) => /section b line 2/.test(e.message) && /purple/.test(e.message));
});

test("a scene asset that is not in the project folder throws", async () => {
  const p = project([section("a", 0, 7, `@0\nimage pic asset=pic w=400 h=400`)], { pic: "assets/missing.jpg" });
  await assert.rejects(engineScene(p, 160), /scene asset pic points to assets\/missing.jpg/);
});

test("images a scene shows are credited from their records, and an unknown one stops the run", () => {
  const scene = (src: string): Scene => ({ fps: 30, width: 1080, height: 1920, frames: 10, background: "paper", nodes: [{ id: "i", kind: "image", props: { src } }], tracks: [], events: [] });
  const p = project([]);
  p.assets = [{ shotId: "s1", kind: "real", path: "assets/a.jpg", credit: "Jane Doe", source: "Wikimedia Commons", license: "CC BY 4.0" }];
  p.board = { elements: [{ kind: "image", word: 0, x: 0, y: 0, w: 1, h: 1, points: [], image: "assets/board.jpg" }], camera: [] };
  assert.deepEqual(credits(p, usedAssets(p, scene("assets/a.jpg")), false).images, ["Jane Doe, Wikimedia Commons, CC BY 4.0"]);
  assert.deepEqual(credits(p, usedAssets(p, scene("assets/board.jpg")), false).images, ["Illustrations made with Muse Image"]);
  assert.deepEqual(credits(p, []).sources, ["Pub"]);
  assert.throws(() => usedAssets(p, scene("assets/nobody.jpg")), /cannot be credited/);
});
