// A plain implementation of the designer and viewer side of the Agents contract (engine/design/agents/api.ts), so the
// search loop runs end to end before engine/design/agents lands. It writes what the agent is given as plain text and
// applies answers literally; it decides nothing. The director side passes its answer through as it is written. When
// engine/design/agents exports its own Agents, callers use that instead (engine/design/search/design.ts brainAgents).
import type { Agents, DesignerAnswer, DesignerInput, DirectorAnswer, ViewerInput } from "../agents/api.ts";
import { idsOf } from "../intent/parse.ts";
import type { AgentTask, Design, Goal } from "../types.ts";

const GOAL = {
  type: "object",
  required: ["id", "says", "instrument", "value", "want", "weight", "why"],
  properties: { id: { type: "string" }, says: { type: "string" }, instrument: { type: "string" }, settings: { type: "object" }, value: { type: "string" }, want: { type: "object", properties: { min: { type: "number" }, max: { type: "number" }, near: { type: "number" } } }, weight: { type: "number" }, why: { type: "string" } },
};
const DESIGNER_SCHEMA = {
  type: "object",
  required: ["goals", "space", "overrides", "proposals", "done", "why"],
  properties: {
    goals: { type: "array", items: GOAL },
    space: { type: "object" },
    overrides: { type: "array", items: { type: "object", required: ["key", "value", "why"], properties: { key: { type: "string" }, why: { type: "string" } } } },
    proposals: { type: "array", items: { type: "object", required: ["kind", "ids", "why"], properties: { kind: { type: "string" }, ids: { type: "array", items: { type: "string" } }, why: { type: "string" } } } },
    pick: { type: "string" },
    done: { type: "boolean" },
    why: { type: "string" },
  },
};
const VIEWER_SCHEMA = {
  type: "object",
  required: ["seats", "pick", "fixes"],
  properties: {
    seats: { type: "array", items: { type: "object", required: ["who", "candidate", "saw", "remembers", "problems", "wouldKeepWatching"], properties: { who: { type: "string" }, candidate: { type: "string" }, saw: { type: "string" }, remembers: { type: "string" }, problems: { type: "array", items: { type: "string" } }, wouldKeepWatching: { type: "boolean" } } } },
    pick: { type: "string" },
    fixes: { type: "array", items: { type: "object", required: ["candidate", "field", "why"], properties: { candidate: { type: "string" }, field: { type: "string" }, why: { type: "string" } } } },
  },
};

const FIELDS = ["subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"] as const;

/** The round a designer task belongs to: one more than the latest round its candidates came from. */
export function roundOf(input: Pick<DesignerInput, "round">): number {
  const rs = (input.round?.candidates ?? []).map((c) => Number(c.id.match(/\.r(\d+)\./)?.[1] ?? 0));
  return rs.length ? Math.max(...rs) + 1 : 1;
}

function designerRequest(i: DesignerInput): string {
  const m = i.plan.moments[i.moment]!;
  const md = i.design.moments.find((x) => x.moment === i.moment)!;
  const dm = i.director.moments.find((x) => x.moment === i.moment);
  const at = (n: number) => i.words[Math.min(Math.max(0, n), i.words.length - 1)];
  const next = i.plan.moments[i.moment + 1];
  const said = i.words.slice(m.word, next ? next.word : undefined).map((w) => w.text).join(" ");
  const things = [...new Set(idsOf(m))].map((id) => i.plan.things.find((t) => t.id === id) ?? { id, kind: "material" as const }).map((t) => `${t.id} (${t.kind}${"desc" in t && t.desc ? `: ${t.desc}` : "text" in t && t.text ? `: "${t.text}"` : ""})`);
  const lines = [
    `Moment ${i.moment} of ${i.plan.moments.length}, starting on word ${m.word} ("${at(m.word)?.text}") at ${at(m.word)?.start.toFixed(2)} s.`,
    `Spoken in it: "${said}"`,
    `The author's intent: show ${m.show ?? "-"}, keep ${m.keep.join(", ") || "-"}${m.reveal ? `, reveal ${m.reveal}` : ""}${m.ask ? `, ask "${m.ask}"` : ""}${m.stress ? ", stress" : ""}, pace ${m.pace}; acts: ${m.acts.map((a) => `${a.ids.join(" ")} ${a.verb}${a.to ? ` ${a.to}` : ""}${a.arg ? ` "${a.arg}"` : ""}${a.speed ? ` ${a.speed}` : ""}`).join("; ") || "none"}.`,
    `Things on screen: ${things.join("; ")}.`,
    `The director: importance ${md.importance.value}${dm ? `; the viewer should know: ${dm.know}${dm.feel ? `; feel: ${dm.feel}` : ""}${dm.waiting ? `; waiting for: ${dm.waiting}` : ""}${dm.focus ? `; focus: ${dm.focus}` : ""}` : ""}. Viewing: ${i.design.viewing.screen}, ${i.design.viewing.width}x${i.design.viewing.height}, ${i.design.viewing.watch}.`,
    `Video goals: ${i.design.goals.filter((g) => g.scope === "video").map((g) => `${g.id}: ${g.says}`).join("; ") || "none"}.`,
    "",
    "The moment's design now (each field with where it came from):",
    ...FIELDS.map((f) => `- ${f}: ${JSON.stringify(md[f].value)} [${md[f].from}] ${md[f].why ?? ""}`),
    `- proposals: ${md.proposals.map((p) => `${p.value.kind} ${p.value.ids.join(" ")}`).join("; ") || "none"}`,
    "",
    "Instruments you can set goals on (value names and settings):",
    ...i.instruments.map((x) => `- ${x.name}: ${x.describe} Suggested settings: ${JSON.stringify(x.suggested)}`),
    "",
    `Style values you may override for this moment (write the key, it is applied as key@${i.moment}):`,
    ...Object.entries(i.styleValues).map(([k, v]) => `- ${k} = ${JSON.stringify(v.value)}: ${v.why}`),
  ];
  if (i.round) {
    lines.push("", `Round ${roundOf(i) - 1} results, best first (total miss is the weighted mean miss of the goals, 0 met):`);
    for (const c of i.round.candidates) {
      lines.push(`- ${c.id}: total ${c.total.toFixed(3)}; ${c.scores.map((s) => `${s.goal} ${s.value ?? "not measured"} (miss ${s.miss.toFixed(2)})`).join(", ")}`);
      lines.push(`  ${FIELDS.map((f) => `${f} ${JSON.stringify(c.design[f].value)}`).join("; ")}`);
    }
    if (i.round.sheet) lines.push("", `Their contact sheet, one row per candidate: ${i.round.sheet}`);
    lines.push("", "Pick one candidate by id (set pick), or revise goals and space for another round, or set done to keep the lowest miss.");
  } else lines.push("", "Write this moment's goals and the space worth searching. Set done when one round is enough.");
  return lines.join("\n");
}

export function standInAgents(): Agents {
  return {
    directorTask: (input) => ({ role: "director", id: "director", system: "Direct the video.", request: input.brief }),
    applyDirector(design: Design, a: DirectorAnswer): Design {
      const moments = design.moments.map((m) => {
        const d = a.moments.find((x) => x.moment === m.moment);
        return d ? { ...m, importance: { value: d.importance, from: "director" as const, why: d.know } } : m;
      });
      return { ...design, viewing: a.viewing, tempo: { value: a.tempo.value, from: "director", why: a.tempo.why }, moments, goals: [...design.goals.filter((g) => g.scope !== "video"), ...a.goals.map((g) => ({ ...g, scope: "video" as const }))], overrides: [...design.overrides, ...a.overrides], budget: a.budget };
    },
    designerTask(input: DesignerInput): AgentTask {
      return {
        role: "designer",
        id: `designer.m${input.moment}.r${roundOf(input)}`,
        system:
          "You are the designer of one moment of a video. Decide what good means for this moment, for this viewer and purpose, and say it as goals: each goal names an instrument, the reading value that shows it, the range you want, the instrument settings you choose and a weight. Then give the space worth searching: per design field, the values worth trying. Nothing is a default: the style values are suggestions you may keep or override with a reason.",
        request: designerRequest(input),
        schema: DESIGNER_SCHEMA,
        images: input.round?.sheet ? [input.round.sheet] : [],
      };
    },
    applyDesigner(design: Design, moment: number, a: DesignerAnswer): Design {
      const goals: Goal[] = a.goals.map((g) => ({ ...g, scope: "moment", moment, id: g.id.startsWith(`m${moment}.`) ? g.id : `m${moment}.${g.id}` }));
      const keyOf = (k: string) => (k.includes("@") ? k : `${k}@${moment}`);
      const overrides = [...design.overrides.filter((o) => !a.overrides.some((x) => keyOf(x.key) === o.key)), ...a.overrides.map((o) => ({ ...o, key: keyOf(o.key) }))];
      const moments = design.moments.map((m) => (m.moment === moment && a.proposals.length ? { ...m, proposals: [...m.proposals, ...a.proposals.map((p) => ({ value: { kind: p.kind, ids: p.ids, ...(p.args ? { args: p.args } : {}) }, from: "designer" as const, why: p.why }))] } : m));
      return { ...design, moments, overrides, goals: [...design.goals.filter((g) => !(g.scope === "moment" && g.moment === moment)), ...goals] };
    },
    viewerTask(input: ViewerInput): AgentTask {
      const tag = input.sheets.map((s) => s.image.replace(/^.*\//, "").replace(/\.jpg$/, "")).join("+");
      return {
        role: "viewer",
        id: `viewer.${tag}`,
        system: "You sit a viewer panel. For each seat, watch the sheet as that person would and say what they saw and remember, and what went wrong. Then pick the candidate that works best for this audience and say which design fields to fix.",
        request: [`Seats: ${input.seats.map((s) => `${s.who} (${s.why})`).join("; ") || "a first-time viewer, a distracted scroller, a demanding designer"}.`, `Spoken over these frames: "${input.transcript}"`, `Candidates: ${input.sheets.map((s) => s.candidate).join("; ")}.`, `The designer's goals: ${input.goals.map((g) => `${g.id}: ${g.says}`).join("; ")}.`, "Fix fields are design fields (subjectScale, subjectAt, arrangement, supportOpacity, typeScale, lead, dwell, camera) with a value."].join("\n"),
        schema: VIEWER_SCHEMA,
        images: input.sheets.map((s) => s.image),
      };
    },
  };
}

/** A director answer that keeps a design as it is (its viewing, tempo, importances and budget): for runs without a director. */
export function keepDirector(design: Design, why: string): DirectorAnswer {
  return {
    viewing: design.viewing,
    tempo: { value: design.tempo.value, why: design.tempo.why ?? "" },
    moments: design.moments.map((m) => ({ moment: m.moment, importance: m.importance.value, know: m.importance.why ?? "" })),
    demos: [],
    goals: design.goals.filter((g) => g.scope === "video"),
    overrides: [],
    budget: design.budget,
    corrections: [],
    seats: [],
    why,
  };
}
