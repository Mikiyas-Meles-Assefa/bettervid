// Stage 2: writer. Spark 1.3 turns the fact sheet into narration beats, following the craft rulebook.
import type { Project, Script } from "../../schemas/project.ts";
import { scriptSchema } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { charge, prompt, stage } from "../lib/project.ts";

// Measured in spike S6: eleven_v4 reads about 2.4 words per second.
const WORDS_PER_SEC = 2.4;

export async function writer(p: Project, force = false) {
  const system = prompt("writer")
    .replace("{{craft}}", prompt("craft-rules"))
    .replace("{{words}}", String(Math.round(p.input.seconds * WORDS_PER_SEC)))
    .replace("{{seconds}}", String(p.input.seconds))
    .replace("{{mode}}", p.input.mode);
  await stage(p, "writer", [system, p.factSheet], 0.15, async () => {
    const r = await json<Script>({
      system,
      user: `Topic: ${p.input.prompt}\n\nFact sheet:\n${JSON.stringify(p.factSheet, null, 1)}`,
      schema: scriptSchema,
      schemaName: "script",
      effort: "medium",
    });
    const known = new Set(p.factSheet!.claims.map((c) => c.id));
    for (const b of r.value.beats) b.claimIds = b.claimIds.filter((id) => known.has(id));
    p.script = r.value;
    charge(p, "writer", r.usd, `${r.raw.usage?.input_tokens} in, ${r.raw.usage?.output_tokens} out`);
  }, force);
}
