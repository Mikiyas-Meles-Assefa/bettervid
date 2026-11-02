// The teaching stage: Spark says what is on the board at each spoken moment, and gives each thing an identity. The video
// engine keeps things on screen and animates the differences, so the viewer sees where everything comes from.
import type { Project, StageAtom, StageLine, StagePart, StagePlan } from "../../schemas/project.ts";
import { text } from "../lib/meta.ts";
import { asked, charge, prompt, stage as run, topic } from "../lib/project.ts";

const blank = { id: "", text: "", num: [] as StageAtom[], den: [] as StageAtom[], rows: [] as StageAtom[][], bars: false };

function atom(tok: string): StageAtom {
  const at = tok.indexOf("=", 1);
  return at < 0 ? { id: tok, text: tok } : { id: tok.slice(0, at), text: tok.slice(at + 1).replace(/_/g, " ") };
}

// Parses the compact plan. A long plan does not fit in JSON, and writing it as text is easier to get right.
function parse(reply: string): StagePlan {
  const states: StagePlan["states"] = [];
  for (const raw of reply.replace(/```[a-z]*/g, "").split("\n")) {
    const line = raw.trim();
    const head = /^@(\d+)\s*(?:light:\s*(.*))?$/.exec(line);
    if (head) {
      states.push({ word: Number(head[1]), light: (head[2] ?? "").split(/\s+/).filter(Boolean), lines: [] });
      continue;
    }
    const body = /^(big|normal|note):\s*(.*)$/.exec(line);
    const state = states.at(-1);
    if (!body || !state) continue;
    const toks = body[2]!.split(/\s+/).filter(Boolean);
    const parts: StagePart[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      const close = t === "{" ? "}" : t === "[" ? "]" : t === "|" ? "|" : "";
      if (!close) {
        parts.push({ ...blank, type: "text", ...atom(t) });
        continue;
      }
      const inner: string[] = [];
      for (i++; i < toks.length && toks[i] !== close; i++) inner.push(toks[i]!);
      if (close === "}") {
        const cut = inner.indexOf("/");
        parts.push({ ...blank, type: "frac", num: inner.slice(0, cut).map(atom), den: inner.slice(cut + 1).map(atom) });
      } else {
        const rows: StageAtom[][] = [[]];
        for (const x of inner) x === ";" ? rows.push([]) : rows.at(-1)!.push(atom(x));
        parts.push({ ...blank, type: "matrix", rows, bars: close === "|" });
      }
    }
    state.lines.push({ size: body[1] as StageLine["size"], parts });
  }
  return { states };
}

const atoms = (s: StagePlan["states"][number]) =>
  s.lines.flatMap((l) => l.parts.flatMap((p) => [...(p.type === "text" ? [p] : []), ...p.num, ...p.den, ...p.rows.flat()]));

// What code can prove: numbers spoken while they are not on the board, duplicates, and nothing changing for long.
function check(plan: StagePlan, words: { text: string; start: number }[]): string[] {
  const out: string[] = [];
  plan.states.forEach((s, i) => {
    const list = atoms(s);
    const dup = list.map((a) => a.id).filter((id, k, all) => all.indexOf(id) !== k);
    if (dup.length) out.push(`State ${i} uses the id ${dup[0]} twice.`);
    const shown = list.map((a) => a.text).join(" ");
    const end = plan.states[i + 1]?.word ?? words.length;
    for (const w of words.slice(s.word, end)) {
      const num = /\d+/.exec(w.text)?.[0];
      if (num && !shown.includes(num)) out.push(`The narrator says "${w.text}" at word ${words.indexOf(w)} but ${num} is not on the board in state ${i}.`);
    }
    const next = words[plan.states[i + 1]?.word ?? words.length - 1]?.start ?? 0;
    if (next - (words[s.word]?.start ?? 0) > 6) out.push(`State ${i} stays unchanged for over 6 seconds; add states that follow the voice.`);
  });
  return [...new Set(out)];
}

export async function stage(p: Project, force = false) {
  const words = p.narration!.words;
  const spoken = words.map((w, i) => `${i} ${w.start.toFixed(1)}s ${w.text}`).join("\n");
  const wishes = asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])]);
  const user = `Topic: ${topic(p)}\n\n${wishes ? `${wishes}\n\n` : ""}Spoken words (number, time, word):\n${spoken}`;
  await run(p, "stage", [user, prompt("stage")], 0.3, async () => {
    let usd = 0;
    let ask = user;
    let plan: StagePlan | undefined;
    let reply = "";
    for (let round = 1; round <= 3; round++) {
      const r = await text({ system: prompt("stage"), user: ask, effort: "medium" });
      usd += r.usd;
      reply = r.value;
      plan = parse(reply);
      plan.states.sort((a, b) => a.word - b.word);
      if (plan.states[0]) plan.states[0].word = 0;
      const problems = check(plan, words);
      console.log(`  round ${round}: ${plan.states.length} states, ${problems.length} problems`);
      for (const x of problems.slice(0, 6)) console.log(`    ${x}`);
      if (!problems.length) break;
      ask = `${user}\n\nYour plan:\n${reply}\n\nFix these problems and return the whole plan:\n${problems.slice(0, 30).join("\n")}`;
    }
    p.stagePlan = plan;
    charge(p, "stage", usd, `${plan!.states.length} states`);
  }, force);
}
