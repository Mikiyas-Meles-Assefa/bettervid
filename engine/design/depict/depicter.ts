// The depicter: an agent that reads a thing's description, the plan's verbs for it and the user's material, and decides
// what kind of thing it is, its parameters, parts and colors (a PropSpec). It replaces the prototype's word lexicon:
// colors of real things are facts from the material, not a color-word table. Every call goes through a Reasoner.
import type { AgentTask, Answer, Reasoner } from "../types.ts";
import { checkSpec, type SpecProblem } from "./depict.ts";
import { KINDS } from "./kinds/index.ts";
import { POSE_VERBS } from "./make.ts";
import { PROP_SPEC_SCHEMA, type PropSpec } from "./spec.ts";

export type DepictRequest = {
  /** Unique per run, such as "depict.flask". */
  id: string;
  name: string;
  /** What it is, in the author's plain words. */
  desc: string;
  /** What the plan has it do: the author's verbs and their arguments. */
  acts: { verb: string; arg?: string; to?: string }[];
  /** Excerpts of the user's material that mention it (quotes, with the file they come from). */
  material?: string[];
  /** Pictures from the material that show it. */
  images?: string[];
  /** Other things on screen with it, by name and kind, so sizes and colors agree. */
  company?: string[];
  /** What the video is for and who watches, in a line. */
  purpose?: string;
};

function kindGuide(): string {
  return Object.values(KINDS)
    .map((k) => {
      const forms = k.forms ? `\n  forms: ${Object.entries(k.forms).map(([f, a]) => `${f} (${a})`).join("; ")}` : "";
      const params = Object.entries(k.params).map(([p, a]) => `\n  - ${p}: ${a}`).join("");
      const colors = Object.entries(k.colors).map(([n, a]) => `${n} (${a})`).join("; ");
      return `* ${k.name}: ${k.about}${forms}\n  params:${params}\n  colors: ${colors}`;
    })
    .join("\n");
}

export const DEPICTER_SYSTEM = `You decide how a video engine draws one thing so that a viewer would know it with its label covered.
The engine draws kinds of things from flat vector parts in the video's style. You pick the kind and give its parameters,
its colors and how the plan's verbs change it. Answer with one JSON object (a PropSpec) and nothing else.

Rules
- Kind of thing, never topic. Pick the kind whose parts let this thing be itself and do what the plan asks. When nothing
  fits, use "outline" and trace the object's silhouette with named regions and a few detail lines.
- Colors of real things are facts. Take them from the material when it says them (quote it in colorSources), else from
  plain knowledge of the real thing (write "known: ..." with the fact). Never choose a color for effect. Give every color
  the plan's verbs will need (a color something turns, flashes or becomes), under the plan's own words as names, such as
  "faint green" when the plan says it turns faint green. Use #rrggbb, or #rrggbbaa for see-through contents.
- Sizes are real sizes (size.w, size.h with a unit), so things on screen together keep their true proportion.
- Structure is drawn in the style's own ink; you only name the colors of the thing itself.
- Map each of the plan's verbs onto the kind's verbs ("verbs": {"<plan verb>": {"like": "<kind verb>"}}) or onto state
  changes ({"sets": [{"state": "...", "value": ...}]}) when the kind has no verb by that name. Every verb the plan uses
  must work. Every kind also has: ${Object.keys(POSE_VERBS).join(", ")}.
- Give the starting state the plan implies (how full, what reading, what time) in "state".
- tier: 1 is drawn by the engine (the default and almost always right). Ask for 2 (a generated picture in the style, cut
  into parts) only when the thing carries the moment and no kind can make it itself, and say why; give sprite.parts
  with a short phrase for each part to cut and how it changes. 3 and 4 are the user's own or a found picture: name its
  part card in picture.card when the material has a picture of the very thing.
- why: one or two sentences on how you read the description and the material.

Kinds
${kindGuide()}

Examples (of the form, not of any topic)
- A watering can that empties onto soil: {"kind":"container","label":"watering can","size":{"w":30,"h":25,"unit":"cm"},
  "params":{"profile":[[0.42,0],[0.46,0.7],[0.3,1]],"wall":"solid","cutaway":true,"spout":"right","contents":[{"name":"water","level":0.8,"color":"water"}]},
  "colors":{"wall":"#3e7c5a","water":"#a9d4ecbb"},"colorSources":{"wall":"the brief: 'our green can'","water":"known: water is clear"},
  "verbs":{"empties onto":{"like":"pours into"}},"why":"..."}
- A metronome that ticks: {"kind":"mechanism","form":"lever",...} or an "outline" with a hinged arm region, whichever lets the arm swing.`;

/** The depicter's task for a thing; on a repair round it carries the previous answer and its problems. */
export function depicterTask(req: DepictRequest, repair?: { previous: PropSpec; problems: SpecProblem[]; round: number }): AgentTask {
  const lines = [
    `Thing: ${req.name}`,
    `Description: ${req.desc}`,
    `What the plan has it do: ${req.acts.length ? req.acts.map((a) => `${a.verb}${a.arg ? ` "${a.arg}"` : ""}${a.to ? ` (to ${a.to})` : ""}`).join("; ") : "nothing; it is shown"}`,
  ];
  if (req.company?.length) lines.push(`On screen with it: ${req.company.join("; ")}`);
  if (req.purpose) lines.push(`The video: ${req.purpose}`);
  lines.push(req.material?.length ? `From the user's material:\n${req.material.map((m) => `> ${m}`).join("\n")}` : "The material says nothing about it.");
  if (repair) {
    lines.push(`\nYour previous answer:\n${JSON.stringify(repair.previous)}`);
    lines.push(`It has these problems; answer again with all of them fixed:\n${repair.problems.map((p) => `- ${p.path}: ${p.problem}`).join("\n")}`);
  }
  return { role: "depicter", id: repair ? `${req.id}.r${repair.round}` : req.id, system: DEPICTER_SYSTEM, request: lines.join("\n"), schema: PROP_SPEC_SCHEMA, images: req.images };
}

export type DepictAnswer = { status: "answered"; spec: PropSpec; problems: SpecProblem[]; rounds: number } | { status: "pending"; file: string };

/**
 * Asks the depicter, checks the answer, and asks again with the problems until it is clean or the rounds run out
 * (`rounds` is the caller's budget). Problems that remain are returned with the spec, never hidden.
 */
export async function depict(reasoner: Reasoner, req: DepictRequest, rounds: number): Promise<DepictAnswer> {
  let task = depicterTask(req);
  const verbs = req.acts.map((a) => a.verb);
  for (let round = 1; ; round++) {
    const a: Answer<PropSpec> = await reasoner.ask<PropSpec>(task);
    if (a.status === "pending") return a;
    const problems = checkSpec(a.value, { verbs });
    if (!problems.length || round >= rounds) return { status: "answered", spec: a.value, problems, rounds: round };
    task = depicterTask(req, { previous: a.value, problems, round: round + 1 });
  }
}
