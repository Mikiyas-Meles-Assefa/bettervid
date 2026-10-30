// Stage 8: critic. Spark reviews one frame per shot against the words spoken over it and files tickets from a fixed menu
// (spike S5: frames catch everything except timing, which code enforces). One fix round applies them and re-renders.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
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

export async function critic(p: Project, force = false) {
  const t = p.timeline!;
  await stage(p, "critic", [t, prompt("critic")], 0.15, async () => {
    const words = p.narration!.words;
    const clips = t.clips.filter((c) => c.image);
    if (!clips.length) return; // a board has no shots to swap; it has its own checks
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
