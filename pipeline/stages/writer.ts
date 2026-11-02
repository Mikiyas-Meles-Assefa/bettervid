// Stage 2: writer. Writing and formatting are separate, because a model filling a JSON form writes in boxes:
// 1. draft: plain prose narration, as long as the story needs;
// 2. cut (only when the user asked for a length): commit to one thread and retell it at that length;
// 3. review: read it as a first-time viewer and fix what breaks understanding;
// 4. check and revise: a director reads whether the video shows its ideas working on examples the picture can make
//    visible, and sends concrete notes back to a revise step until it does (the engine's abilities ride along, so the
//    examples fit what can be drawn or computed);
// 5. structure: split the final prose into beats and tag claims and visuals, without changing a word.
import type { Project, Script, WritingStep } from "../../schemas/project.ts";
import { scriptSchema } from "../../schemas/project.ts";
import { abilities } from "../lib/abilities.ts";
import { json, text } from "../lib/meta.ts";
import { asked, charge, persona, prompt, save, seconds, stage, topic } from "../lib/project.ts";
import { hash } from "../lib/util.ts";
import { viewer } from "./plan.ts";

// Measured in spike S6: eleven_v4 reads about 2.4 words per second.
export const WORDS_PER_SEC = 2.4;

const FREE = "as long as this video needs to give the viewer what they came for, and no longer. Videos like this usually land between 1 and 4 minutes.";
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

// A check replies "VERDICT: shows|revise" and its notes. It changes no words, so it carries the narration it read.
function parseCheck(reply: string, read: WritingStep): WritingStep {
  for (const part of ["IDEAL", "WALK"]) {
    const said = new RegExp(`${part}:\\s*([\\s\\S]*?)\\n\\s*(?:WALK|VERDICT):`, "i").exec(reply)?.[1]?.trim();
    if (said) console.log(`    ${part.toLowerCase()}: ${said.replace(/\n+/g, "\n          ")}`);
  }
  const verdict = /^VERDICT:\s*(\w+)/im.exec(reply)?.[1]?.toLowerCase() ?? "";
  const notes = (/NOTES:\s*\n?([\s\S]*)$/i.exec(reply)?.[1] ?? "").split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter((l) => l && l.toLowerCase() !== "none");
  if (verdict !== "shows" && verdict !== "revise") throw new Error(`writer check: reply had no verdict:\n${reply.slice(0, 300)}`);
  if (verdict === "revise" && !notes.length) throw new Error(`writer check: asked for a revision without notes:\n${reply.slice(0, 300)}`);
  return { step: "check", title: read.title, takeaway: read.takeaway, narration: read.narration, notes: verdict === "revise" ? notes : [] };
}

const REVISIONS = 2; // check, then up to this many revise-and-check rounds

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export async function writer(p: Project, force = false) {
  const who = persona(p.input.persona);
  const narrator = `${who.label}. ${who.brief}${who.expertise ? ` Expertise: ${who.expertise}` : ""}`;
  const secs = seconds(p);
  const length = secs ? target(secs) : FREE;
  const can = abilities();
  const grow = secs ? ", keeping within 10% of the length" : "; no length was asked for, so it may grow where a demonstration needs the room";
  const fill = (name: string, len: string) => prompt(name).replace("{{persona}}", narrator).replace("{{length}}", len).replace("{{abilities}}", can).replace("{{grow}}", grow);
  const f = p.factSheet!;
  const claims = `Claims, with ids:\n${JSON.stringify(f.claims, null, 1)}`;
  // The research angle is not passed on: the writer decides what the video is about from the whole research and from
  // the person who asked (their words and the plan's reading of why), which every writing step sees.
  const wishes = asked([...(p.plan?.story ?? []), p.plan?.tone ? `Tone: ${p.plan.tone}` : ""]);
  const research = `Topic: ${topic(p)}\n\n${viewer(p)}\n\n${wishes ? `${wishes}\n\n` : ""}Common misconception: ${f.misconception || "none"}\n\nResearch:\n${f.story}\n\n${claims}`;
  const prompts = [fill("writer", FREE), fill("cut", length), fill("review", length), prompt("structure"), fill("demonstrate", length), fill("revise", length)];
  await stage(p, "writer", [prompts, research, secs, p.plan?.visuals], 0.4, async () => {
    // Each finished step is saved with the key of its inputs, so a run that fails (say, on a network drop) resumes
    // from the last finished step instead of paying for the earlier ones again.
    const key = hash(prompts, research, secs);
    const saved = force ? [] : (p.writing ?? []).filter((s) => s.key === key);
    const steps: WritingStep[] = [];
    // A step can run more than once (check and revise rounds), so the nth run of a step resumes from its nth saved copy.
    const step = async (name: WritingStep["step"], call: () => Promise<{ value: string; usd: number }>, read = (reply: string) => parse(reply, name)) => {
      const old = saved.filter((s) => s.step === name)[steps.filter((s) => s.step === name).length];
      if (old) {
        steps.push(old);
        console.log(`  ${name}: saved from the last run`);
        return;
      }
      const r = await call();
      const s = { ...read(r.value), key };
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

    // Does it show its ideas working, on examples the picture can make visible? Notes go back to a revise step, and the
    // revision is read again, until it does. Notes still open after the last round are reported, and the trail keeps them.
    const check = async () => {
      const read = steps.at(-1)!;
      await step("check", () => text({ system: prompts[4]!.replace("{{thread}}", kept), user: `${research}\n\nThe narration:\n\n${show(read)}`, effort: "high" }), (reply) => parseCheck(reply, read));
      return steps.at(-1)!.notes;
    };
    let notes = await check();
    for (let round = 1; notes.length && round <= REVISIONS; round++) {
      const user = `${research}\n\nThe narration:\n\n${show(steps.at(-1)!)}\n\nThe director's notes:\n${notes.map((n) => `- ${n}`).join("\n")}`;
      await step("revise", () => text({ system: prompts[5]!.replace("{{thread}}", kept), user, effort: "high" }));
      notes = await check();
    }
    if (notes.length) console.log(`  !!! the examples still have open notes after ${REVISIONS} revisions:\n${notes.map((n) => `    ${n}`).join("\n")}`);

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
