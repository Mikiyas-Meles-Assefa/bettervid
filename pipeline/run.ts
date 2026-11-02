// CLI: create or resume a project and run stages in order. Cached stages are skipped.
// New:    npm run pipeline -- new "<prompt>" [--style collage] [--persona auto] [--mode history] [--seconds 0, 0 = as long as the story needs; a length in the prompt wins] [--until voice]
// Resume: npm run pipeline -- <projectId> [--until <stage>] [--force <stage>] [--only <stage>]
// Visuals: the engine scene is the one visual step. `--visuals legacy` restores the old routing (teaching stage, board
// or shots), for side-by-side tests.
import type { Project, StageName } from "../schemas/project.ts";
import { load, save, spent, style } from "./lib/project.ts";
import { hash } from "./lib/util.ts";
import { annotate } from "./stages/annotate.ts";
import { assets } from "./stages/assets.ts";
import { board } from "./stages/board.ts";
import { critic } from "./stages/critic.ts";
import { director } from "./stages/director.ts";
import { mix } from "./stages/mix.ts";
import { plan } from "./stages/plan.ts";
import { render } from "./stages/render.ts";
import { research } from "./stages/research.ts";
import { scene } from "./stages/scene.ts";
import { stage } from "./stages/stage.ts";
import { timeline } from "./stages/timeline.ts";
import { voice } from "./stages/voice.ts";
import { writer } from "./stages/writer.ts";

type Run = [StageName, (p: Project, force: boolean) => Promise<void>][];
const LEGACY: Run = [
  ["plan", plan],
  ["research", research],
  ["writer", writer],
  ["voice", voice],
  ["director", director],
  ["board", board],
  ["stage", stage],
  ["assets", assets],
  ["annotate", annotate],
  ["timeline", timeline],
  ["mix", mix],
  ["render", render],
  ["critic", critic],
];
// Director, assets and annotate still make pictures when the video needs them; the scene stage then builds on them.
const ENGINE: Run = [
  ["plan", plan],
  ["research", research],
  ["writer", writer],
  ["voice", voice],
  ["director", director],
  ["assets", assets],
  ["annotate", annotate],
  ["scene", scene],
  ["board", board],
  ["stage", stage],
  ["timeline", timeline],
  ["mix", mix],
  ["render", render],
  ["critic", critic],
];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

let p: Project;
if (args[0] === "new") {
  const promptText = args[1];
  if (!promptText) throw new Error('usage: new "<prompt>"');
  const slug = promptText.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-$/, "");
  p = {
    id: `${slug}-${hash(promptText, Date.now()).slice(0, 6)}`,
    createdAt: new Date().toISOString(),
    input: { prompt: promptText, style: flag("style") ?? "collage", persona: flag("persona") ?? "auto", mode: (flag("mode") as Project["input"]["mode"]) ?? "explain", seconds: Number(flag("seconds") ?? 0) },
    stages: {},
    costs: [],
  };
  await save(p);
  console.log(`project ${p.id}`);
} else {
  p = load(args[0]!);
}

const only = flag("only") as StageName | undefined;
const visuals = flag("visuals") ?? "engine";
if (!["engine", "legacy"].includes(visuals)) throw new Error(`--visuals takes engine or legacy, not ${visuals}`);
const ORDER = visuals === "legacy" ? LEGACY : ENGINE;
// The timeline plays an engine scene whenever one exists, so legacy drops it. The scene stage keeps its sections in the
// project folder, so switching back to the engine resumes without paying again.
if (visuals === "legacy") delete p.scene;
// Legacy: a topic that needs worked notation uses the teaching stage, in any style. Otherwise a board style plans one
// live whiteboard, and other styles plan shots and images. Decided as stages run, because the plan comes first.
const boardStyle = style(p.input.style).motion === "board";
function skipLegacy(name: StageName) {
  const visuals: Record<string, string[]> = { stage: ["stage"], board: ["board"], shots: ["director", "assets", "annotate"] };
  const mine = p.plan?.notation ? "stage" : boardStyle ? "board" : "shots";
  return Object.entries(visuals).some(([k, list]) => k !== mine && list.includes(name));
}
// Engine: the scene stage draws every video. Pictures are made unless the topic is worked notation, which the engine
// draws itself. The old teaching stage and board only run when asked for with --only.
function skipEngine(name: StageName) {
  if (name === "board" || name === "stage") return true;
  return ["director", "assets", "annotate"].includes(name) && !!p.plan?.notation;
}
function skip(name: StageName) {
  if (only === name) return false;
  return visuals === "legacy" ? skipLegacy(name) : skipEngine(name);
}
const until = flag("until") as StageName | undefined;
const force = flag("force") as StageName | undefined;
for (const [name, run] of ORDER) {
  if ((only && only !== name) || skip(name)) continue;
  await run(p, force === name);
  if (until === name) break;
}
await save(p);
const total = p.costs.reduce((s, c) => s + c.usd, 0);
console.log(`project ${p.id}: $${total.toFixed(3)} this project, $${spent().toFixed(2)} all dev runs`);
