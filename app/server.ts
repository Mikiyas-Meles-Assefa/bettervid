// The web app: a small server around the real pipeline. It starts runs, reports each stage as it happens, and serves
// finished videos. There is no login, so when public (HOST set) it limits new videos and turns off editing.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { dir, load, ROOT, save, spent } from "../pipeline/lib/project.ts";
import type { Project } from "../schemas/project.ts";

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_SITE = HOST !== "127.0.0.1";
// Limits on new videos, which cost real money. The pipeline's BUDGET_USD is the hard stop behind these.
const PER_DAY = Number(process.env.RUNS_PER_DAY ?? (PUBLIC_SITE ? 20 : Infinity));
const PER_VISITOR = Number(process.env.RUNS_PER_VISITOR ?? (PUBLIC_SITE ? 2 : Infinity));
const PUBLIC = resolve("app/public");
const MAX_PROMPT = 8000;
const LENGTHS: Record<string, number> = { auto: 0, short: 50, medium: 120, long: 240, longer: 390 };
const ID = /^[a-z0-9-]{1,80}$/;
const names = (folder: string) => readdirSync(folder).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));

type Job = { id?: string; stage: string; log: string[]; done: boolean; error?: string };
const jobs = new Map<string, Job>();
let running: Job | undefined;
let day = "";
let today = 0;
const visitors = new Map<string, number>();

// Why a new video may not start, or undefined. Counts reset each day.
function limit(req: IncomingMessage): string | undefined {
  const now = new Date().toISOString().slice(0, 10);
  if (now !== day) [day, today] = [now, (visitors.clear(), 0)];
  const who = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim();
  if (today >= PER_DAY) return "Today's new videos are used up. You can still watch any finished video, or replay how it was made.";
  if ((visitors.get(who) ?? 0) >= PER_VISITOR) return "You have reached today's limit for new videos. You can still watch and replay the gallery.";
  today++;
  visitors.set(who, (visitors.get(who) ?? 0) + 1);
}

const NODE = [...(existsSync(".env") ? ["--env-file=.env"] : []), "--experimental-strip-types", "pipeline/run.ts"];

function start(prompt: string, style: string, persona: string, length: string): Promise<string> {
  return run([...NODE, "new", prompt, "--style", style, "--persona", persona, "--seconds", String(LENGTHS[length] ?? 0)], "plan");
}

// Runs the pipeline as a child process and follows its log. Only one run at a time.
function run(args: string[], stage: string, id?: string): Promise<string> {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const job: Job = { id, stage, log: [], done: false };
  running = job;
  if (id) jobs.set(id, job);
  return new Promise((ok, fail) => {
    if (id) ok(id);
    const read = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        job.log.push(line);
        if (job.log.length > 400) job.log.shift();
        const made = /^project (\S+)$/.exec(line);
        if (made && !job.id) {
          job.id = made[1]!;
          jobs.set(job.id, job);
          ok(job.id);
        }
        const stage = /^- (\w+): running/.exec(line);
        if (stage) job.stage = stage[1]!;
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("close", (code) => {
      job.done = true;
      job.stage = code ? "failed" : "done";
      if (code) {
        const why = job.log.filter((l) => /budget:|rror/.test(l)).at(-1) ?? "The run stopped.";
        job.error = why.includes("budget:") ? "The budget for new videos is used up. You can still watch any finished video, or replay how it was made." : why;
      }
      if (running === job) running = undefined;
      if (!job.id) fail(new Error(job.error));
    });
  });
}

// What the page shows for a project: only what the viewer needs, never the raw file.
function summary(p: Project) {
  const job = jobs.get(p.id);
  const assets = p.assets ?? [];
  return {
    id: p.id,
    createdAt: p.createdAt,
    prompt: p.input.prompt,
    style: p.input.style,
    title: p.script?.title ?? p.writing?.at(-1)?.title ?? p.plan?.topic ?? p.input.prompt,
    takeaway: p.script?.takeaway,
    plan: p.plan,
    stages: Object.keys(p.stages),
    stage: job?.stage ?? (p.render ? "done" : "stopped"),
    running: !!job && !job.done,
    error: job?.error,
    writing: p.writing?.map((w) => ({ step: w.step, words: w.narration.split(/\s+/).length, notes: w.notes })),
    narration: p.writing?.at(-1)?.narration,
    seconds: p.narration ? Math.round(p.narration.seconds) : undefined,
    facts: p.factSheet ? { claims: p.factSheet.claims.length, sources: p.factSheet.sources.map((s) => ({ title: s.publisher || s.title, url: s.url })) } : undefined,
    shots: p.timeline?.clips.filter((c) => c.type !== "credits").length,
    real: assets.filter((a) => a.kind === "real").length,
    generated: assets.filter((a) => a.kind === "generated").length,
    marks: assets.reduce((n, a) => n + (a.marks?.length ?? 0), 0),
    critic: p.critic,
    usd: +p.costs.reduce((s, c) => s + c.usd, 0).toFixed(2),
    video: !!p.render && existsSync(join(dir(p), "video.mp4")),
    captions: PUBLIC_SITE ? undefined : p.timeline?.captions.map((c) => c.words.map((w) => w.text).join(" ")),
  };
}

function projects() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "project.json")))
    .map((d) => summary(load(d.name)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function video(req: IncomingMessage, res: ServerResponse, id: string) {
  const file = join(ROOT, id, "video.mp4");
  if (!existsSync(file)) return send(res, 404, { error: "No video yet." });
  const size = statSync(file).size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
  if (!range) {
    res.writeHead(200, { "content-type": "video/mp4", "content-length": size, "accept-ranges": "bytes" });
    return void createReadStream(file).pipe(res);
  }
  const from = Number(range[1]);
  const to = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${from}-${to}/${size}`, "content-length": to - from + 1, "accept-ranges": "bytes" });
  createReadStream(file, { start: from, end: to }).pipe(res);
}

async function body(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > MAX_PROMPT * 4) throw new Error("Too long.");
  }
  return JSON.parse(raw);
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/api/options") return send(res, 200, { styles: names("styles").map((n) => ({ name: n, label: JSON.parse(readFileSync(`styles/${n}.json`, "utf8")).label })), personas: names("personas").map((n) => ({ name: n, label: JSON.parse(readFileSync(`personas/${n}.json`, "utf8")).label })) });
    if (path === "/api/videos" && req.method === "GET") return send(res, 200, projects());
    if (path === "/api/videos" && req.method === "POST") {
      const b = await body(req);
      const prompt = String(b.prompt ?? "").trim();
      if (!prompt) return send(res, 400, { error: "Tell it what the video is about." });
      if (prompt.length > MAX_PROMPT) return send(res, 400, { error: "That message is too long." });
      if (running) return send(res, 409, { error: "A video is already being made. It takes a few minutes." });
      const blocked = limit(req);
      if (blocked) return send(res, 429, { error: blocked });
      const style = names("styles").includes(b.style) ? b.style : "collage";
      const persona = names("personas").includes(b.persona) ? b.persona : "auto";
      return send(res, 200, { id: await start(prompt, style, persona, b.length) });
    }
    const one = /^\/api\/videos\/([a-z0-9-]+)$/.exec(path);
    if (one && ID.test(one[1]!) && existsSync(join(ROOT, one[1]!, "project.json"))) return send(res, 200, summary(load(one[1]!)));
    const edit = /^\/api\/videos\/([a-z0-9-]+)\/captions$/.exec(path);
    if (edit && req.method === "POST" && ID.test(edit[1]!) && existsSync(join(ROOT, edit[1]!, "project.json"))) {
      if (PUBLIC_SITE) return send(res, 403, { error: "Editing is turned off on the public site." });
      if (running) return send(res, 409, { error: "A video is being made right now. Try again in a few minutes." });
      const b = await body(req);
      const p = load(edit[1]!);
      const caps = p.timeline?.captions ?? [];
      if (!Array.isArray(b.captions) || b.captions.length !== caps.length) return send(res, 400, { error: "Those captions do not match this video." });
      // Keep the highlight on the same word position; timing belongs to the caption page, so only the text changes.
      caps.forEach((c, i) => {
        const words = String(b.captions[i]).trim().split(/\s+/).filter(Boolean).slice(0, 8);
        if (words.length) c.words = words.map((text, k) => ({ text, highlight: !!c.words[k]?.highlight }));
      });
      await save(p);
      return send(res, 200, { id: await run([...NODE, p.id, "--only", "render"], "render", p.id) });
    }
    const mp4 = /^\/videos\/([a-z0-9-]+)\.mp4$/.exec(path);
    if (mp4 && ID.test(mp4[1]!)) return video(req, res, mp4[1]!);
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void createReadStream(join(PUBLIC, "index.html")).pipe(res);
    }
    send(res, 404, { error: "Not found." });
  } catch (e: any) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`bettervid on http://${HOST}:${PORT}, $${spent().toFixed(2)} spent so far`));
