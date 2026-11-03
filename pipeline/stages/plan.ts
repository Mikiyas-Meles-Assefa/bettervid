// Stage 0: plan. Spark reads the user's message once and sorts what they explicitly asked for by which part of the
// work it concerns. Later stages get only their part, marked as deliberate, so a review never "fixes" a user's choice.
// It also records two judgments: `intent` (why this person wants the video) and `notation`.
import type { Plan, Project } from "../../schemas/project.ts";
import { planSchema } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { materialNote } from "../lib/material.ts";
import { charge, prompt, stage } from "../lib/project.ts";

export async function plan(p: Project, force = false) {
  const note = materialNote(p);
  const user = note ? `${p.input.prompt}\n\n${note}` : p.input.prompt;
  await stage(p, "plan", [user, prompt("plan")], 0.02, async () => {
    const r = await json<Plan>({ system: prompt("plan"), user, schema: planSchema, schemaName: "plan", effort: "medium" });
    const v = r.value;
    v.seconds = Math.max(0, Math.round(v.seconds));
    v.intent = (v.intent ?? "").trim();
    p.plan = v;
    const said = [v.seconds && `${v.seconds} s`, v.story.length && `${v.story.length} story`, v.tone && "tone", v.visuals.length && `${v.visuals.length} visual`, v.sound.length && `${v.sound.length} sound`, v.material && "material"].filter(Boolean);
    charge(p, "plan", r.usd, `${v.topic}; asked: ${said.join(", ") || "nothing beyond the topic"}`);
    console.log(`  topic: ${v.topic}`);
    console.log(`  intent: ${v.intent || "(no signal)"}`);
    console.log(`  notation: ${v.notation}`);
    for (const [k, list] of Object.entries({ story: [...v.story, ...(v.tone ? [`tone: ${v.tone}`] : [])], visuals: v.visuals, sound: v.sound }))
      for (const s of list) console.log(`  ${k}: ${s}`);
  }, force);
}

// The person behind the request, for the stages that decide what goes into the video: their own words, and the plan's
// reading of why they want it. Passed as understanding, not rules: each stage decides what it means for its own work.
export function viewer(p: Project): string {
  const words = `The request, in the user's own words:\n"""\n${p.input.prompt.trim()}\n"""`;
  const why = p.plan?.intent
    ? `Why they seem to want this video (a reading of the request, not their words; anything they asked for explicitly wins): ${p.plan.intent}`
    : "The request gives no clear sign of why they want this video: judge from it what would serve them best.";
  return `${words}\n\n${why}`;
}
