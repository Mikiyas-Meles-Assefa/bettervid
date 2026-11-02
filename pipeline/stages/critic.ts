// Stage 8: critic. Spark reviews one frame per shot against the words spoken over it and files tickets from a fixed menu
// (spike S5: frames catch everything except timing, which code enforces). One fix round applies them and re-renders.
// Engine videos are judged by the look step's judge (pipeline/lib/look.ts) on the final render, and get notes only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
import { KITS } from "../../engine/kits/index.ts";
import { parse } from "../../engine/language/syntax.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { inventory, judgeSchema, lookFrames, measureLayout, readOf, wordsOnScreen, type Judged } from "../lib/look.ts";
import { json } from "../lib/meta.ts";
import { asked, charge, dir, prompt, save, stage, style, topic } from "../lib/project.ts";
import { replaceImage } from "./assets.ts";
import { mix } from "./mix.ts";
import { render } from "./render.ts";
import { timeline } from "./timeline.ts";

type Ticket = { shotId: string; action: "swap_image" | "regenerate_image" | "remove_marks"; note: string };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "tickets"],
  properties: {
    verdict: { type: "string" },
    tickets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["shotId", "action", "note"],
        properties: { shotId: { type: "string" }, action: { type: "string", enum: ["swap_image", "regenerate_image", "remove_marks"] }, note: { type: "string" } },
      },
    },
  },
} as const;

// The frames an engine video is judged on: the end of each state, when it has settled, a few per section.
export function engineMoments(p: Project, fps: number, perSection = 3): { section: string; frame: number }[] {
  const words = p.narration!.words;
  const at = (w: number) => Math.round((words[Math.min(w, words.length - 1)]?.start ?? 0) * fps);
  const kinds = KITS.flatMap((k) => Object.keys(k.kinds ?? {})).filter((k) => k !== "graph");
  const sections = p.scene?.sections ?? [];
  return sections.flatMap((s, i) => {
    const starts = parse(s.source, kinds).doc.states.map((x) => at(x.at.word));
    const end = sections[i + 1] ? at(sections[i + 1]!.firstWord) - 2 : Math.round((p.narration!.seconds - 0.2) * fps);
    const settled = lookFrames(starts, at(s.firstWord), end, fps, perSection * 2).filter((m) => m.why === "settled");
    const pick = settled.length <= perSection ? settled : Array.from({ length: perSection }, (_, k) => settled[Math.round((k * (settled.length - 1)) / (perSection - 1 || 1))]!);
    return pick.map((m) => ({ section: s.id, frame: m.frame }));
  });
}

// An engine video: the finished render is judged near full size with the words, the exact on-screen text, what the
// scene measures and the research facts, by the same judge as the scene step's look. The scene step has already fixed
// what it could, so this files notes per section and does not re-render.
async function engineCritic(p: Project, video: string) {
  const t = p.timeline!;
  const clip = t.clips.find((c) => c.type === "engine" && c.scene);
  if (!clip?.scene || !p.scene?.sections.length) return;
  const words = p.narration!.words;
  const read = readOf(clip.theme ?? themeFrom(p.input.style));
  const moments = engineMoments(p, t.fps);
  const facts = (p.factSheet?.claims ?? []).map((c) => `- ${c.text}`).join("\n");
  const head = `Topic: ${topic(p)}\nVisual style: ${p.input.style || "default"}\n\nResearch facts the video is built on:\n${facts || "(none listed)"}`;
  const tickets: Project["critic"] = { verdict: "", tickets: [] };
  let usd = 0;
  const designs: number[] = [];
  // About four sections per call, so each call sees a stretch of the video in order.
  for (let i = 0; i < moments.length; i += 12) {
    const group = moments.slice(i, i + 12);
    const content: unknown[] = [{ type: "input_text", text: head }];
    group.forEach((m, k) => {
      const file = join(dir(p), "assets", `critic-${i + k}.jpg`);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", (m.frame / t.fps).toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=648:-2", "-q:v", "3", file]);
      const things = inventory(clip.scene!, m.frame - clip.from);
      const found = measureLayout(things, clip.scene!.width, clip.scene!.height, read).filter((f) => f.severity >= 2);
      const said = words.filter((w) => w.start * t.fps >= m.frame - 2.5 * t.fps && w.start * t.fps <= m.frame + 0.5 * t.fps).map((w) => w.text).join(" ");
      content.push({ type: "input_text", text: `Frame ${k + 1} (part ${m.section}), at ${(m.frame / t.fps).toFixed(1)} s (settled). Words around it: "${said}"\nOn screen: ${wordsOnScreen(things).join(" / ") || "(no writing)"}\nMeasured: ${found.map((f) => `[${f.severity}] ${f.note}`).join("; ") || "nothing found"}` });
      content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(file).toString("base64")}` });
    });
    const judge = (prompt("scene-look").split(/^# /m).find((x) => x.startsWith("Judge")) ?? "").slice(5).trim();
    const r = await json<Judged>({ system: judge, user: content, schema: judgeSchema, schemaName: "look", effort: "medium" });
    usd += r.usd;
    designs.push(r.value.design);
    for (const x of r.value.issues.filter((y) => y.severity >= 2)) {
      const sections = [...new Set(x.frames.map((f) => group[f - 1]?.section).filter(Boolean))] as string[];
      tickets.tickets.push({ shotId: sections.join(",") || group[0]!.section, action: `look:${x.kind}:${x.severity}`, note: `${x.what} Should be: ${x.want}` });
    }
  }
  const severe = tickets.tickets.filter((x) => x.action.endsWith(":3")).length;
  tickets.verdict = `Design ${(designs.reduce((a, b) => a + b, 0) / Math.max(1, designs.length)).toFixed(1)} of 5; ${tickets.tickets.length} issues, ${severe} severe.`;
  p.critic = tickets;
  charge(p, "critic", usd, tickets.verdict);
  console.log(`  ${tickets.verdict}`);
  for (const x of tickets.tickets) console.log(`  ${x.shotId} ${x.action}: ${x.note.slice(0, 200)}`);
}

export async function critic(p: Project, force = false) {
  const t = p.timeline!;
  await stage(p, "critic", [t, prompt("critic"), prompt("scene-look")], 0.15, async () => {
    const words = p.narration!.words;
    const clips = t.clips.filter((c) => c.image);
    if (t.clips.some((c) => c.type === "engine")) return engineCritic(p, join(dir(p), "video.mp4"));
    if (!clips.length) return; // a board or stage has no shots to swap; each has its own checks
    const video = join(dir(p), "video.mp4");
    const frames = clips.flatMap((c, i) => {
      // Late in the shot, so moves have landed and marks are drawn.
      const at = (c.from + Math.min(c.frames * 0.85, c.frames - 3)) / t.fps;
      const file = join(dir(p), "assets", `critic-${i}.jpg`);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=432:-2", "-q:v", "4", file]);
      const said = words.filter((w) => w.start * t.fps >= c.from && w.start * t.fps < c.from + c.frames).map((w) => w.text).join(" ");
      return [
        { type: "input_text", text: `${c.shotId} (${c.type}${c.credit ? ", real image" : ", generated image"}), spoken: "${said}"` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(file).toString("base64")}` },
      ];
    });
    const wishes = asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])]);
    const r = await json<{ verdict: string; tickets: Ticket[] }>({
      system: prompt("critic"),
      user: [{ type: "input_text", text: `Topic: ${topic(p)}${wishes ? `\n\n${wishes}` : ""}` }, ...frames],
      schema,
      schemaName: "review",
      effort: "medium",
    });
    charge(p, "critic", r.usd, `${r.value.tickets.length} tickets: ${r.value.verdict.slice(0, 100)}`);
    console.log(`  ${r.value.verdict}`);
    const assets = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
    const tickets = r.value.tickets.filter((x) => assets.has(x.shotId));
    p.critic = { verdict: r.value.verdict, tickets };
    if (!tickets.length) return;

    // The one fix round.
    const s = style(p.input.style);
    const spend = { usd: 0, notes: [] as string[] };
    for (const x of tickets) {
      console.log(`  ${x.shotId} ${x.action}: ${x.note}`);
      const a = assets.get(x.shotId)!;
      if (x.action === "remove_marks") a.marks = [];
      else await replaceImage(p, x.shotId, x.note, s, spend);
    }
    for (const n of spend.notes) console.log(`  ${n}`);
    charge(p, "critic", spend.usd, `fix round: ${tickets.length} tickets`);
    await save(p);
    await timeline(p, true);
    await mix(p, true);
    await render(p, true);
  }, force);
}
