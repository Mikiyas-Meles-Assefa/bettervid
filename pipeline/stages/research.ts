// Stage 1: research. Spark 1.3 with web search builds the fact sheet (claims, each tied to sources).
import type { FactSheet, Project } from "../../schemas/project.ts";
import { factSheetSchema } from "../../schemas/project.ts";
import { json } from "../lib/meta.ts";
import { charge, prompt, stage } from "../lib/project.ts";

export async function research(p: Project, force = false) {
  await stage(p, "research", [p.input.prompt, prompt("research")], 0.5, async () => {
    const r = await json<FactSheet>({
      system: prompt("research"),
      user: `Topic for the video: ${p.input.prompt}`,
      schema: factSheetSchema,
      schemaName: "fact_sheet",
      webSearch: true,
      effort: "medium",
    });
    const f = r.value;
    // Drop claims whose sources the model didn't list, so every claim on screen is traceable.
    const ids = new Set(f.sources.map((s) => s.id));
    f.claims = f.claims.filter((c) => c.sourceIds.some((id) => ids.has(id)));
    p.factSheet = f;
    charge(p, "research", r.usd, `${r.searches} searches, ${r.raw.usage?.input_tokens} in, ${r.raw.usage?.output_tokens} out`);
  }, force);
}
