// What the studio page shows about one project, read from its folder: the plan and intent, the direction's moments and
// holds, the scene sections with the stills the reviewers looked at, the pictures with their credits, the spend from the
// ledger, the model calls from the run log, and what was read from the user's files. Also the gallery thumbnails.
// Nothing here calls a model or starts a run.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { dir, ROOT } from "../pipeline/lib/project.ts";
import type { Project } from "../schemas/project.ts";

// What each pipeline step is called on the page. A step this list does not know still shows, under its own name.
const LABELS: Record<string, string> = {
  material: "Reading your files", plan: "Reading your request", research: "Researching the story", writer: "Writing the script", direction: "Directing each moment",
  voice: "Recording the narration", director: "Planning the shots", board: "Planning the board", stage: "Laying out the worked steps", scene: "Building the scenes",
  assets: "Finding and making images", annotate: "Drawing on the images", timeline: "Cutting it together", mix: "Mixing the sound",
  render: "Rendering the video", mux: "Joining picture and sound", critic: "Watching it back and fixing",
};
export const label = (k: string) => LABELS[k] ?? (k === "visuals" ? "Making the visuals" : k[0]!.toUpperCase() + k.slice(1));

// Model words for the page: no em dashes, and short.
export const plain = (s: string, max = 220) => {
  const t = String(s ?? "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+-\s+/g, ", ").trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
};

// A file in a project folder, as the page asks for it. Only pictures, and only inside that folder.
export const PICTURE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
export function projectFile(id: string, rel: string): string | undefined {
  const base = join(ROOT, id);
  const file = join(base, rel);
  if (!file.startsWith(base + sep) || rel.split(/[\\/]/).some((part) => part === "..")) return undefined;
  if (!PICTURE_TYPES[extname(file).toLowerCase()] || !existsSync(file) || !statSync(file).isFile()) return undefined;
  return file;
}
const fileUrl = (id: string, rel: string) => `/p/${id}/${rel.split(sep).map(encodeURIComponent).join("/")}`;

// The spend ledger, read again only when it changes: what each project cost, by stage.
let ledgerAt = -1;
let ledgerRows = new Map<string, { usd: number; stages: Map<string, number> }>();
function ledger() {
  const file = join(ROOT, "spend.jsonl");
  if (!existsSync(file)) return ledgerRows;
  const at = statSync(file).mtimeMs;
  if (at === ledgerAt) return ledgerRows;
  const rows = new Map<string, { usd: number; stages: Map<string, number> }>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { project: string; stage: string; usd: number };
      const one = rows.get(r.project) ?? { usd: 0, stages: new Map() };
      one.usd += r.usd;
      one.stages.set(r.stage, (one.stages.get(r.stage) ?? 0) + r.usd);
      rows.set(r.project, one);
    } catch {}
  }
  [ledgerAt, ledgerRows] = [at, rows];
  return rows;
}
export function spendOf(id: string) {
  const one = ledger().get(id);
  if (!one) return undefined;
  return { usd: +one.usd.toFixed(2), stages: [...one.stages].sort((a, b) => b[1] - a[1]).map(([stage, usd]) => ({ stage, label: label(stage), usd: +usd.toFixed(3) })) };
}

// The model calls each stage made, from the run log's timing lines (newer projects only).
function modelCalls(folder: string) {
  const file = join(folder, "run.log");
  if (!existsSync(file)) return undefined;
  const by = new Map<string, { calls: number; ms: number; tokensIn: number; tokensOut: number; models: Set<string> }>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("[timing] ")) continue;
    try {
      const t = JSON.parse(line.slice(9));
      if (t.kind !== "model") continue;
      const one = by.get(t.name) ?? { calls: 0, ms: 0, tokensIn: 0, tokensOut: 0, models: new Set<string>() };
      one.calls++;
      one.ms += t.ms ?? 0;
      one.tokensIn += t.inputTokens ?? 0;
      one.tokensOut += t.outputTokens ?? 0;
      if (t.model) one.models.add(t.model);
      by.set(t.name, one);
    } catch {}
  }
  if (!by.size) return undefined;
  return [...by].map(([stage, x]) => ({ stage, label: label(stage), calls: x.calls, tokensIn: x.tokensIn, tokensOut: x.tokensOut, models: [...x.models] }));
}

// The stills a section's reviewers looked at: the one-round loop keeps them in once/shown, older runs in look*/shown.
// The file name is the frame number, so each still says when it is in the video.
function stillsOf(id: string, section: string, fps: number) {
  const base = join(ROOT, id, "scene", section);
  if (!existsSync(base)) return [];
  const looks = readdirSync(base).filter((d) => /^(once|look\w*)$/.test(d) && existsSync(join(base, d, "shown"))).sort();
  const pick = looks.includes("once") ? "once" : looks.at(-1);
  if (!pick) return [];
  return readdirSync(join(base, pick, "shown"))
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
    .map((f) => ({ url: fileUrl(id, join("scene", section, pick, "shown", f)), at: /^\d+/.test(f) ? +(Number.parseInt(f, 10) / fps).toFixed(1) : undefined }));
}

// Seconds on the narration clock for a word number, or undefined when the voice is not there yet.
const wordTime = (p: Project, word: number, end = false) => {
  const w = p.narration?.words[Math.max(0, Math.min(word, (p.narration?.words.length ?? 1) - 1))];
  return w ? +(end ? w.end : w.start).toFixed(1) : undefined;
};
const wordsBetween = (p: Project, a: number, b: number) => (p.narration?.words.slice(a, b + 1).map((w) => w.text).join(" ") ?? "");

function direction(p: Project) {
  const d = p.direction;
  if (!d) return undefined;
  return {
    goal: plain(d.goal, 400),
    promise: plain(d.promise, 400),
    arc: plain(d.arc, 600),
    look: d.look ? Object.fromEntries(Object.entries(d.look).map(([k, v]) => [k, plain(v, 600)])) : undefined,
    events: d.events.map((e) => ({
      id: e.id,
      from: wordTime(p, e.firstWord),
      to: wordTime(p, e.lastWord, true),
      job: plain(e.job, 300),
      knows: plain(e.knows, 300),
      waiting: plain(e.waiting, 200),
      look: plain(e.look, 300),
      feel: plain(e.feel, 120),
      rhythm: e.rhythm,
      reveal: e.reveal ? plain(e.reveal.what, 200) : undefined,
      withhold: e.withhold ? plain(e.withhold.what, 200) : undefined,
      demo: e.demo ? plain(e.demo.what, 300) : undefined,
      holds: (e.holds ?? []).map((h) => ({ at: wordTime(p, h.afterWord, true), seconds: h.seconds, purpose: h.purpose, does: plain(h.does, 200), shows: h.shows ? plain(h.shows, 120) : undefined })),
    })),
    cues: d.cues.map((c) => plain(c.text, 160)),
  };
}

function sections(p: Project) {
  const fps = p.timeline?.fps ?? 30;
  return (p.scene?.sections ?? []).map((s) => ({
    id: s.id,
    from: wordTime(p, s.firstWord),
    to: wordTime(p, s.lastWord, true),
    words: plain(wordsBetween(p, s.firstWord, s.lastWord), 600),
    author: s.author ?? "language",
    rounds: s.rounds,
    ok: s.ok,
    usd: s.usd,
    source: s.source.length > 12000 ? `${s.source.slice(0, 12000)}\n...` : s.source,
    stills: stillsOf(p.id, s.id, fps),
  }));
}

// Every picture in the video, with who made it and under what license. Real pictures link to their page.
function pictures(p: Project) {
  const seen = new Set<string>();
  const out: { url: string; kind: string; title?: string; credit?: string; license?: string; source?: string; page?: string; why?: string }[] = [];
  for (const a of p.assets ?? []) {
    const path = a.cutout ?? a.path;
    if (!a.path || seen.has(a.path) || !projectFile(p.id, path!)) continue;
    seen.add(a.path);
    if (a.cutout) seen.add(a.cutout);
    out.push({ url: fileUrl(p.id, path!), kind: a.kind, title: a.title ? plain(a.title, 120) : undefined, credit: a.credit ? plain(a.credit, 160) : undefined, license: a.license, source: a.source, page: a.page && /^https?:/.test(a.page) ? a.page : undefined, why: a.why ? plain(a.why, 260) : undefined });
  }
  for (const [name, path] of Object.entries(p.scene?.assets ?? {})) {
    if (seen.has(path) || !projectFile(p.id, path)) continue;
    seen.add(path);
    out.push({ url: fileUrl(p.id, path), kind: /^material\//.test(path) ? "yours" : "scene", title: name });
  }
  return out;
}

// Splits a CSV the material reader wrote back into rows, for showing a table as a table.
export function csvRows(text: string, max = 40): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else if (c !== "\r") cell += c;
  }
  if ((cell || row.length) && rows.length < max) row.push(cell), rows.push(row);
  return rows;
}

// What was read from each uploaded file: its headings, tables, figures and pictures, what it requires of the video, and
// what could not be read. A paged file's pages and pictures were written to material/.extracted by the reader.
function material(p: Project) {
  const files = p.input.files ?? [];
  if (!files.length) return undefined;
  const cards = p.material?.cards ?? [];
  const pics = p.material?.uploaded?.pictures ?? {};
  const mine = (f: string, name: string) => name === f || name.startsWith(`${f}.`);
  return {
    read: !!p.material?.uploaded,
    requirements: (p.material?.requirements ?? []).map((r) => ({ file: r.source.file, kind: plain(r.kind, 80), detail: plain(r.detail, 300), why: plain(r.why, 200) })),
    files: files.map((f) => {
      const own = cards.filter((c) => mine(f.name, c.name));
      const headings = own.flatMap((c) => Object.entries(c.parts).filter(([k]) => /(^|\.)heading(\.\d+)?$/.test(k)).map(([k, x]) => ({ where: k.replace(/\.?heading(\.\d+)?$/, "").replace(/-/g, " ") || undefined, text: plain(x.text ?? x.about, 160) })));
      const text = own.find((c) => c.name === f.name && c.text && !c.data)?.text;
      const tables = own.filter((c) => c.data?.kind === "table" || (c.kind === "table" && c.text)).map((c) => ({ name: c.name, about: plain(c.about, 200), rows: csvRows(c.text ?? "") }));
      const figures = own
        .filter((c) => pics[c.name] || (c.name === f.name && /\.(png|jpe?g|webp|gif)$/i.test(f.name)))
        .map((c) => {
          const path = pics[c.name] ?? join("material", f.name);
          return { name: c.name, kind: plain(c.kind, 60), about: plain(c.about, 320), words: Object.values(c.parts).map((x) => x.text?.trim()).filter((t): t is string => !!t).slice(0, 6).map((t) => plain(t, 120)), url: projectFile(p.id, path) ? fileUrl(p.id, path) : undefined, checked: c.checked.ok };
        });
      // Pictures the reader saved from this file that no card names (the reader stopped, or the card was dropped).
      const extracted = join(dir(p), "material", ".extracted");
      const named = new Set(figures.map((x) => x.url));
      const loose = existsSync(extracted)
        ? readdirSync(extracted).filter((n) => n.startsWith(`${f.name}.`) && PICTURE_TYPES[extname(n).toLowerCase()]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((n) => fileUrl(p.id, relative(dir(p), join(extracted, n)))).filter((u) => !named.has(u))
        : [];
      return {
        name: f.name,
        type: f.type,
        size: f.size,
        cards: own.length,
        headings,
        text: text ? (text.length > 20000 ? `${text.slice(0, 20000)}\n...` : text) : undefined,
        tables,
        figures,
        loose,
        problems: (p.material?.problems ?? []).filter((x) => x.startsWith(f.name)).map((x) => plain(x.replace(`${f.name}: `, ""), 300)),
      };
    }),
  };
}

// Everything the studio adds to the project summary.
export function studio(p: Project) {
  const folder = dir(p);
  return {
    intent: p.plan?.intent ? plain(p.plan.intent, 400) : undefined,
    asked: p.plan ? { story: p.plan.story.map((s) => plain(s, 240)), tone: plain(p.plan.tone, 160), visuals: p.plan.visuals.map((s) => plain(s, 240)), sound: p.plan.sound.map((s) => plain(s, 240)), seconds: p.plan.seconds, notation: p.plan.notation } : undefined,
    angle: p.factSheet?.angle ? plain(p.factSheet.angle, 400) : undefined,
    misconception: p.factSheet?.misconception ? plain(p.factSheet.misconception, 300) : undefined,
    beats: p.script?.beats.map((b) => ({ role: b.role, text: b.text, claims: b.claimIds, cue: !!b.cue })),
    claims: p.factSheet?.claims.map((c) => ({ id: c.id, text: plain(c.text, 400), quote: c.quote ? plain(c.quote, 300) : undefined, sources: c.sourceIds, confidence: c.confidence })),
    sourceList: p.factSheet?.sources.map((s) => ({ id: s.id, title: plain(s.title, 200), publisher: plain(s.publisher, 120), url: /^https?:/.test(s.url) ? s.url : undefined, date: s.date || undefined, yours: s.url.startsWith("file:") })),
    direction: direction(p),
    sections: sections(p),
    pictures: pictures(p),
    spend: spendOf(p.id),
    models: modelCalls(folder),
    times: Object.entries(p.stages).sort(([, a], [, b]) => a.at.localeCompare(b.at)).map(([stage, s]) => ({ stage, label: label(stage), seconds: +(s.ms / 1000).toFixed(1), at: s.at })),
    material: material(p),
    frame: p.timeline ? [p.timeline.width, p.timeline.height] : p.input.frame,
  };
}

// Gallery thumbnails: one frame from the video, picked by ffmpeg's thumbnail filter a quarter of the way in, cached
// in the project folder as thumb.jpg and made again only when the video is newer. At most two at once.
const making = new Map<string, Promise<string | undefined>>();
let active = 0;
const waiting: (() => void)[] = [];
export function thumb(id: string, seconds?: number): Promise<string | undefined> {
  const video = join(ROOT, id, "video.mp4");
  const out = join(ROOT, id, "thumb.jpg");
  if (!existsSync(video)) return Promise.resolve(undefined);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(video).mtimeMs) return Promise.resolve(out);
  const already = making.get(id);
  if (already) return already;
  const job = (async () => {
    if (active >= 2) await new Promise<void>((go) => waiting.push(go));
    active++;
    try {
      const at = seconds ? Math.max(0.5, Math.min(seconds * 0.25, seconds - 2)) : 3;
      await new Promise<void>((ok, fail) =>
        execFile("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", video, "-vf", "thumbnail=40,scale=480:-2", "-frames:v", "1", "-q:v", "5", out], { timeout: 60_000 }, (e) => (e ? fail(e) : ok())),
      );
      return existsSync(out) ? out : undefined;
    } catch {
      return undefined;
    } finally {
      active--;
      waiting.shift()?.();
      making.delete(id);
    }
  })();
  making.set(id, job);
  return job;
}
