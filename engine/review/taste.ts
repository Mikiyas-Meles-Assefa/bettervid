// The taste review: an art director's judgment of a moment's frames, from the model's own eye and the moment's context.
// It runs beside the look review on the same stills, and its fixes join the same single repair request, so it adds a
// call, not a round. It measures nothing and decides nothing about the scene: the writer acts on its notes or not.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { text, type Ask, type AskCall, type Part } from "./model.ts";

export type TasteContext = {
  words: string; // what is spoken over the frames
  purpose: string; // what the moment is for
  intent?: string; // what the whole video is for
  style: { name: string; palette?: string[]; fonts?: string[]; texture?: string };
  audience?: string; // age, level, culture, when known
  platform?: string; // where and how it is watched, e.g. "phone, vertical, sound on"
  means?: string[]; // what the scene's writer can do, in the language's own words, so each fix can name its means
  asked?: string[]; // the fixes asked for before a repair: the frames are then the repaired ones, and the question is whether the weakest element is fixed
};

export type TasteFrame = { at: number; image: Part; readings?: string }; // `at` in seconds from the moment's start; `readings`: what the instruments measured on it

export type TasteVerdict = { verdict: "ship" | "revise"; weakest: string; fixes: string[]; reason: string };

export const TASTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "weakest", "fixes", "reason"],
  properties: {
    verdict: { type: "string", enum: ["ship", "revise"] },
    weakest: { type: "string" },
    fixes: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
} as const;

const PROMPT = join(import.meta.dirname, "../../prompts/taste-review.md");

export function imageFile(path: string): Part {
  const mime = extname(path).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  return { type: "input_image", image_url: `data:${mime};base64,${readFileSync(path).toString("base64")}` };
}

export function tasteRequest(frames: TasteFrame[], c: TasteContext): Part[] {
  const s = c.style;
  const lines = [
    `Words spoken: "${c.words}"`,
    `Purpose of this moment: ${c.purpose}`,
    c.intent && `The video is for: ${c.intent}`,
    `Style: ${s.name}${s.palette?.length ? `; palette ${s.palette.join(", ")}` : ""}${s.fonts?.length ? `; fonts ${s.fonts.join(", ")}` : ""}${s.texture ? `; texture ${s.texture}` : ""}`,
    c.audience && `Audience: ${c.audience}`,
    c.platform && `Plays on: ${c.platform}`,
    c.means?.length && `What the scene's writer can do, in its own words (name the means each fix would use):\n${c.means.map((m) => `- ${m}`).join("\n")}`,
    c.asked?.length && `These fixes were asked for, and the writer repaired the part. The frames below are the repaired ones:\n${c.asked.map((m) => `- ${m}`).join("\n")}`,
    `Frames, in order (${frames.length}):`,
  ].filter(Boolean) as string[];
  return [text(lines.join("\n")), ...frames.flatMap((f) => [text(`At ${f.at.toFixed(1)} s:${f.readings ? `\nWhat the instruments read on this frame:\n${f.readings}` : ""}`), f.image])];
}

// One call. The model is the caller's choice: Spark by default (cheap on the Contributor tier), Wonder for a stronger eye.
export async function tasteReview(ask: Ask, frames: TasteFrame[], c: TasteContext, model: AskCall["model"] = "muse-spark-1.3"): Promise<TasteVerdict> {
  if (!frames.length) throw new Error("taste review: no frames to look at");
  const v = await ask<TasteVerdict>({ model, effort: "medium", system: readFileSync(PROMPT, "utf8"), user: tasteRequest(frames, c), schema: TASTE_SCHEMA, name: "taste" });
  if (v.verdict === "revise" && !v.fixes.length) throw new Error("taste review: revise with no fixes");
  return v;
}

// The notes as the writer reads them in its one repair request, beside build errors, measurements and the look review.
export function tasteNotes(v: TasteVerdict): string[] {
  if (v.verdict === "ship") return [];
  return [`Art director: the weakest element is ${v.weakest}. ${v.reason}`, ...v.fixes.map((f) => `Art director fix: ${f}`)];
}
