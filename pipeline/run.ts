// CLI: create or resume a project and run stages in order. Cached stages are skipped.
// New:    npm run pipeline -- new "<prompt>" [--style collage] [--persona auto] [--mode history] [--seconds 0, 0 = as long as the story needs; a length in the prompt wins] [--until voice]
// Resume: npm run pipeline -- <projectId> [--until <stage>] [--force <stage>] [--only <stage>]
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
import { timeline } from "./stages/timeline.ts";
import { voice } from "./stages/voice.ts";
import { writer } from "./stages/writer.ts";

const ORDER: [StageName, (p: Project, force: boolean) => Promise<void>][] = [
  ["plan", plan],
  ["research", research],
  ["writer", writer],
  ["voice", voice],
  ["director", director],
  ["board", board],
  ["assets", assets],
  ["annotate", annotate],
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

// A board style plans one live whiteboard instead of shots and images.
const boardStyle = style(p.input.style).motion === "board";
const skip = (name: StageName) => (boardStyle ? ["director", "assets", "annotate"].includes(name) : name === "board");
const until = flag("until") as StageName | undefined;
const force = flag("force") as StageName | undefined;
const only = flag("only") as StageName | undefined;
for (const [name, run] of ORDER) {
  if ((only && only !== name) || skip(name)) continue;
  await run(p, force === name);
  if (until === name) break;
}
await save(p);
const total = p.costs.reduce((s, c) => s + c.usd, 0);
console.log(`project ${p.id}: $${total.toFixed(3)} this project, $${spent().toFixed(2)} all dev runs`);
