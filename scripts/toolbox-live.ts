// A live check of path A's depiction hook-up: Muse Spark as the depicter prepares a staged scene's things, the scene is
// built and two stills are rendered. Usage: node --env-file=.env --experimental-strip-types scripts/toolbox-live.ts <out folder> [style]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, formatProblems } from "../engine/language/build.ts";
import { themeFrom } from "../engine/render/theme.ts";
import { emptyToolbox, prepareToolbox, toolboxKit, toolboxNotes } from "../engine/language/toolbox.ts";
import { metaReasoner } from "../pipeline/lib/reasoner-meta.ts";
import { closeRenderer, renderStills } from "../pipeline/stages/scene.ts";
const [out, styleName = "neon"] = process.argv.slice(2);
const theme = themeFrom(styleName);
const src = `@0
stage lab w=900 h=1300
  depict burette "a 50 mL glass burette of sodium hydroxide, nearly full, with a stopcock"
  depict flask "a 250 mL conical flask with clear acid and a few drops of phenolphthalein"
  depict bench "a white lab bench top"
  burette above flask "4 cm"
  flask sits on bench
@10 keep
do act burette verb="drips into" to=flask amount=8 frames=120
@20 keep
do change flask color=pink frames=40
`;
let usd = 0;
const depicter = metaReasoner({ charge: (x) => (usd += x) });
const kinds = ["depict"];
const box = emptyToolbox();
const r = await prepareToolbox(src, kinds, box, { depicter, style: { name: styleName, art: "neon tube lines" } });
console.log("prepared", r.made, r.problems, `$${usd.toFixed(4)}`);
writeFileSync(join(out!, "toolbox.json"), JSON.stringify(box, null, 1));
const words = Array.from({ length: 30 }, (_, i) => ({ text: "w", start: i * 0.5 }));
const b = await build(src, { ctx: { fps: 30, width: 1080, height: 1920, frames: 600, words, theme, kits: [toolboxKit(box)] } });
console.log(formatProblems(b.problems) || "builds", b.notes ?? "");
for (const n of toolboxNotes(src, kinds, box, theme)) console.log("-", n.slice(0, 400));
if (b.scene) console.log(await renderStills(b.scene, theme, [5, 400, 599], out!, 0.5));
await closeRenderer();
