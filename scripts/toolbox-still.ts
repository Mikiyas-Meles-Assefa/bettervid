// Renders one staged scene of depicted things from the toolbox test fixtures, to look at staging by eye. No model calls.
import { build, formatProblems } from "../engine/language/build.ts";
import { themeFrom } from "../engine/render/theme.ts";
import { SAMPLES } from "../engine/design/depict/samples.ts";
import { emptyToolbox, entryKey, toolboxKit } from "../engine/language/toolbox.ts";
import { closeRenderer, renderStills } from "../pipeline/stages/scene.ts";
const theme = themeFrom(process.argv[3] ?? "neon");
const box = emptyToolbox();
const put = (id: string, desc: string, spec: any) => (box.depictions[entryKey(id, desc)] = { id, desc, verbs: [], relations: [], spec, problems: [] });
put("burette", "a 50 mL burette of NaOH", SAMPLES.find((s) => s.name === "burette")!.spec);
put("flask", "a conical flask of clear acid", SAMPLES.find((s) => s.name === "flask")!.spec);
put("bench", "a lab bench", { kind: "body", form: "block", label: "lab bench", size: { w: 120, h: 8, unit: "cm" }, params: { depth: 0.1, corner: 0.01 }, colors: { body: "#8a6a4a" }, colorSources: { body: "known" }, why: "" });
const src = `@0
text t "Titration" role=title
stage lab w=900 h=1300
  depict burette "a 50 mL burette of NaOH"
  depict flask "a conical flask of clear acid"
  depict bench "a lab bench"
  burette above flask "3 cm"
  flask sits on bench
@10 keep
do act burette verb="opens"
do change flask color=rose frames=30
`;
const words = Array.from({ length: 30 }, (_, i) => ({ text: "w", start: i * 0.5 }));
const r = await build(src, { ctx: { fps: 30, width: 1080, height: 1920, frames: 400, words, theme, kits: [toolboxKit(box)] } });
if (!r.scene) throw new Error(formatProblems(r.problems));
console.log(r.notes);
console.log(await renderStills(r.scene, theme, [5, 300], process.argv[2]!, 0.5));
await closeRenderer();
