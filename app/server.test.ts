// The web app's routes, against a real server on a free port with an empty projects folder. Batch runs dry
// (BATCH_DRY=1) and the line starts paused, so nothing here ever starts a video or calls a model.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let child: ChildProcess;
let base = "";
const root = mkdtempSync(join(tmpdir(), "bettervid-app-"));

before(async () => {
  // One finished-looking project with a picture, so the studio and file routes have something real to read.
  const done = join(root, "a-finished-one-abc123");
  mkdirSync(join(done, "assets"), { recursive: true });
  writeFileSync(join(done, "assets", "shot1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(join(done, "project.json"), JSON.stringify({
    id: "a-finished-one-abc123", createdAt: "2026-11-01T10:00:00.000Z",
    input: { prompt: "a finished one", style: "collage", persona: "auto", mode: "explain", seconds: 0 },
    stages: { plan: { hash: "x", at: "2026-11-01T10:00:01.000Z", ms: 1200 } },
    costs: [], assets: [{ shotId: "shot1", kind: "real", path: "assets/shot1.jpg", title: "A photo", credit: "Someone", license: "Public domain" }],
  }));
  writeFileSync(join(root, "spend.jsonl"), `${JSON.stringify({ project: "a-finished-one-abc123", stage: "plan", usd: 0.01, detail: "", at: "2026-11-01T10:00:01.000Z" })}\n`);
  child = spawn(process.execPath, ["--experimental-strip-types", "app/server.ts"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", PROJECTS_DIR: root, BATCH_DRY: "1", QUEUE_PAUSED: "1", META_API_KEY: "", ELEVENLABS_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise<string>((ok, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`server did not start: ${out}`)), 15000);
    const read = (b: Buffer) => {
      out += b;
      const m = /bettervid on (http:\/\/[\d.]+:\d+)/.exec(out);
      if (m) clearTimeout(timer), ok(m[1]!);
    };
    child.stdout!.on("data", read);
    child.stderr!.on("data", read);
  });
});

after(() => {
  child?.kill();
  rmSync(root, { recursive: true, force: true });
});

const get = async (path: string, init?: RequestInit) => {
  const r = await fetch(base + path, init);
  return { status: r.status, type: r.headers.get("content-type") ?? "", body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
};

test("the page and its data load", async () => {
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.body as string, /<title>bettervid<\/title>/);
  const options = await get("/api/options");
  assert.equal(options.status, 200);
  assert.ok(options.body.styles.length >= 7, "every built-in style is offered");
  assert.ok(options.body.styles.every((s: { still?: string }) => s.still), "each style has its preview still");
  const videos = await get("/api/videos");
  assert.equal(videos.status, 200);
  assert.deepEqual(videos.body.map((v: { id: string }) => v.id), ["a-finished-one-abc123"]);
  assert.deepEqual((await get("/api/showcase")).body, [], "showcase ids that are not in this folder are left out");
});

test("the studio reads one project, its pictures and its spend", async () => {
  const one = await get("/api/videos/a-finished-one-abc123");
  assert.equal(one.status, 200);
  assert.equal(one.body.spend.usd, 0.01);
  assert.equal(one.body.pictures[0].url, "/p/a-finished-one-abc123/assets/shot1.jpg");
  assert.equal(one.body.times[0].label, "Reading your request");
  const pic = await get("/p/a-finished-one-abc123/assets/shot1.jpg");
  assert.equal(pic.status, 200);
  assert.equal(pic.type, "image/jpeg");
  assert.equal((await get("/p/a-finished-one-abc123/project.json")).status, 404, "only pictures are served from a project folder");
  assert.equal((await get("/p/a-finished-one-abc123/..%2Fspend.jsonl")).status, 404);
  assert.equal((await get("/p/a-finished-one-abc123/thumb.jpg")).status, 404, "no video, no thumbnail");
  assert.equal((await get("/api/videos/not-there")).status, 404);
});

test("a batch becomes waiting projects, in order, and nothing starts", async () => {
  const post = await get("/api/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompts: ["first one", "", "second one"], style: "neon", length: "short" }) });
  assert.equal(post.status, 200);
  assert.equal(post.body.ids.length, 2, "blank lines are skipped");
  const line = await get("/api/queue");
  assert.equal(line.body.dry, true);
  assert.equal(line.body.paused, true);
  assert.equal(line.body.running, undefined, "nothing is being made");
  assert.deepEqual(line.body.items.map((v: { prompt: string }) => v.prompt), ["first one", "second one"]);
  const waiting = await get(`/api/videos/${post.body.ids[1]}`);
  assert.equal(waiting.body.stage, "queued");
  assert.equal(waiting.body.queued, 2);
  assert.equal(waiting.body.styleName, "neon");
  const record = JSON.parse(readFileSync(join(root, post.body.ids[0], "project.json"), "utf8"));
  assert.equal(record.input.seconds, 50);
  assert.deepEqual(record.stages, {});
  // A single video asked for while the line holds others joins the line too.
  const single = await get("/api/videos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "third one" }) });
  assert.equal(single.status, 200);
  assert.equal(single.body.queued, 3);
  // Taking one out deletes the record of a video that never started.
  assert.equal((await get(`/api/queue/${post.body.ids[0]}`, { method: "DELETE" })).status, 200);
  assert.equal((await get(`/api/videos/${post.body.ids[0]}`)).status, 404);
  assert.equal((await get("/api/queue")).body.items.length, 2);
  // Resuming in dry mode still starts nothing.
  await get("/api/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: false }) });
  assert.equal((await get("/api/queue")).body.running, undefined);
  assert.equal((await get("/api/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompts: [] }) })).status, 400);
});
