// The depicter's tasks for a moment directory, through files: one task per object of the intent plan, written to
// <momentDir>/agents/ask/depict.<id>.md for an agent to answer in <momentDir>/agents/answer/depict.<id>.json. Answers
// that are there are checked (a repair task is written when a spec has problems) and gathered into
// <momentDir>/props.json, which compose.ts reads.
// Usage: node --experimental-strip-types scripts/design-brain/depict-tasks.ts <momentDir> [rounds=2]
//   MATERIAL=<file>  lines of the user's material to pass whole to the depicter (the request's own text otherwise)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { depictRequests } from "../../engine/design/compose/acts.ts";
import { depict, type PropSpec } from "../../engine/design/depict/index.ts";
import { parseIntent } from "../../engine/design/intent/parse.ts";
import { fileReasoner } from "../../engine/design/reasoner.ts";

const [dir, roundsArg = "2"] = process.argv.slice(2);
if (!dir) throw new Error("usage: depict-tasks.ts <momentDir> [rounds]");
const plan = parseIntent(readFileSync(join(dir, process.env.INTENT ?? "intent.txt"), "utf8"));
const request = existsSync(join(dir, "request.json")) ? (JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as { prompt?: string; words?: { text: string }[] }) : {};
const material = process.env.MATERIAL ? readFileSync(process.env.MATERIAL, "utf8").split("\n").filter(Boolean) : [request.prompt ?? request.words?.map((w) => w.text).join(" ") ?? ""].filter(Boolean);
const reasoner = fileReasoner(join(dir, "agents"));
const props: Record<string, PropSpec> = existsSync(join(dir, "props.json")) ? JSON.parse(readFileSync(join(dir, "props.json"), "utf8")) : {};
let pending = 0;
for (const req of depictRequests(plan, { material, purpose: plan.audience ? `for ${plan.audience}` : undefined })) {
  const a = await depict(reasoner, req, Number(roundsArg));
  if (a.status === "pending") {
    pending++;
    console.log(`${req.name}: waiting for ${reasoner.answerFile(req.id)} (task ${a.file})`);
    continue;
  }
  props[req.name] = a.spec;
  console.log(`${req.name}: ${a.spec.kind}${a.spec.form ? ` (${a.spec.form})` : ""} in ${a.rounds} round(s)${a.problems.length ? `; problems left: ${a.problems.map((p) => `${p.path}: ${p.problem}`).join("; ")}` : ""}`);
}
writeFileSync(join(dir, "props.json"), JSON.stringify(props, null, 1));
console.log(`${Object.keys(props).length} specs in ${join(dir, "props.json")}${pending ? `, ${pending} task(s) waiting for an answer` : ""}`);
