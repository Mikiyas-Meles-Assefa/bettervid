// Stage 0: plan. Spark reads the user's message once and sorts what they explicitly asked for by which part of the
// work it concerns. Later stages get only their part, marked as deliberate, so a review never "fixes" a user's choice.
import type { Plan, Project } from "../../schemas/project.ts";
import { planSchema } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { charge, prompt, stage } from "../lib/project.ts";

export async function plan(p: Project, force = false) {
  await stage(p, "plan", [p.input.prompt, prompt("plan")], 0.02, async () => {
    const r = await json<Plan>({ system: prompt("plan"), user: p.input.prompt, schema: planSchema, schemaName: "plan", effort: "medium" });
    const v = r.value;
    v.seconds = Math.max(0, Math.round(v.seconds));
    p.plan = v;
    const said = [v.seconds && `${v.seconds} s`, v.story.length && `${v.story.length} story`, v.tone && "tone", v.visuals.length && `${v.visuals.length} visual`, v.sound.length && `${v.sound.length} sound`, v.material && "material"].filter(Boolean);
    charge(p, "plan", r.usd, `${v.topic}; asked: ${said.join(", ") || "nothing beyond the topic"}`);
    console.log(`  topic: ${v.topic}`);
    for (const [k, list] of Object.entries({ story: [...v.story, ...(v.tone ? [`tone: ${v.tone}`] : [])], visuals: v.visuals, sound: v.sound }))
      for (const s of list) console.log(`  ${k}: ${s}`);
  }, force);
}
