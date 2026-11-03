// The user's material as each stage reads it: cards by name, with every part's location, so a stage can cite a part and
// nothing arrives as one merged blob.
import { cardSummary } from "../../engine/design/material/index.ts";
import type { PartCard } from "../../engine/design/types.ts";
import type { Project } from "../../schemas/project.ts";

const own = (p: Project): PartCard[] => {
  const names = new Set(p.material?.uploaded?.cards ?? []);
  return (p.material?.cards ?? []).filter((c) => names.has(c.name));
};

/** One card's lines within a budget of characters. Headings always stay; a card cut short says how much is not listed. */
function listed(c: PartCard, budget: number): string {
  const full = cardSummary(c, 500);
  if (full.length <= budget) return full;
  const [head, ...lines] = full.split("\n");
  const keep = new Set(lines.filter((l) => /\.heading\.\d+:|\.title:/.test(l)));
  let used = head!.length + [...keep].reduce((n, l) => n + l.length + 1, 0);
  for (const l of lines) {
    if (keep.has(l) || used + l.length + 1 > budget) continue;
    keep.add(l);
    used += l.length + 1;
  }
  const left = lines.length - keep.size;
  return [head, ...lines.filter((l) => keep.has(l)), ...(left ? [`  (${left} more parts of ${c.name} are not listed here because the file is long)`] : [])].join("\n");
}

export function requirementsText(p: Project): string {
  const names = new Set(p.material?.uploaded?.cards ?? []);
  const reqs = (p.material?.requirements ?? []).filter((r) => names.has(r.source.file));
  if (!reqs.length) return "";
  return `What the user's files require of this video (each cites the part that states it):\n${reqs.map((r) => `- ${r.id} (${r.kind}, from ${r.source.file}.${r.source.where}${r.applies ? `, about ${r.applies}` : ""}): ${r.detail} Why: ${r.why}`).join("\n")}`;
}

/** The cards, requirements and problems, for a stage that works from what the files say. "" when there are no files. */
export function materialText(p: Project, max: number): string {
  const cards = own(p);
  const problems = p.material?.uploaded?.problems ?? [];
  if (!cards.length && !problems.length) return "";
  const share = Math.floor(max / Math.max(1, cards.length));
  return [
    cards.length ? `The files the user gave, read into named parts (each line is card.part: where it stands | its words):\n${cards.map((c) => listed(c, share)).join("\n")}` : "",
    requirementsText(p),
    problems.length ? `What could not be read from their files (do not guess at it):\n${problems.map((x) => `- ${x}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** A short note of what was given, for reading the request before any planning. */
export function materialNote(p: Project): string {
  const cards = own(p);
  if (!cards.length) return "";
  const heads = (c: PartCard) => Object.entries(c.parts).filter(([k]) => /(^|\.)heading\.\d+$/.test(k)).slice(0, 12).map(([, v]) => v.text).join("; ");
  return `The user attached these files, which are read separately and go to every later stage. Use them to understand the request (what the video is about, if their message does not say). Do not copy their contents into \`material\`.\n${cards.map((c) => `- ${c.name} (${c.kind}): ${c.about}${heads(c) ? ` Headings: ${heads(c)}` : ""}`).join("\n")}`;
}

/** The user's own pictures, by card name, with where each file is inside the project. */
export function ownPictures(p: Project): { card: PartCard; path: string }[] {
  const paths = p.material?.uploaded?.pictures ?? {};
  return own(p).filter((c) => paths[c.name]).map((card) => ({ card, path: paths[card.name]! }));
}

/** The pictures for the director, or "" when the user gave none. */
export function picturesText(p: Project): string {
  const pics = ownPictures(p);
  if (!pics.length) return "";
  const lines = pics.map(({ card: c }) => `- ${c.name} (${c.kind}): ${c.about}${c.requirements.length ? ` Required of it: ${c.requirements.map((r) => r.detail).join(" ")}` : ""}`);
  return `The user's own pictures. They come first: where one shows what the words say at that moment, set \`kind\` to "own" with its exact name in \`query\`, type \`photo_kenburns\`, a \`focus\` for where to look, and leave \`prompt\`, \`broadQuery\`, \`draw\` and \`subject\` empty. Use another kind only where none of them fits the moment.\n${lines.join("\n")}`;
}

