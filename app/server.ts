// The web app: a small server around the real pipeline. It starts runs, reports each step in plain words as it
// happens, keeps a line of waiting videos (batch), serves finished videos, thumbnails, the studio's view of each project
// and style previews, and lets a visitor describe a new style in words.
// There is no login, so when public (HOST set) it limits what costs money and turns off editing and the line's controls.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { create, DRY, enqueue, next, pause, position, remove, state as queueState } from "./queue.ts";
import { label, plain, projectFile, PICTURE_TYPES, studio, thumb } from "./studio.ts";
import { dir, load, ROOT, save, spent } from "../pipeline/lib/project.ts";
import { freeName, inside, safeName, showSize, sizeProblem, typeLabel, uploadProblem, UPLOAD_LIMITS } from "../pipeline/lib/uploads.ts";
import type { Project } from "../schemas/project.ts";

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_SITE = HOST !== "127.0.0.1";
// Limits on what costs real money. The pipeline's BUDGET_USD is the hard stop behind these.
const LIMITS = {
  video: { day: Number(process.env.RUNS_PER_DAY ?? (PUBLIC_SITE ? 20 : Infinity)), visitor: Number(process.env.RUNS_PER_VISITOR ?? (PUBLIC_SITE ? 2 : Infinity)), what: "new videos" },
  style: { day: Number(process.env.STYLES_PER_DAY ?? (PUBLIC_SITE ? 30 : Infinity)), visitor: Number(process.env.STYLES_PER_VISITOR ?? (PUBLIC_SITE ? 3 : Infinity)), what: "new styles" },
};
const PUBLIC = resolve("app/public");
const PREVIEWS = resolve("styles/previews");
const UPLOADS = UPLOAD_LIMITS[PUBLIC_SITE ? "public" : "local"];
// Files wait here, under a random token per visit, until the video starts. Ones never used go after a while.
const STAGING = join(ROOT, ".uploads");
const STAGED_HOURS = 6;
const TOKEN = /^[a-f0-9]{24}$/;
const MAX_PROMPT = 8000;
const MAX_BATCH = PUBLIC_SITE ? 5 : 30;
const MAX_LOOK = 400;
const LENGTHS: Record<string, number> = { auto: 0, short: 50, medium: 120, long: 240, longer: 390 };
const ID = /^[a-z0-9-]{1,80}$/;
const names = (folder: string) => (existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")).sort() : []);
// Styles in the picker: the built-in files, then the ones visitors described (styles/custom, read as "custom/<slug>").
const styleNames = () => [...names("styles"), ...names("styles/custom").map((n) => `custom/${n}`)];
const readStyle = (name: string) => JSON.parse(readFileSync(`styles/${name}.json`, "utf8"));

const VISUALS = new Set(["director", "board", "stage", "scene", "assets", "annotate"]);
const PLAIN_RUN = ["plan", "research", "writer", "voice", "visuals", "timeline", "mix", "render", "mux", "critic"];

type Step = { key: string; label: string; state: "done" | "now" | "next" | "failed"; seconds?: number; reused?: boolean; percent?: number; details: string[] };
type Job = { id?: string; stage: string; log: string[]; steps: Step[]; done: boolean; error?: string };
const jobs = new Map<string, Job>();
let running: Job | undefined;
type StyleJob = { id: string; steps: string[]; done: boolean; error?: string; notes?: string; style?: string; started: number };
const styleJobs = new Map<string, StyleJob>();
let styling: StyleJob | undefined;
let day = "";
const used = { video: { today: 0, visitors: new Map<string, number>() }, style: { today: 0, visitors: new Map<string, number>() } };

// Why something that costs money may not start, or undefined. Counts reset each day.
function limit(req: IncomingMessage, kind: keyof typeof LIMITS): string | undefined {
  const now = new Date().toISOString().slice(0, 10);
  if (now !== day) {
    day = now;
    for (const u of Object.values(used)) [u.today, u.visitors] = [0, new Map()];
  }
  const who = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim();
  const [cap, u] = [LIMITS[kind], used[kind]];
  if (u.today >= cap.day) return `Today's ${cap.what} are used up. You can still watch any finished video and use every style.`;
  if ((u.visitors.get(who) ?? 0) >= cap.visitor) return `You have reached today's limit for ${cap.what}. You can still watch the gallery and use every style.`;
  u.today++;
  u.visitors.set(who, (u.visitors.get(who) ?? 0) + 1);
}

const NODE = [...(existsSync(".env") ? ["--env-file=.env"] : []), "--experimental-strip-types"];
const FRIENDLY_BUDGET = "The budget for new work is used up. You can still watch any finished video, or replay how it was made.";

const stagedFiles = (token: string) => (existsSync(join(STAGING, token)) ? readdirSync(join(STAGING, token)).map((name) => ({ name, size: statSync(join(STAGING, token, name)).size })) : []);

// Clears files whose video never started, and says how much is still waiting on disk.
function tidyStaging(): number {
  if (!existsSync(STAGING)) return 0;
  let held = 0;
  for (const token of readdirSync(STAGING)) {
    const folder = join(STAGING, token);
    if (Date.now() - statSync(folder).mtimeMs > STAGED_HOURS * 3600_000) rmSync(folder, { recursive: true, force: true });
    else held += stagedFiles(token).reduce((n, f) => n + f.size, 0);
  }
  return held;
}

// The request's body up to a limit. Past it, the rest is drained and undefined comes back, so the visitor gets a clear
// answer instead of a broken connection, and nothing more is held in memory.
async function raw(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size <= max) chunks.push(c);
  }
  return size <= max ? Buffer.concat(chunks) : undefined;
}

function start(prompt: string, style: string, persona: string, length: string, staged?: string): Promise<string> {
  // APP_UNTIL stops runs after one stage, for testing the page without paying for a whole video.
  const until = process.env.APP_UNTIL ? ["--until", process.env.APP_UNTIL] : [];
  return run([...NODE, "pipeline/run.ts", "new", prompt, "--style", style, "--persona", persona, "--seconds", String(LENGTHS[length] ?? 0), ...until, ...(staged ? ["--material", join(STAGING, staged)] : [])], staged ? "material" : "plan");
}

// A log line from the pipeline, turned into what a viewer wants to know. Costs, retries and stack traces stay out.
const QUIET = /\bmeta\b|retry|ETIMEDOUT|ECONN|terminated|\$\d|total spent|^\s+at |node:|Warning|experimental/i;
function follow(job: Job, line: string) {
  const step = (key: string) => {
    let s = job.steps.find((x) => x.key === key);
    if (!s) job.steps.push((s = { key, label: label(key), state: "now", details: [] }));
    return s;
  };
  const current = job.steps.findLast((s) => s.state === "now");
  let m: RegExpExecArray | null;
  if ((m = /^- (\w+): running/.exec(line))) {
    job.stage = m[1]!;
    Object.assign(step(m[1]!), { state: "now" });
  } else if ((m = /^- (\w+): done in ([\d.]+) s/.exec(line))) Object.assign(step(m[1]!), { state: "done", seconds: Math.round(Number(m[2])) });
  else if ((m = /^- (\w+): cached/.exec(line))) Object.assign(step(m[1]!), { state: "done", reused: true });
  else if ((m = /^\s+render (\d+)%/.exec(line)) && current) current.percent = Number(m[1]);
  else if (/^\s+\S/.test(line) && current && !QUIET.test(line)) {
    let text = line.trim().replace(/^shot(\d+)\s+/, "Shot $1: ").replace(/\s+/g, " ");
    text = text[0]!.toUpperCase() + text.slice(1);
    current.details.push(plain(text, 180));
    if (current.details.length > 6) current.details.shift();
  }
}

// Runs the pipeline as a child process and follows its log. Only one run at a time.
function run(args: string[], stage: string, id?: string): Promise<string> {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const job: Job = { id, stage, log: [], steps: [], done: false };
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
        follow(job, line);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("close", (code) => {
      job.done = true;
      job.stage = code ? "failed" : "done";
      for (const s of job.steps) if (s.state === "now") s.state = code ? "failed" : "done";
      if (code) {
        const why = job.log.filter((l) => /budget:|rror/.test(l)).at(-1) ?? "The run stopped.";
        job.error = why.includes("budget:") ? FRIENDLY_BUDGET : why.replace(/^\s*\w*Error:\s*/, "");
      }
      if (running === job) running = undefined;
      if (!job.id) fail(new Error(job.error));
      setTimeout(pump, 500);
    });
  });
}

// The next waiting video, when nothing is being made. Each one resumes its own record from the first stage.
function pump() {
  if (running || styling) return;
  const id = next();
  if (!id) return;
  const until = process.env.APP_UNTIL ? ["--until", process.env.APP_UNTIL] : [];
  run([...NODE, "pipeline/run.ts", id, ...until], "plan", id).catch(() => {});
}

// Writes a style from a description in a child process, so a crash there never takes the site down.
function makeStyle(description: string): StyleJob {
  const job: StyleJob = { id: randomBytes(6).toString("hex"), steps: [], done: false, started: Date.now() };
  styleJobs.set(job.id, job);
  styling = job;
  const child = spawn(process.execPath, [...NODE, "pipeline/tools/style-writer.ts", description], { stdio: ["ignore", "pipe", "pipe"] });
  const log: string[] = [];
  const read = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      log.push(line);
      const step = /^step: (.*)$/.exec(line);
      if (step && !/^Done for/.test(step[1]!)) job.steps.push(plain(step[1]!.replace(/; .*$/, "")));
      const notes = /^notes: (.*)$/.exec(line);
      if (notes) job.notes = plain(notes[1]!);
      const made = /^style (custom\/[a-z0-9-]+)$/.exec(line);
      if (made) job.style = made[1]!;
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("close", (code) => {
    job.done = true;
    if (code || !job.style) {
      const why = log.filter((l) => /budget:|Error/.test(l)).at(-1) ?? "It stopped before the style was ready.";
      job.error = why.includes("budget:") ? FRIENDLY_BUDGET : why.replace(/^\s*\w*Error:\s*/, "").replace(/^style writer:\s*/, "");
    }
    if (styling === job) styling = undefined;
    setTimeout(pump, 500);
  });
  return job;
}

function styleCard(name: string) {
  const s = readStyle(name);
  const has = (ext: string) => existsSync(join(PREVIEWS, `${name}.${ext}`));
  return { name, label: s.label, custom: name.startsWith("custom/"), description: s.description, still: has("jpg") ? `/previews/${name}.jpg` : undefined, loop: has("webm") ? `/previews/${name}.webm` : undefined, paper: s.palette?.paper, ink: s.palette?.ink, accent: s.palette?.accent };
}

// The steps of a run that is not followed live (finished, or made before the server started), from the project file.
function stepsFrom(p: Project): Step[] {
  return Object.entries(p.stages)
    .sort(([, a], [, b]) => a.at.localeCompare(b.at))
    .map(([key, s]) => ({ key, label: label(key), state: "done" as const, seconds: Math.round(s.ms / 1000), details: [] }));
}

// Done and current steps, then the usual ones still to come, so a viewer sees how far along it is.
function withNext(steps: Step[], finished: boolean, files: boolean): Step[] {
  if (finished) return steps;
  const USUAL = files ? ["material", ...PLAIN_RUN] : PLAIN_RUN;
  const seen = new Set(steps.map((s) => (VISUALS.has(s.key) ? "visuals" : s.key)));
  const last = Math.max(-1, ...steps.map((s) => USUAL.indexOf(VISUALS.has(s.key) ? "visuals" : s.key)));
  const next = USUAL.slice(last + 1).filter((k) => !seen.has(k)).map((key) => ({ key, label: label(key), state: "next" as const, details: [] }));
  return [...steps, ...next];
}

// What was read from each of the user's files: the cards made from it and any problems, in plain words.
function materialSummary(p: Project) {
  const files = p.input.files ?? [];
  if (!files.length) return undefined;
  const read = !!p.material?.uploaded;
  const from = (name: string, f: string) => name === f || name.startsWith(`${f}.`);
  return files.map((f) => ({
    name: f.name,
    type: f.type,
    size: showSize(f.size),
    read,
    cards: read ? p.material!.cards.filter((c) => from(c.name, f.name)).map((c) => ({ title: c.name === f.name ? c.kind : c.name.slice(f.name.length + 1), about: plain(c.about, 200), headings: Object.entries(c.parts).filter(([k]) => /(^|\.)heading\.\d+$/.test(k)).slice(0, 8).map(([, x]) => plain(x.text ?? "", 80)), ok: c.checked.ok })) : [],
    problems: read ? p.material!.uploaded!.problems.filter((x) => x.startsWith(`${f.name}`)).map((x) => plain(x.replace(`${f.name}: `, ""))) : [],
  }));
}

// What the page shows for a project: only what the viewer needs, never the raw file.
function summary(p: Project) {
  const job = jobs.get(p.id);
  const assets = p.assets ?? [];
  const live = !!job && !job.done;
  const steps = job?.steps.length ? job.steps : stepsFrom(p);
  let style: { name: string; label: string } | undefined;
  try {
    style = { name: p.input.style, label: readStyle(p.input.style).label };
  } catch {}
  const draft = p.writing?.at(-1);
  const queued = live ? undefined : position(p.id);
  const fps = p.timeline?.fps ?? 30;
  const video = !!p.render && existsSync(join(dir(p), "video.mp4"));
  return {
    id: p.id,
    createdAt: p.createdAt,
    madeAt: (p.stages as Record<string, { at: string } | undefined>).mux?.at ?? p.stages.render?.at ?? p.createdAt,
    prompt: p.input.prompt,
    style: style?.label ?? p.input.style,
    styleName: p.input.style,
    queued,
    title: p.script?.title ?? draft?.title ?? p.plan?.topic ?? p.input.prompt,
    takeaway: p.script?.takeaway,
    plan: p.plan,
    stages: Object.keys(p.stages),
    steps: withNext(steps, !live && !queued, !!p.input.files?.length),
    material: materialSummary(p),
    stage: job?.stage ?? (queued ? "queued" : p.render ? "done" : Object.keys(p.stages).length ? "stopped" : "new"),
    running: live,
    error: job?.error,
    writing: p.writing?.map((w) => ({ step: w.step, words: w.narration.split(/\s+/).length, notes: w.notes })),
    narration: draft?.narration,
    scriptStep: p.script ? "final" : draft?.step,
    seconds: p.timeline ? Math.round(p.timeline.frames / fps) : p.narration ? Math.round(p.narration.seconds) : undefined,
    facts: p.factSheet ? { claims: p.factSheet.claims.length, sources: p.factSheet.sources.map((s) => ({ title: s.url.startsWith("file:") ? `${s.publisher}: ${s.title}` : s.publisher || s.title, url: /^https?:/.test(s.url) ? s.url : undefined })) } : undefined,
    shots: p.timeline?.clips.filter((c) => c.type !== "credits").length,
    real: assets.filter((a) => a.kind === "real").length,
    generated: assets.filter((a) => a.kind === "generated").length,
    marks: assets.reduce((n, a) => n + (a.marks?.length ?? 0), 0),
    critic: p.critic,
    usd: +p.costs.reduce((s, c) => s + c.usd, 0).toFixed(2),
    video,
    thumb: video ? `/p/${p.id}/thumb.jpg` : undefined,
    files: p.input.files?.length ?? 0,
    captions: PUBLIC_SITE ? undefined : p.timeline?.captions.map((c) => c.words.map((w) => w.text).join(" ")),
  };
}

function projects() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(ROOT, d.name, "project.json")))
    .flatMap((d) => {
      try {
        return [summary(load(d.name))];
      } catch {
        return []; // a project file mid-write; it shows on the next refresh
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The hand-picked row on the home page: app/showcase.json lists project ids, each with a line on what to watch for.
function showcase() {
  let list: { id: string; why?: string }[] = [];
  try {
    list = JSON.parse(readFileSync("app/showcase.json", "utf8")).videos ?? [];
  } catch {}
  return list.flatMap((s) => {
    if (!ID.test(s.id) || !existsSync(join(ROOT, s.id, "video.mp4"))) return [];
    try {
      return [{ ...summary(load(s.id)), why: s.why }];
    } catch {
      return [];
    }
  });
}

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

// A file with byte ranges, so video starts playing before it has all arrived and the viewer can seek.
function stream(req: IncomingMessage, res: ServerResponse, file: string, type: string, cache = "no-cache") {
  if (!existsSync(file)) return send(res, 404, { error: "Not found." });
  const size = statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  const head = { "content-type": type, "accept-ranges": "bytes", "cache-control": cache };
  if (!range || (!range[1] && !range[2])) {
    res.writeHead(200, { ...head, "content-length": size });
    return void createReadStream(file).pipe(res);
  }
  const from = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const to = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (from >= size || from > to) {
    res.writeHead(416, { "content-range": `bytes */${size}` });
    return void res.end();
  }
  res.writeHead(206, { ...head, "content-range": `bytes ${from}-${to}/${size}`, "content-length": to - from + 1 });
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
    if (path === "/api/options") {
      const cards = styleNames().flatMap((n) => {
        try {
          return [styleCard(n)];
        } catch {
          return [];
        }
      });
      return send(res, 200, { styles: cards, personas: names("personas").map((n) => ({ name: n, label: JSON.parse(readFileSync(`personas/${n}.json`, "utf8")).label })), busy: !!running, styling: styling?.id });
    }
    if (path === "/api/videos" && req.method === "GET") return send(res, 200, projects());
    if (path === "/api/showcase") return send(res, 200, showcase());
    if (path === "/api/queue" && req.method === "GET") {
      const q = queueState();
      return send(res, 200, { ...q, controls: !PUBLIC_SITE, running: running?.id, items: q.items.flatMap((id) => (existsSync(join(ROOT, id, "project.json")) ? [summary(load(id))] : [])) });
    }
    if (path === "/api/queue" && req.method === "POST") {
      if (PUBLIC_SITE) return send(res, 403, { error: "The line can only be paused on the machine that runs it." });
      const b = await body(req);
      pause(!!b.paused, b.paused ? "Paused by hand." : undefined);
      if (!b.paused) pump();
      return send(res, 200, queueState());
    }
    const unqueue = /^\/api\/queue\/([a-z0-9-]+)$/.exec(path);
    if (unqueue && req.method === "DELETE") {
      if (PUBLIC_SITE) return send(res, 403, { error: "Waiting videos can only be removed on the machine that runs them." });
      return remove(unqueue[1]!) ? send(res, 200, queueState()) : send(res, 404, { error: "That video is not waiting in line." });
    }
    // Several videos at once: each becomes a waiting project, made one after another behind the budget cap.
    if (path === "/api/batch" && req.method === "POST") {
      const b = await body(req);
      const prompts: string[] = (Array.isArray(b.prompts) ? b.prompts : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean);
      if (!prompts.length) return send(res, 400, { error: "Write at least one video, one per line." });
      if (prompts.length > MAX_BATCH) return send(res, 400, { error: `Up to ${MAX_BATCH} videos at a time.` });
      if (prompts.some((x) => x.length > MAX_PROMPT)) return send(res, 400, { error: "One of those is too long." });
      const style = styleNames().includes(b.style) ? b.style : "collage";
      const persona = names("personas").includes(b.persona) ? b.persona : "auto";
      const made: string[] = [];
      let refused: string | undefined;
      for (const prompt of prompts) {
        if ((refused = limit(req, "video"))) break;
        made.push((await create({ prompt, style, persona, seconds: LENGTHS[b.length] ?? 0, publicSite: PUBLIC_SITE })).id);
      }
      enqueue(made);
      pump();
      return send(res, made.length ? 200 : 429, { ids: made, refused, error: made.length ? undefined : refused });
    }
    if (path === "/api/videos" && req.method === "POST") {
      const b = await body(req);
      const staged = TOKEN.test(String(b.uploads ?? "")) && stagedFiles(b.uploads).length ? (b.uploads as string) : undefined;
      const prompt = String(b.prompt ?? "").trim() || (staged ? "Make a video from the attached files." : "");
      if (!prompt) return send(res, 400, { error: "Tell it what the video is about, or add your files." });
      if (prompt.length > MAX_PROMPT) return send(res, 400, { error: "That message is too long." });
      const blocked = limit(req, "video");
      if (blocked) return send(res, 429, { error: blocked });
      const style = styleNames().includes(b.style) ? b.style : "collage";
      const persona = names("personas").includes(b.persona) ? b.persona : "auto";
      // Something is being made already, or others are waiting: this one joins the line instead of being turned away.
      if (running || styling || queueState().items.length || DRY) {
        const p = await create({ prompt, style, persona, seconds: LENGTHS[b.length] ?? 0, staged: staged && join(STAGING, staged), publicSite: PUBLIC_SITE });
        if (staged) rmSync(join(STAGING, staged), { recursive: true, force: true });
        enqueue([p.id]);
        pump();
        return send(res, 200, { id: p.id, queued: position(p.id) });
      }
      const id = await start(prompt, style, persona, b.length, staged);
      // The run copied the files into its project before announcing its id.
      if (staged) rmSync(join(STAGING, staged), { recursive: true, force: true });
      return send(res, 200, { id });
    }
    if (path === "/api/uploads" && req.method === "POST") {
      const url = new URL(req.url ?? "/", "http://x");
      const name = safeName(url.searchParams.get("name") ?? "file");
      const given = url.searchParams.get("token") ?? "";
      if (given && !TOKEN.test(given)) return send(res, 400, { error: "That upload is not valid." });
      const token = given || randomBytes(12).toString("hex");
      const bytes = await raw(req, UPLOADS.file);
      if (!bytes) return send(res, 413, { error: `${name} is too big. The limit is ${showSize(UPLOADS.file)} per file.` });
      const held = tidyStaging();
      if (held + bytes.length > UPLOADS.staged) return send(res, 507, { error: "The site is holding too many files right now. Try again later." });
      const waiting = stagedFiles(token);
      const problem = sizeProblem(name, bytes.length, waiting.map((f) => f.size), UPLOADS) ?? (await uploadProblem(name, bytes));
      if (problem) return send(res, 400, { error: problem });
      const folder = join(STAGING, token);
      mkdirSync(folder, { recursive: true });
      const stored = freeName(name, (n) => waiting.some((f) => f.name === n));
      writeFileSync(inside(folder, stored), bytes);
      return send(res, 200, { token, file: { name: stored, type: typeLabel(stored), size: showSize(bytes.length) } });
    }
    const upload = /^\/api\/uploads\/([a-f0-9]{24})\/([^/]+)$/.exec(path);
    if (upload && req.method === "DELETE") {
      rmSync(inside(join(STAGING, upload[1]!), safeName(decodeURIComponent(upload[2]!))), { force: true });
      return send(res, 200, {});
    }
    if (path === "/api/styles" && req.method === "POST") {
      const b = await body(req);
      const description = String(b.description ?? "").trim().replace(/\s+/g, " ");
      if (description.length < 3) return send(res, 400, { error: "Describe the look in a few words." });
      if (description.length > MAX_LOOK) return send(res, 400, { error: `Keep it under ${MAX_LOOK} characters.` });
      if (styling) return send(res, 409, { error: "Another style is being made right now. It takes about a minute." });
      const blocked = limit(req, "style");
      if (blocked) return send(res, 429, { error: blocked });
      return send(res, 200, { job: makeStyle(description).id });
    }
    const sj = /^\/api\/styles\/jobs\/([a-f0-9]{12})$/.exec(path);
    if (sj) {
      const job = styleJobs.get(sj[1]!);
      if (!job) return send(res, 404, { error: "That style job is gone. The server may have restarted." });
      return send(res, 200, { steps: job.steps, done: job.done, error: job.error, notes: job.notes, style: job.style && existsSync(`styles/${job.style}.json`) ? styleCard(job.style) : undefined });
    }
    const one = /^\/api\/videos\/([a-z0-9-]+)$/.exec(path);
    if (one && ID.test(one[1]!) && existsSync(join(ROOT, one[1]!, "project.json"))) {
      const p = load(one[1]!);
      return send(res, 200, { ...summary(p), ...studio(p) });
    }
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
      return send(res, 200, { id: await run([...NODE, "pipeline/run.ts", p.id, "--only", "render"], "render", p.id) });
    }
    // A project's pictures for the studio (stills, images, the user's pages) and its gallery thumbnail.
    const pic = /^\/p\/([a-z0-9-]+)\/(.+)$/.exec(path);
    if (pic && ID.test(pic[1]!)) {
      if (pic[2] === "thumb.jpg") {
        const p = existsSync(join(ROOT, pic[1]!, "project.json")) ? load(pic[1]!) : undefined;
        const file = p && (await thumb(p.id, p.timeline ? p.timeline.frames / p.timeline.fps : p.narration?.seconds));
        return file ? stream(req, res, file, "image/jpeg", "public, max-age=300") : send(res, 404, { error: "No picture yet." });
      }
      let rel = "";
      try {
        rel = decodeURIComponent(pic[2]!);
      } catch {}
      const file = rel ? projectFile(pic[1]!, rel) : undefined;
      return file ? stream(req, res, file, PICTURE_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()]!, "public, max-age=3600") : send(res, 404, { error: "Not found." });
    }
    const mp4 = /^\/videos\/([a-z0-9-]+)\.mp4$/.exec(path);
    if (mp4 && ID.test(mp4[1]!)) return stream(req, res, join(ROOT, mp4[1]!, "video.mp4"), "video/mp4");
    const shown = /^\/previews\/((?:custom\/)?[a-z0-9-]+)\.(jpg|webm)$/.exec(path);
    if (shown) return stream(req, res, join(PREVIEWS, `${shown[1]}.${shown[2]}`), shown[2] === "jpg" ? "image/jpeg" : "video/webm", "public, max-age=600");
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      return void createReadStream(join(PUBLIC, "index.html")).pipe(res);
    }
    send(res, 404, { error: "Not found." });
  } catch (e: any) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`bettervid on http://${HOST}:${PORT}, $${spent().toFixed(2)} spent so far${DRY ? ", batch is dry (records only)" : ""}`);
  pump();
});
