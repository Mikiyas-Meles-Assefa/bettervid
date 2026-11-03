// The linker: an agent (role "reader") reads every card of a project and says where one file states what matters in
// another, or in the video itself (a syllabus marks a figure in the slides as essential, a brand guide fixes colors,
// a brief names claims that must be said or never said). Each requirement cites the file and the part that states it.
// The check makes sure every requirement names real files and parts; problems go back to the linker to repair.
import type { AgentTask, PartCard, Requirement } from "../types.ts";

export const linkSchema = {
  type: "object",
  required: ["requirements"],
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "source", "kind", "detail", "why"],
        properties: {
          id: { type: "string", description: "a short id of your own, unique in the list" },
          source: {
            type: "object",
            required: ["file", "where"],
            properties: { file: { type: "string", description: "the name of the card that states it" }, where: { type: "string", description: "the name of the part of that card that states it" } },
          },
          applies: { type: "string", description: "what it is about: a card's name, or a card's name, a dot and one of its parts; leave it out when it is about the whole video" },
          kind: { type: "string", description: "what kind of requirement, in a few words of your own" },
          detail: { type: "string", description: "exactly what is required, with the values the source gives (colors, numbers, words, durations)" },
          why: { type: "string", description: "why the source asks it, in its own terms" },
        },
      },
    },
  },
} as const;

export const LINKER_SYSTEM = `You read the cards of every file a person gave for one video: documents, notes, tables, code, pictures, each already read into named parts. Some files say what matters in others or in the video: a course outline or a grading guide that marks one figure as essential or a topic as tested, a style or brand note that fixes colors, type or a logo, a brief that names the claims that must be said or must never be said, a newer version that replaces an older one, a note that says how long something must stay on screen or how it must be shown.

Find every such statement and turn it into a requirement of the video. For each, cite the card and the part that states it (the part's name exactly as on the card), say what it applies to (a card, or a card and one of its parts, by name, exactly as on the cards; leave it out when it is about the whole video), what is required with the values the source gives, and why. Only what the files state: never invent a requirement, never turn a file's content into a requirement just because it is content. If no file states any, return an empty list.`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function cardSummary(c: PartCard, max = 160): string {
  const parts = Object.entries(c.parts).map(([k, p]) => `  - ${c.name}.${k}: ${p.about}${p.text ? ` | "${clip(p.text, max)}"` : ""}`);
  const data = c.data ? `\n  data: ${c.data.labels.map((l, i) => `${l} ${c.data!.values[i]}`).join("; ")}` : "";
  return `- ${c.name} (file ${c.file}, ${c.kind}): ${c.about}${data}\n${parts.join("\n")}`;
}

export function linkTask(cards: PartCard[], request?: string, id = "link"): AgentTask {
  return {
    role: "reader",
    id,
    system: LINKER_SYSTEM,
    request: `${request ? `The person asked for: ${request}\n\n` : ""}The cards (each part as card.part: what it is | its words):\n${cards.map((c) => cardSummary(c)).join("\n")}`,
    schema: linkSchema as unknown as Record<string, unknown>,
  };
}

/** The card and part a name points at: "card", "card.part", or the card's file name in place of its name. */
export function resolve(name: string, cards: PartCard[]): { card: PartCard; part?: string } | undefined {
  for (const c of cards)
    for (const key of [c.name, c.file]) {
      if (name === key) return { card: c };
      if (name.startsWith(`${key}.`) && c.parts[name.slice(key.length + 1)]) return { card: c, part: name.slice(key.length + 1) };
    }
  return undefined;
}

export function checkRequirements(reqs: Requirement[], cards: PartCard[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of reqs) {
    const at = `requirement ${r.id || "(no id)"}`;
    if (!r.id) out.push(`${at}: no id`);
    else if (seen.has(r.id)) out.push(`${at}: the id is used twice`);
    seen.add(r.id);
    const src = cards.find((c) => c.name === r.source?.file || c.file === r.source?.file);
    if (!src) out.push(`${at}: source file "${r.source?.file}" is not one of the cards (${cards.map((c) => c.name).join(", ")})`);
    else if (!r.source.where) out.push(`${at}: no part of ${src.name} given as where it is stated`);
    else if (!src.parts[r.source.where] && !resolve(r.source.where, [src])?.part) out.push(`${at}: "${r.source.where}" is not a part of ${src.name}`);
    if (r.applies !== undefined && r.applies !== "" && !resolve(r.applies, cards)) out.push(`${at}: it applies to "${r.applies}", which is not a card or a card's part`);
    if (!r.detail?.trim()) out.push(`${at}: no detail`);
  }
  return out;
}

/** The source part's name without its card's prefix, so cards.json holds one form. */
export function tidy(r: Requirement, cards: PartCard[]): Requirement {
  const src = cards.find((c) => c.name === r.source.file || c.file === r.source.file);
  if (!src) return r;
  const where = r.source.where && !src.parts[r.source.where] ? resolve(r.source.where, [src])?.part ?? r.source.where : r.source.where;
  const applies = r.applies ? resolve(r.applies, cards) : undefined;
  return { ...r, source: { file: src.name, where }, ...(applies ? { applies: applies.part ? `${applies.card.name}.${applies.part}` : applies.card.name } : {}) };
}
