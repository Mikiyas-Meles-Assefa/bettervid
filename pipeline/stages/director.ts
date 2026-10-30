// Stage 4: director. Spark plans shots on word indices; code turns them into timed shots and fills
// receipts from the fact sheet so outlets, quotes and URLs are never invented.
import type { ImageType, Project, Shot, ShotType } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { asked, charge, prompt, stage, style, topic } from "../lib/project.ts";

type Planned = { beatId: string; type: ShotType; startWord: number; kind: "real" | "generated" | "none"; query: string; broadQuery: string; prompt: string; idea: string; imageType: ImageType; subject: string; focus: string; mustBeReal: boolean; text: string; claimId: string };

const str = { type: "string" } as const;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["shots"],
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["beatId", "type", "startWord", "kind", "query", "broadQuery", "prompt", "idea", "imageType", "subject", "focus", "mustBeReal", "text", "claimId"],
        properties: {
          beatId: str,
          type: { type: "string", enum: ["photo_kenburns", "cutout_on_paper", "receipt", "kinetic_title"] },
          startWord: { type: "integer" },
          kind: { type: "string", enum: ["real", "generated", "none"] },
          query: str,
          broadQuery: str,
          prompt: str,
          idea: str,
          imageType: { type: "string", enum: ["scene", "object", "diagram"] },
          subject: str,
          focus: str,
          mustBeReal: { type: "boolean" },
          text: str,
          claimId: str,
        },
      },
    },
  },
} as const;

const REAL_POLICY = {
  prefer: "This style is documentary collage: use real archival images wherever they exist, and generated art only for moments no camera or archive captured.",
  proof:
    "This style is fully illustrated: generate almost every image in the style so the video looks unified. Use real images only as proof: a real person's portrait, a real document or map, or a real photo of the actual event. Never use real paintings or stock scenery for ideas, places or moods.",
};

export async function director(p: Project, force = false) {
  const n = p.narration!;
  const system = prompt("director")
    .replace("{{craft}}", prompt("craft-rules"))
    .replace("{{minShots}}", String(Math.round(n.seconds / 5)))
    .replace("{{maxShots}}", String(Math.round(n.seconds / 2.5)))
    .replace("{{seconds}}", String(Math.round(n.seconds)))
    .replace("{{mode}}", p.input.mode)
    .replace("{{realPolicy}}", REAL_POLICY[style(p.input.style).realAssets]);
  const words = n.words.map((w, i) => `${i} ${w.start.toFixed(2)}s ${w.text}`).join("\n");
  const user =
    `Topic: ${topic(p)}\n\n${asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])])}\n\nScript beats:\n${JSON.stringify(p.script!.beats, null, 1)}\n\n` +
    `Fact sheet claims:\n${JSON.stringify(p.factSheet!.claims, null, 1)}\n\nWords (index, start time, word):\n${words}`;
  await stage(p, "director", [system, user], 0.2, async () => {
    const r = await json<{ shots: Planned[] }>({ system, user, schema, schemaName: "shot_list", effort: "medium" });
    charge(p, "director", r.usd, `${r.raw.usage?.input_tokens} in, ${r.raw.usage?.output_tokens} out`);
    p.shots = toShots(p, r.value.shots);
  }, force);
}

const MIN_SECONDS: Record<ShotType, number> = { receipt: 3.5, kinetic_title: 1.5, photo_kenburns: 1.2, cutout_on_paper: 1.2, credits: 0, board: 0 };

// Sorts and clamps start words, drops shots that would cut the one before too short, then times each shot from its first word to the next shot.
export function toShots(p: Project, planned: Planned[]): Shot[] {
  const n = p.narration!;
  const claims = new Map(p.factSheet!.claims.map((c) => [c.id, c]));
  const sources = new Map(p.factSheet!.sources.map((s) => [s.id, s]));
  const sorted = planned
    .map((s) => ({ ...s, startWord: Math.min(Math.max(0, s.startWord), n.words.length - 1) }))
    .sort((a, b) => a.startWord - b.startWord);
  if (sorted[0]) sorted[0].startWord = 0;
  // Every shot must be on screen long enough to take in; a shot that would cut one short is dropped,
  // so the earlier shot holds instead. A source card has to be readable, so it gets the longest minimum.
  const list: Planned[] = [];
  for (const s of sorted) {
    const prev = list.at(-1);
    if (prev && n.words[s.startWord]!.start - n.words[prev.startWord]!.start < MIN_SECONDS[prev.type]) continue;
    list.push(s);
  }
  return list.map((s, i): Shot => {
    const start = i === 0 ? 0 : n.words[s.startWord]!.start;
    const end = i + 1 < list.length ? n.words[list[i + 1]!.startWord]!.start : n.seconds + 0.6;
    const shot: Shot = { id: `shot${i + 1}`, beatId: s.beatId, type: s.type, start, end };
    const claim = claims.get(s.claimId);
    const source = claim && sources.get(claim.sourceIds[0]!);
    if (s.type === "receipt" && claim?.quote && source) {
      shot.receipt = { outlet: source.publisher, date: source.date || undefined, url: source.url, quote: claim.quote };
    } else if (s.type === "receipt" || s.type === "kinetic_title") {
      // A receipt without a quotable claim falls back to a title card of the claim's number, or the beat's emphasis.
      shot.type = "kinetic_title";
      shot.text = s.text || claim?.number || p.script!.beats.find((b) => b.id === s.beatId)?.emphasis.join(" ") || "";
    }
    if (s.type === "photo_kenburns" || s.type === "cutout_on_paper") {
      shot.asset = { kind: s.kind === "real" ? "real" : "generated", query: s.query, prompt: s.prompt, imageType: s.imageType, subject: s.subject || undefined };
      if (s.broadQuery && s.broadQuery !== s.query) shot.asset.broadQuery = s.broadQuery;
      if (s.type === "photo_kenburns" && s.focus) shot.asset.focus = s.focus;
      if (s.kind === "real" && s.mustBeReal) shot.asset.mustBeReal = true;
      if (shot.asset.mustBeReal && s.idea) shot.asset.idea = s.idea;
    }
    return shot;
  });
}
