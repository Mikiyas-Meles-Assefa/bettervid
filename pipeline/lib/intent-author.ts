// The intent author's prompts and checks, shared by the scene stage and the bench, so both ask and check the same way.
// The author writes an intent plan (prompts/intent.md): what matters at each moment, never where,
// how big, what color or how it moves. Where the engine already has the exact thing a moment needs (a computed
// demonstration, a library program), a line of today's scene language inside the moment pins it, and the composer keeps
// it as written.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Kit } from "../../engine/core/types.ts";
import { checkIntent, parseIntent } from "../../engine/design/intent/parse.ts";
import type { IntentPlan, PartCard, Requirement, Word } from "../../engine/design/types.ts";
import { numbered } from "../../engine/language/author.ts";
import type { LibraryEntry } from "../../engine/language/library.ts";

export const INTENT_GUIDE = join(import.meta.dirname, "..", "..", "prompts", "intent.md");

/** The author's system prompt: the intent guide, then what may be pinned, each as a line to copy. */
export function intentSystem(o: { kits: Kit[]; programs: LibraryEntry[]; truth?: string[] }): string {
  const computed = o.kits.filter((k) => k.behaviors?.steps).flatMap((k) => Object.keys(k.kinds ?? {}).map((name) => `- ${k.docs?.[name] ?? name}`));
  const programs = o.programs.map((x) => `- \`run ${x.name} ID${Object.keys(x.params).map((k) => ` ${k}=`).join("")}\`: ${x.doc}`);
  const parts = [readFileSync(INTENT_GUIDE, "utf8").trim()];
  const pins: string[] = [];
  if (o.truth?.length) pins.push(`The computed demonstration in your part, to pin exactly as written, with its \`do steps\` lines on the moments whose words they play under:\n${o.truth.join("\n")}`);
  if (computed.length) pins.push(`Things the engine computes for real, so a process shown with one is right at every step (pin one where the words work through that process, then \`do steps ID from=N to=M\` on the moments that play its steps):\n${computed.join("\n")}`);
  if (programs.length) pins.push(`Library programs, already written and tested, for what neither a thing nor an object covers:\n${programs.join("\n")}`);
  if (pins.length) parts.push(`# Pinned lines\n\nInside a moment, a line of the scene language pins exactly what it says, indented lines under it included, and the engine keeps it as written. Pin only these, and only where they show what the words say better than a thing or an object would; everything else stays in the plan's own words.\n\n${pins.join("\n\n")}`);
  return `${parts.join("\n\n")}\n`;
}

/** The user's material for the request: every card by name with its named parts, and what the files require. */
export function materialText(cards: PartCard[], requirements: Requirement[] = []): string {
  const listed = cards.map((m) => {
    const parts = Object.entries(m.parts);
    return `- ${m.name}, ${m.kind} (${m.about})${parts.length ? `. Its parts: ${parts.map(([q, r]) => `${m.name}.${q} (${r.about})`).join("; ")}` : ""}`;
  });
  const reqs = requirements.map((r) => `- ${r.id}: ${r.kind}${r.applies ? ` (about ${r.applies})` : ""}: ${r.detail} (stated in ${r.source.file}${r.source.where ? `, ${r.source.where}` : ""}; ${r.why})`);
  return [
    listed.length ? `The user's own material, to use by name:\n${listed.join("\n")}` : "",
    reqs.length ? `What the user's files require of this video (each stated in one of their files):\n${reqs.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export type IntentChecked = { plan: IntentPlan; problems: string[]; notes: string[]; language: boolean };

/** Whether an answer is written wholly in today's scene language: moments that only pin lines, and no things. */
export function wholeLanguage(plan: IntentPlan): boolean {
  return !plan.things.length && plan.moments.length > 0 && plan.moments.every((m) => !m.show && !m.reveal && !m.ask && !m.keep.length && !m.acts.length && !m.compare && m.pinned.length > 0);
}

/** The plan's problems an author can repair: the parser's checks, and moments outside the author's words. */
export function checkPlan(src: string, words: Word[], cards: PartCard[], range: { firstWord: number; lastWord: number }): IntentChecked {
  const plan = parseIntent(src);
  if (wholeLanguage(plan)) return { plan, problems: [], notes: [], language: true };
  const problems = checkIntent(plan, words, cards).map((x) => `line ${x.line}: ${x.message}`);
  const first = plan.moments[0];
  if (first && first.word !== range.firstWord) problems.push(`line ${first.line}: your first moment is @${first.word}, but your part starts at word ${range.firstWord}: start it there, so the screen is never empty.`);
  for (const m of plan.moments) if (m.word < range.firstWord || m.word > range.lastWord) problems.push(`line ${m.line}: @${m.word} is outside your words (${range.firstWord} to ${range.lastWord}).`);
  return { plan, problems, notes: plan.notes, language: false };
}

export const intentRepair = (request: string, src: string, problems: string[], max = 25) =>
  `${request}\n\nYour plan, with line numbers added for reference. Do not include the numbers:\n${numbered(src)}\n\nIt cannot be used yet:\n${problems.slice(0, max).map((x) => `- ${x}`).join("\n")}\n\nWrite the whole plan again with each of these fixed, and nothing else.`;

/** The author's answer without a code fence around it. */
export const stripFence = (s: string) => s.replace(/^\s*```[\w-]*\s*\n/, "").replace(/\n```\s*$/, "").trim() + "\n";
