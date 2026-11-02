// Turns the director's shots (pictures, timing, zoom targets, marks) into scene language, so documentaries run on the
// engine too. The scene stage hands each section's part to Spark as a starting point it can add to.
//
// Everything here is written with general words of the language (a picture that fills the frame, the camera, marks at
// places inside a picture, entrances, cuts), so what a documentary does, any scene can do, and Spark can edit it.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Asset, Mark, Project, Shot, ShotType } from "../../schemas/project.ts";
import { safeArea } from "../../engine/language/layout.ts";
import { dir } from "./project.ts";

const FPS = 30;
const W = 1080;
const H = 1920;
const SAFE = safeArea(W, H);

type Moment = { word: number; offset: number };
type Event = { at: Moment; lines: string[]; cut?: boolean; move?: number };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const quote = (s: string) => `"${s.replace(/"/g, "”").replace(/\s+/g, " ").trim()}"`;
const moment = (m: Moment) => `@${m.word}${m.offset > 0 ? `+${m.offset}` : m.offset < 0 ? `${m.offset}` : ""}`;
const later = (a: Moment, b: Moment) => a.word - b.word || a.offset - b.offset;

// `source` uses global spoken-word numbers; `assets` maps asset names used in the source to files in the project folder.
export function shotsToScene(p: Project): { source: string; assets: Record<string, string> } {
  const words = p.narration?.words ?? [];
  const shots = [...(p.shots ?? [])].sort((a, b) => a.start - b.start);
  if (!words.length || !shots.length) throw new Error(`shotsToScene needs narration and shots (project ${p.id})`);
  const byShot = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
  const assets: Record<string, string> = {};
  const nameOf = (path: string) => {
    const name = basename(path).replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9]/g, "") || "picture";
    let unique = name;
    for (let i = 2; assets[unique] !== undefined && assets[unique] !== path; i++) unique = `${name}${i}`;
    assets[unique] = path;
    return unique;
  };
  // The spoken word a shot starts on: shots are snapped to word times, so this is the word at (or just after) its start.
  const wordAt = (seconds: number) => {
    const i = words.findIndex((w) => w.start >= seconds - 0.02);
    return i < 0 ? words.length - 1 : i;
  };
  const sameFile = (a?: string, b?: string) => {
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      return readFileSync(join(dir(p), a)).equals(readFileSync(join(dir(p), b)));
    } catch {
      return false;
    }
  };

  const events: Event[] = [];
  let lastImage: { path: string; id: string } | undefined;
  let first = true;
  shots.forEach((shot, index) => {
    const a = byShot.get(shot.id);
    // A shot with no honest image is dropped, and the shot before holds through it (at the very start, the next one).
    if (a?.missing) return;
    const type: ShotType = a?.override?.type ?? shot.type;
    const start: Moment = { word: first ? 0 : wordAt(shot.start), offset: 0 };
    const next = shots.slice(index + 1).find((s) => !byShot.get(s.id)?.missing);
    const endWord = next ? wordAt(next.start) : words.length;
    const seconds = Math.max(0.5, (next ? next.start : (words.at(-1)?.end ?? shot.end) + 0.6) - words[start.word]!.start);
    const frames = Math.round(seconds * FPS);
    const made = shotLines(shot, a, type, index, start, frames, endWord);
    if (!made) return;
    first = false;
    events.push(...made);
  });
  const ordered = events.map((e, i) => ({ e, i })).sort((x, y) => later(x.e.at, y.e.at) || x.i - y.i).map((x) => x.e);
  // Two events at one moment become one state.
  const merged: Event[] = [];
  for (const e of ordered) {
    const prev = merged.at(-1);
    if (prev && !later(prev.at, e.at) && !e.cut) prev.lines.push(...e.lines);
    else merged.push({ ...e, lines: [...e.lines] });
  }
  const source = merged.map((e) => [`${moment(e.at)}${e.cut ? " cut" : " keep"}${e.move ? ` move=${e.move}` : ""}`, ...e.lines].join("\n")).join("\n");
  return { source: `${source}\n`, assets };

  function shotLines(shot: Shot, a: Asset | undefined, type: ShotType, index: number, start: Moment, frames: number, endWord: number): Event[] | undefined {
    const id = `s${index + 1}`;
    const out: Event[] = [];
    const cut = (lines: string[]) => out.push({ at: start, cut: true, lines });
    const keep = (at: Moment, lines: string[], move?: number) => out.push({ at, lines, ...(move ? { move } : {}) });

    if (type === "kinetic_title" || (!a?.path && (a?.override?.text ?? shot.text))) {
      const text = (a?.override?.text ?? shot.text ?? "").toUpperCase().split(/\s+/).map((w) => w.replace(/[\s=:"{}[\]|]/g, "")).filter(Boolean);
      if (!text.length) return undefined;
      // Words slam down one after another, on a field of ink; the last one in the highlight color.
      const per = Math.max(4, Math.floor(Math.min(frames * 0.6, FPS * 1.2) / text.length));
      const lines: number[][] = [[]];
      text.forEach((w, i) => {
        const line = lines.at(-1)!;
        if (line.length && [...line.map((j) => text[j]!), w].join(" ").length > 11) lines.push([i]);
        else line.push(i);
      });
      const atomsUpTo = (n: number) =>
        lines
          .map((line) => line.filter((i) => i <= n))
          .filter((line) => line.length)
          .map((line, li) => `huge ${id}t${li + 1} color=paper enter=slam: ${line.map((i) => `${id}w${i + 1}=${text[i]!}`).join(" ")}`);
      text.forEach((_, i) => {
        const body = [...(i === 0 ? [`box ${id}bg frame=fill fill=ink`] : []), ...atomsUpTo(i), ...(i === text.length - 1 && text.length > 1 ? [`set ${id}w${i + 1} color=highlight`] : [])];
        if (i === 0) cut(body);
        else keep({ word: start.word, offset: i * per }, body);
      });
      lastImage = undefined;
      return out;
    }

    if (type === "receipt" && shot.receipt) {
      const r = shot.receipt;
      // A source card: who said it and when, the quoted line, and where it lives. The line gets a highlighter sweep.
      const words = r.quote.split(/\s+/);
      let q = "";
      for (const w of words) if ((q + " " + w).length <= 280) q = q ? `${q} ${w}` : w;
      if (q.length < r.quote.trim().length) q += "…";
      const where = r.url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
      const head = [r.outlet, r.date].filter(Boolean).join(" · ").toUpperCase();
      cut([
        `box ${id}bg frame=fill fill=ink opacity=0.14`,
        `stack ${id} back=paper gap=34 align=left enter=rise`,
        ...(head ? [`  text ${id}o ${quote(head)} size=small align=left opacity=0.7`] : []),
        `  text ${id}q ${quote(`“${q}”`)} size=${q.length > 160 ? "small" : "normal"} w=${q.length > 160 ? 720 : 760} align=left`,
        ...(where ? [`  text ${id}u ${quote(where)} size=small align=left opacity=0.6`] : []),
      ]);
      keep({ word: start.word, offset: 12 }, [`mark highlight ${id}q`], 24);
      lastImage = undefined;
      return out;
    }

    if (!a?.path) return undefined;
    const [iw, ih] = a.size ?? [W, H];
    const picture = nameOf(a.path);

    if (type === "cutout_on_paper" && a.cutout) {
      // The cut-out subject springs onto paper, with its source faint behind it.
      const cutName = nameOf(a.cutout);
      const side = index % 2 ? "slide" : "slide-left";
      cut([
        `image ${id} asset=${picture} w=${iw} h=${ih} frame=fill opacity=0.18`,
        `set ${id} saturation=0 blur=2`,
        `image ${id}c asset=${cutName} w=${iw} h=${ih} enter=${side} rotate=${index % 2 ? 2.5 : -2.5}`,
        `camera zoom=1 drift=${r3(0.02 / Math.max(1, frames / FPS))}`,
      ]);
      lastImage = undefined;
      return out;
    }

    // A picture filling the frame. The same picture as the shot before stays the same thing, and the camera punches in.
    const again = lastImage && sameFile(lastImage.path, a.path);
    const pid = again ? lastImage!.id : id;
    lastImage = { path: a.path, id: pid };
    const shown = again ? [] : [`image ${pid} asset=${picture} w=${iw} h=${ih} frame=fill`];
    const cover = Math.max(W / iw, H / ih);
    const marks = (a.marks ?? []).filter((m) => m.word < endWord).map((m) => ({ m, at: { word: Math.max(start.word, m.word), offset: 0 } }));
    if (a.focus && a.size) {
      // A guided zoom: from the whole picture to the part the narration is about, landing before the shot is half over,
      // then drifting closer. Scans hold up to about 2.6 times the covering size before they look soft.
      const f = a.focus;
      const box = { w: f.w * iw, h: f.h * ih };
      const region = { w: Math.max(box.w * 2.4, iw * 0.3), h: Math.max(box.h * 2.4, ih * 0.2) };
      const end = a.zoom ? Math.min(Math.max(Math.min(W / region.w, H / region.h), cover * 1.2), cover * 2.6) : cover * 1.06;
      // The camera frames a region into the safe area, so ask for the region that comes out at that size.
      const [rw, rh] = [Math.min(1, SAFE.w / end / iw), Math.min(1, SAFE.h / end / ih)];
      const [cx, cy] = [Math.min(1 - rw / 2, Math.max(rw / 2, f.x + f.w / 2)), Math.min(1 - rh / 2, Math.max(rh / 2, f.y + f.h / 2))];
      const land = Math.max(6, Math.round(Math.min(frames * 0.5, 2.2 * FPS)));
      cut([...shown, `camera ${pid} zoom=1.02`, ...marksAt(marks, pid, start)]);
      keep({ word: start.word, offset: 1 }, [`camera ${pid} at=${[cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2].map(r3).join(",")} frames=${land} ease=smooth drift=0.012`]);
    } else {
      // A slow push-in, harder when the picture repeats.
      const [from, to] = again ? [1.45, 1.6] : [1.04, 1.16];
      cut([...shown, `camera ${pid} zoom=${from} drift=${r3((to / from - 1) / Math.max(0.5, frames / FPS))}`, ...marksAt(marks, pid, start)]);
    }
    for (const { m, at } of marks) if (later(at, start) > 0) keep(at, markLine(m, pid));
    return out;
  }

  // Marks on the cut itself are written with it; later ones get their own moment.
  function marksAt(list: { m: Mark; at: Moment }[], pid: string, start: Moment): string[] {
    return list.filter(({ at }) => !later(at, start)).flatMap(({ m }) => markLine(m, pid));
  }

  function markLine(m: Mark, pid: string): string[] {
    const pts = m.points.flatMap(([x, y]) => [r3(Math.min(1.4, Math.max(-0.4, x))), r3(Math.min(1.4, Math.max(-0.4, y)))]);
    const color = m.color ? ` color=${m.color}` : "";
    if (m.tool === "label") return m.text ? [`tag ${pid} ${quote(m.text)} at=${pts.slice(0, 2).join(",")}`] : [];
    if ((m.tool === "ring" || m.tool === "box") && pts.length < 4) return [];
    if (m.tool !== "dots" && pts.length < 4) return [];
    return [`mark ${m.tool} ${pid} at=${(m.tool === "ring" || m.tool === "box" ? pts.slice(0, 4) : pts).join(",")}${color}`];
  }
}
