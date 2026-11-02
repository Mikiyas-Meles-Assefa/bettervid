// Turns the director's shots (pictures, timing, zoom targets, marks) into scene language, so documentaries run on the
// engine too. The scene stage hands each section's part to Spark as a starting point it can add to.
import type { Project } from "../../schemas/project.ts";

// `source` uses global spoken-word numbers; `assets` maps asset names used in the source to files in the project folder.
export function shotsToScene(p: Project): { source: string; assets: Record<string, string> } {
  throw new Error(`shotsToScene is not built yet (project ${p.id})`);
}
