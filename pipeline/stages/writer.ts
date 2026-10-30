// Stage 2: writer. Writing and formatting are separate, because a model filling a JSON form writes in boxes:
// 1. draft: plain prose narration, as long as the story needs;
// 2. cut (only when the user asked for a length): commit to one thread and retell it at that length;
// 3. review: read it as a first-time viewer and fix what breaks understanding;
// 4. structure: split the final prose into beats and tag claims and visuals, without changing a word.
import type { Project, Script, WritingStep } from "../../schemas/project.ts";
import { scriptSchema } from "../../schemas/project.ts";
import { json, text } from "../lib/meta.ts";
import { asked, charge, persona, prompt, save, seconds, stage, topic } from "../lib/project.ts";
import { hash } from "../lib/util.ts";

// Measured in spike S6: eleven_v4 reads about 2.4 words per second.
const WORDS_PER_SEC = 2.4;

const FREE = "as long as the story needs to be told well, and no longer. Topics like this usually land between 1 and 4 minutes.";
const target = (seconds: number) => `about ${seconds} seconds, roughly ${Math.round(seconds * WORDS_PER_SEC)} spoken words.`;

// Replies are "KEY: value" header lines, a blank line, then the narration.
function parse(reply: string, step: WritingStep["step"]): WritingStep {
  const [head = "", ...body] = reply.replace(/\r/g, "").split(/\n\s*\n/);
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "mi").exec(head)?.[1]?.trim() ?? "";
  const issues = /ISSUES:\s*\n?([\s\S]*?)(?=\nTITLE:)/i.exec(head)?.[1] ?? "";
  const notes = [
    ...(field("THREAD") ? [`thread: ${field("THREAD")}`] : []),
    ...(field("LEFT OUT") ? field("LEFT OUT").split(";").map((s) => `left out: ${s.trim()}`) : []),
    ...issues.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter((l) => l && l.toLowerCase() !== "none"),
  ];
  const narration = body.join("\n\n").trim().replace(/\s*[—–]\s*/g, ", ");
  if (!narration) throw new Error(`writer ${step}: reply had no narration:\n${reply.slice(0, 300)}`);
  return { step, title: field("TITLE"), takeaway: field("TAKEAWAY"), narration, notes };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export async function writer(p: Project, force = false) {
  const who = persona(p.input.persona);
  const narrator = `${who.label}. ${who.brief}${who.expertise ? ` Expertise: ${who.expertise}` : ""}`;
  const secs = seconds(p);
  const length = secs ? target(secs) : FREE;
  const fill = (name: string, len: string) => prompt(name).replace("{{persona}}", narrator).replace("{{mode}}", p.input.mode).replace("{{length}}", len);
  const f = p.factSheet!;
  const claims = `Claims, with ids:\n${JSON.stringify(f.claims, null, 1)}`;
  // The research angle is not passed on: the writer decides what the story is about from the whole story.
  const wishes = asked([...(p.plan?.story ?? []), p.plan?.tone ? `Tone: ${p.plan.tone}` : ""]);
  const research = `Topic: ${topic(p)}\n\n${wishes ? `${wishes}\n\n` : ""}Common misconception: ${f.misconception || "none"}\n\nResearch:\n${f.story}\n\n${claims}`;
  const prompts = [fill("writer", FREE), fill("cut", length), fill("review", length), prompt("structure")];
  await stage(p, "writer", [prompts, research, secs, p.plan?.visuals], 0.25, async () => {
    // Each finished step is saved with the key of its inputs, so a run that fails (say, on a network drop) resumes
    // from the last finished step instead of paying for the earlier ones again.
    const key = hash(prompts, research, secs);
    const saved = force ? [] : (p.writing ?? []).filter((s) => s.key === key);
    const steps: WritingStep[] = [];
    const step = async (name: WritingStep["step"], call: () => Promise<{ value: string; usd: number }>) => {
      const old = saved.find((s) => s.step === name);
      if (old) {
        steps.push(old);
        console.log(`  ${name}: saved from the last run`);
        return;
      }
      const r = await call();
      const s = { ...parse(r.value, name), key };
      steps.push(s);
      charge(p, "writer", r.usd, `${s.step}: ${words(s.narration)} words${s.notes.length ? `, ${s.notes.length} notes` : ""}`);
      console.log(`  ${s.step}: ${words(s.narration)} words`);
      for (const n of s.notes) console.log(`    ${n}`);
      p.writing = [...steps];
      await save(p);
    };
    const show = (s: WritingStep) => `TITLE: ${s.title}\nTAKEAWAY: ${s.takeaway}\n\n${s.narration}`;

    await step("draft", () => text({ system: prompts[0]!, user: research, effort: "high" }));
    if (secs) await step("cut", () => text({ system: prompts[1]!, user: `${research}\n\nThe full narration:\n\n${show(steps.at(-1)!)}`, effort: "high" }));
    // After a cut, the review must keep the editor's choice: fix coherence inside the thread, never add back what was cut.
    const cut = steps.find((s) => s.step === "cut");
    const kept = cut
      ? `\nThis is a shortened video. The editor chose one thread and deliberately cut the rest:\n${cut.notes.join("\n")}\n` +
        "Fix coherence within that thread only. Do not add back anything that was cut; if the thread feels incomplete, make it clearer, not bigger.\n"
      : "";
    await step("review", () => text({ system: prompts[2]!.replace("{{thread}}", kept), user: `${research}\n\nThe narration:\n\n${show(steps.at(-1)!)}`, effort: "high" }));

    // Structure, then check it kept every word; one retry if it didn't.
    const final = steps.at(-1)!;
    let script: Script | undefined;
    for (let attempt = 1; attempt <= 2 && !script; attempt++) {
      const r = await json<Script>({
        system: prompts[3]!,
        user: `${asked(p.plan?.visuals ?? [])}\n\n${claims}\n\nTITLE: ${final.title}\nTAKEAWAY: ${final.takeaway}\n\nNarration:\n\n${final.narration}`,
        schema: scriptSchema,
        schemaName: "script",
        effort: "low",
      });
      charge(p, "writer", r.usd, `structure: ${r.value.beats.length} beats`);
      const same = norm(r.value.beats.map((b) => b.text).join(" ")) === norm(final.narration);
      if (same || attempt === 2) script = r.value;
      if (!same) console.log(`  structure changed the wording${attempt === 2 ? "; keeping it anyway" : ", retrying"}`);
    }
    const known = new Set(f.claims.map((c) => c.id));
    for (const b of script!.beats) b.claimIds = b.claimIds.filter((id) => known.has(id));
    p.script = script;
  }, force);
}
