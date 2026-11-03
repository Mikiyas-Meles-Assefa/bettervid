// The designer (docs/DESIGN-BRAIN.md 2.3, 4.1 to 4.8): one agent per moment. It writes the moment's goals with the
// instrument settings that would show them met, the space a search explores (per MomentDesign field, the values worth
// trying), overrides of the style for this moment (key@N), and proposals. After a search round it sees the candidates'
// goal scores, readings and contact sheet, and picks one or revises the space. The prompt (prompts/designer.md) gives
// knowledge, never recipes; the answer is checked strictly and every value it sets is Decided from "designer".
import { readingsText } from "../instruments/index.ts";
import type { AgentTask, Candidate, DecisionRecord, Design, Focus, Goal, MomentDesign } from "../types.ts";
import type { DesignerAnswer, DesignerInput, SearchSpace } from "./api.ts";
import {
  cardsText,
  checkGoals,
  dec,
  FOCI,
  fieldValueProblem,
  goalSchema,
  instrumentsText,
  isNum,
  momentLine,
  momentWords,
  overrideProblem,
  planNames,
  prompt,
  PROPOSAL_KINDS,
  relationsText,
  SPACE_FIELDS,
  styleFor,
  styleText,
  undrawnText,
  viewingText,
  type SpaceField,
} from "./common.ts";
import { allocate, CALLS_PER_MOMENT } from "./director.ts";

const LIST = { type: "array", minItems: 1 } as const;

export const DESIGNER_SCHEMA = {
  type: "object",
  required: ["goals", "space", "reasons", "overrides", "proposals", "done", "why"],
  properties: {
    goals: { type: "array", items: goalSchema("moment") },
    space: { type: "object", properties: Object.fromEntries(SPACE_FIELDS.map((f) => [f, LIST])) },
    reasons: { type: "object", properties: Object.fromEntries(SPACE_FIELDS.map((f) => [f, { type: "string" }])) },
    focus: { type: "object", required: ["value", "why"], properties: { value: { type: "string", enum: [...FOCI] }, why: { type: "string" } } },
    overrides: { type: "array", items: { type: "object", required: ["key", "value", "why"], properties: { key: { type: "string" }, why: { type: "string" } } } },
    proposals: {
      type: "array",
      items: { type: "object", required: ["kind", "ids", "why"], properties: { kind: { type: "string", enum: [...PROPOSAL_KINDS] }, ids: { type: "array", items: { type: "string" } }, args: { type: "object" }, why: { type: "string" } } },
    },
    pick: { type: "string" },
    done: { type: "boolean" },
    why: { type: "string" },
  },
} as const;

export const designerSystem = () => `${prompt("designer")}\n\n${prompt("library")}`;

/** This moment's share of the search: candidates a round and rounds, from the director's importance and budget. */
export function shareOf(design: Design, k: number, given?: DesignerInput["share"]): { candidates: number; rounds: number; calls: number; combinations: number } {
  const a = given ?? allocate(design).find((x) => x.moment === k) ?? { candidates: design.budget.candidatesPerMoment, rounds: design.budget.rounds, calls: CALLS_PER_MOMENT };
  return { candidates: a.candidates, rounds: a.rounds, calls: a.calls, combinations: a.candidates * a.rounds };
}

const show = (v: unknown) => JSON.stringify(v);

function momentDesignText(md: MomentDesign): string {
  const lines = SPACE_FIELDS.map((f) => {
    const d = md[f];
    return `- ${f} = ${show(d.value)} (${d.from}${d.why ? `: ${d.why}` : ""})`;
  });
  lines.unshift(`- focus = ${show(md.focus.value)} (${md.focus.from}${md.focus.why ? `: ${md.focus.why}` : ""})`);
  lines.push(md.proposals.length ? `Current proposals:\n${md.proposals.map((p) => `- ${show(p.value)} (${p.from}: ${p.why ?? ""})`).join("\n")}` : "Current proposals: none.");
  return lines.join("\n");
}

/** Candidates that share the lowest total miss: the numbers cannot choose between them. */
export function tiedBest(cs: Pick<Candidate, "id" | "total">[]): string[] {
  if (cs.length < 2) return [];
  const low = Math.min(...cs.map((c) => c.total));
  const tied = cs.filter((c) => Math.abs(c.total - low) <= 1e-6).map((c) => c.id);
  return tied.length > 1 ? tied : [];
}

function roundText(r: NonNullable<DesignerInput["round"]>, goals: Goal[]): string {
  const lines: string[] = [];
  if (r.final) lines.push("This is your last look at this moment: its share of the rounds or calls is spent. Pick one of these candidates (done true); there is no further round.", "");
  const tied = tiedBest(r.candidates);
  if (tied.length) lines.push(`${tied.join(", ")} tie at the lowest miss (${r.candidates.find((c) => c.id === tied[0])!.total.toFixed(3)}): the goals cannot choose between them, so choose by the sheet and what the moment is for${r.final ? "" : ", or search again with goals that tell them apart"}.`, "");
  for (const c of r.candidates) {
    const fields = SPACE_FIELDS.map((f) => `${f} ${show(c.design[f].value)}`).join(", ");
    lines.push(`### Candidate ${c.id} (total miss ${c.total.toFixed(2)})`, `values: ${fields}`);
    lines.push(`goal scores: ${c.scores.map((s) => (s.applies === false ? `${s.goal} does not apply here` : `${s.goal} ${s.value !== undefined ? `value ${Number(s.value.toFixed(3))}, ` : "not measured, "}miss ${s.miss.toFixed(2)}`)).join("; ") || "none"}`);
    if (c.readings.length) lines.push("readings:", readingsText(c.readings, { notes: 2 }));
    if (c.sheet) lines.push(`contact sheet: ${c.sheet}`);
  }
  if (r.readings.length) lines.push("", "Readings across the round:", readingsText(r.readings, { notes: 3 }));
  if (r.sheet) lines.push("", `The round's contact sheet: ${r.sheet}`);
  lines.push("", `Goals the scores are against: ${goals.map((g) => `${g.id} (${g.says})`).join("; ") || "none"}`);
  return lines.join("\n");
}

/** What the composition draws as things of its own, and the plan's names it does not (no instrument can read those). */
function drawnLines(input: DesignerInput): string[] {
  if (!input.drawn) return [];
  const drawn = new Set(input.drawn);
  const missing = [...planNames(input.plan, input.cards)].filter((n) => !drawn.has(n) && input.cards.some((c) => n.startsWith(`${c.name}.`)));
  return [
    `Names the composition draws as things of their own (what a value's <name> can be): ${input.drawn.join(", ") || "none"}.`,
    ...(missing.length ? [`Parts of the material it does not draw on their own, so no instrument reads them by name: ${missing.map((n) => { const w = undrawnText(n, input.cards, drawn); return w ? `${n} (${w})` : n; }).join("; ")}.`] : []),
  ];
}

/** The designer's task for one moment; on a repair round it carries the previous answer and its problems. */
export function designerTask(input: DesignerInput, repair?: { previous: unknown; problems: string[]; round: number }): AgentTask {
  const { plan, moment: k, design, director: dir } = input;
  const m = plan.moments[k]!;
  const md = design.moments.find((x) => x.moment === k)!;
  const n = plan.moments.length;
  const w = momentWords(plan, k, input.words);
  const said = dir.moments.find((x) => x.moment === k);
  const demos = dir.demos.filter((d) => d.moment === k);
  const holds = (input.holds ?? []).filter((h) => h.afterWord >= m.word && h.afterWord < (plan.moments[k + 1]?.word ?? input.words.length));
  const share = shareOf(design, k, input.share);
  const near = (j: number) => (plan.moments[j] ? `m${j}: "${momentWords(plan, j, input.words).text}" | ${momentLine(plan, j) || "nothing named"}` : undefined);
  const videoGoals = design.goals.filter((g) => g.scope === "video");
  const things = plan.things.map((t) => `- ${t.id} (${t.kind}): ${t.kind === "object" ? t.desc : t.kind === "many" ? `${t.many?.n} ${t.many?.unit}` : t.kind === "material" ? t.material?.name : `"${t.text}"`}`);
  const lines = [
    "## The video",
    ...(input.brief ? [`Brief: ${input.brief.trim()}`] : []),
    `Viewing: ${viewingText(design.viewing)}`,
    `The director: ${dir.why}`,
    `Tempo ${design.tempo.value} (${design.tempo.why ?? ""}).`,
    videoGoals.length ? `Video goals:\n${videoGoals.map((g) => `- ${g.id}: ${g.says} (${g.instrument} ${g.value} ${show(g.want)})`).join("\n")}` : "Video goals: none.",
    design.overrides.length ? `Overrides already set:\n${design.overrides.map((o) => `- ${o.key} = ${show(o.value)}: ${o.why}`).join("\n")}` : "Overrides already set: none.",
    "",
    "## The plan's things",
    ...things,
    ...(plan.relations?.length ? ["", ...relationsText(plan)] : []),
    "",
    `## This moment: m${k} of m0 to m${n - 1}`,
    `Words (${w.from.toFixed(1)} to ${w.to.toFixed(1)} s): "${w.text}"`,
    `Plan: ${momentLine(plan, k) || "nothing named"}`,
    ...(said ? [`The director: importance ${said.importance}; know: ${said.know}${said.feel ? `; feel: ${said.feel}` : ""}${said.waiting ? `; waiting for: ${said.waiting}` : ""}${said.focus ? `; focus ${said.focus}` : ""}`] : []),
    ...demos.map((d) => `Demonstration a${d.act}: ${show(d.speed)}${d.replay ? `, replay ${show(d.replay.speed)}` : ""} (${d.why})`),
    ...holds.map((h) => `Silence ${h.id}: ${h.seconds} s after "${input.words[h.afterWord]?.text ?? ""}"${h.purpose ? `, for ${h.purpose}` : ""}`),
    ...(m.pinned.length ? [`Pinned by the author: ${m.pinned.map((p) => p.text).join(" | ")}`] : []),
    ...(m.plain ? ["The author marked this moment plain: no proposals."] : []),
    `Before: ${near(k - 1) ?? "nothing (the video starts here)"}`,
    `After: ${near(k + 1) ?? "nothing (the video ends here)"}`,
    "",
    "## Material",
    cardsText(input.cards, input.requirements ?? []),
    "",
    "## The moment's current design (what a field keeps when your space leaves it out)",
    momentDesignText(md),
    "",
    "## This moment's share of the search",
    `${share.candidates} candidates a round for up to ${share.rounds} round${share.rounds === 1 ? "" : "s"}: the space may hold at most ${share.combinations} combinations. ${share.calls} model calls: one for this answer, one for each later look, and the last always goes to your look at the final round, where you pick.`,
    "",
    "## Instruments (goals name one instrument and one of its values)",
    instrumentsText(input.instruments),
    ...drawnLines(input),
    "",
    "## The style's suggestions (override with key@" + k + ")",
    styleText(styleFor(input.styleValues, plan, input.cards, md.proposals.map((p) => p.value.kind))),
  ];
  const images: string[] = [];
  if (input.round) {
    lines.push("", "## The last search round", roundText(input.round, design.goals.filter((g) => g.scope === "moment" && g.moment === k)));
    for (const s of [input.round.sheet, ...input.round.candidates.map((c) => c.sheet)]) if (s && !images.includes(s)) images.push(s);
  }
  if (repair) lines.push("", "## Your previous answer could not be used", JSON.stringify(repair.previous), "", "Problems; answer again with all of them fixed:", ...repair.problems.map((p) => `- ${p}`));
  const id = `designer.m${k}${input.round ? `.s${input.round.candidates[0]?.id ?? "x"}` : ""}${repair ? `.r${repair.round}` : ""}`;
  return { role: "designer", id, system: designerSystem(), request: lines.join("\n"), schema: DESIGNER_SCHEMA as unknown as Record<string, unknown>, ...(images.length ? { images } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks

const ARITY: Record<string, number> = { placeholder: 1, "compare-scale": 2, level: 2, pointer: 2 };

/** Problems with a designer's answer for this input: an empty list means it can be applied. */
export function checkDesigner(input: DesignerInput, a: DesignerAnswer): string[] {
  const out: string[] = [];
  const { plan, moment: k, design } = input;
  const m = plan.moments[k];
  if (!m) return [`moment ${k} does not exist`];
  const names = planNames(plan, input.cards);
  const holds = new Set((input.holds ?? []).map((h) => h.id));
  const reqs = new Set([...(input.requirements ?? []), ...input.cards.flatMap((c) => c.requirements)].map((r) => r.id));
  out.push(...checkGoals(a?.goals ?? [], { viewing: design.viewing, names, holds, requirements: reqs, scope: "moment", moment: k, ...(input.drawn ? { drawn: { names: new Set(input.drawn), cards: input.cards } } : {}) }, "goals"));
  // A video goal already holds over this moment; one repeated here is counted twice by the search.
  (a?.goals ?? []).forEach((g, i) => {
    const v = design.goals.find((x) => x.scope === "video" && (x.id === g?.id || (x.instrument === g?.instrument && x.value === g?.value)));
    if (v) out.push(`goals[${i}] (${g.id}): the video goal ${v.id} already measures ${v.instrument} ${v.value} over every moment; write only what this moment adds`);
  });
  const space = (a?.space ?? {}) as Record<string, unknown>;
  let combos = 1;
  for (const [f, vs] of Object.entries(space)) {
    if (!(SPACE_FIELDS as readonly string[]).includes(f)) {
      out.push(`space.${f}: not a field the search varies (${SPACE_FIELDS.join(", ")})`);
      continue;
    }
    if (!Array.isArray(vs) || !vs.length) {
      out.push(`space.${f}: a list of one or more values`);
      continue;
    }
    combos *= vs.length;
    vs.forEach((v, i) => {
      const p = fieldValueProblem(f, v);
      if (p) out.push(`space.${f}[${i}] ${show(v)}: ${p}`);
    });
    if (new Set(vs.map(show)).size < vs.length) out.push(`space.${f}: a value is listed twice`);
    if (!a.reasons?.[f as SpaceField]?.trim()) out.push(`reasons.${f}: why these values (each field in the space needs one)`);
  }
  for (const f of Object.keys(a?.reasons ?? {})) if (!(f in space)) out.push(`reasons.${f}: the space has no ${f}; give reasons only for fields in the space`);
  const share = shareOf(design, k, input.share);
  if (combos > share.combinations) out.push(`space: ${combos} combinations, but this moment's share of the search is at most ${share.combinations}; keep the values most worth trying`);
  if (a?.focus !== undefined && (!(FOCI as readonly string[]).includes(a.focus?.value) || !a.focus?.why?.trim())) out.push(`focus: value one of ${FOCI.join(", ")}, with a why`);
  (a?.overrides ?? []).forEach((o, i) => {
    if (typeof o.key === "string" && !o.key.includes("@")) out.push(`overrides[${i}]: "${o.key}" would change the whole video; write ${o.key}@${k} for this moment`);
    else {
      const p = overrideProblem(o.key, o.value, input.styleValues, plan.moments.length, k);
      if (p) out.push(`overrides[${i}]: ${p}`);
    }
    if (!o.why?.trim()) out.push(`overrides[${i}]: why is needed`);
  });
  if (m.plain && a?.proposals?.length) out.push("proposals: the author marked this moment plain; give none");
  (a?.proposals ?? []).forEach((p, i) => {
    const at = `proposals[${i}]`;
    if (!(PROPOSAL_KINDS as readonly string[]).includes(p.kind)) return void out.push(`${at}: kind "${p.kind}" is not one the engine draws (${PROPOSAL_KINDS.join(", ")})`);
    if (!Array.isArray(p.ids) || p.ids.length !== ARITY[p.kind]) return void out.push(`${at}: ${p.kind} takes ${ARITY[p.kind]} id${ARITY[p.kind] === 1 ? "" : "s"}`);
    const unknown = p.ids.filter((id) => !names.has(id));
    for (const id of unknown) out.push(`${at}: "${id}" is not a name in the plan or the material (ids are names, not words)`);
    if (unknown.length) return;
    // What each id must be, as the composer draws the kind: a material part is card.part.
    const isPart = (id: string) => input.cards.some((c) => id.startsWith(`${c.name}.`) && c.parts[id.slice(c.name.length + 1)] !== undefined);
    const isThing = (id: string) => plan.things.some((t) => t.id === id);
    if (p.kind === "pointer" && !(isThing(p.ids[0]!) && isPart(p.ids[1]!))) out.push(`${at}: a pointer joins a thing of the plan to a part of the user's material: ids [thing, card.part]`);
    if (p.kind === "level" && !(isPart(p.ids[0]!) && isThing(p.ids[1]!))) out.push(`${at}: a level is drawn on a part of the user's chart: ids [card.part, thing]`);
    if (p.kind === "level" && !isNum(p.args?.value)) out.push(`${at}: a level needs args.value, a number on the chart's scale`);
    if (!p.why?.trim()) out.push(`${at}: why is needed`);
  });
  const ids = (input.round?.candidates ?? []).map((c) => c.id);
  if (!input.round) {
    if (a?.pick !== undefined) out.push("pick: no search round has run yet; give no pick");
    if (a?.done) out.push("done: no search round has run yet; done is false");
  } else {
    if (a?.pick !== undefined && !ids.includes(a.pick)) out.push(`pick: "${a.pick}" is not a candidate (${ids.join(", ")})`);
    if (a?.done && a.pick === undefined) out.push("done: true needs a pick");
    if (!a?.done && a?.pick !== undefined) out.push("pick: a pick ends the search; set done true, or give no pick and a revised space");
    if (input.round.final && a?.pick === undefined) out.push(`pick: this is the last look at m${k} (its rounds or calls are spent); pick one of ${ids.join(", ")} and set done true`);
    else if (!a?.done && !Object.keys(space).length) out.push("space: to search again, give a revised space");
  }
  if (!a?.why?.trim()) out.push("why: a sentence on this moment's design is needed");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Apply

/**
 * The design with the designer's answer for moment k in it. A pick takes the picked candidate's MomentDesign (the search
 * already wrote where each of its values came from); otherwise each field the space sets to one value becomes Decided
 * from "designer" with its reason. Focus, proposals, this moment's overrides and goals replace the designer's earlier
 * ones; fields with several values stay as they are, for the search to vary.
 */
export function applyDesigner(design: Design, k: number, a: DesignerAnswer, picked?: Candidate): Design {
  const decisions: DecisionRecord[] = [];
  const gids = a.goals.map((g) => g.id);
  const rec = (area: string, choice: string, why: string) => decisions.push({ area, moment: k, choice, goals: gids, from: "designer", why });
  const moments = design.moments.map((md0) => {
    if (md0.moment !== k) return md0;
    let md: MomentDesign = { ...md0 };
    if (a.pick !== undefined && picked && picked.id === a.pick) {
      md = { ...picked.design, moment: k, importance: md0.importance };
      rec("pick", picked.id, a.why);
    } else {
      for (const f of SPACE_FIELDS) {
        const vs = a.space[f];
        if (!vs || vs.length !== 1) continue;
        const why = a.reasons?.[f] ?? a.why;
        (md as Record<SpaceField, unknown>)[f] = dec(vs[0], "designer", why);
        rec(f, show(vs[0]), why);
      }
      const searched = SPACE_FIELDS.filter((f) => (a.space[f]?.length ?? 0) > 1);
      if (searched.length) rec("space", searched.map((f) => `${f} ${show(a.space[f])}`).join("; "), searched.map((f) => a.reasons?.[f] ?? "").filter(Boolean).join("; ") || a.why);
    }
    if (a.focus) {
      md.focus = dec(a.focus.value as Focus, "designer", a.focus.why);
      rec("focus", a.focus.value, a.focus.why);
    }
    md.proposals = a.proposals.map((p) => dec({ kind: p.kind, ids: [...p.ids], ...(p.args ? { args: p.args } : {}) }, "designer", p.why));
    rec("proposals", a.proposals.map((p) => `${p.kind} ${p.ids.join(" ")}`).join("; ") || "none", a.proposals.map((p) => p.why).join("; ") || a.why);
    return md;
  });
  const keys = new Set(a.overrides.map((o) => (o.key.includes("@") ? o.key : `${o.key}@${k}`)));
  const overrides = [...design.overrides.filter((o) => !keys.has(o.key)), ...a.overrides.map((o) => ({ key: o.key.includes("@") ? o.key : `${o.key}@${k}`, value: o.value, why: o.why }))];
  for (const o of a.overrides) rec("override", `${o.key} = ${show(o.value)}`, o.why);
  const goals = [...design.goals.filter((g) => !(g.scope === "moment" && g.moment === k)), ...a.goals.map((g) => ({ ...g, scope: "moment" as const, moment: k }))];
  return { ...design, moments, overrides, goals, decisions: [...design.decisions, ...decisions] };
}

export type { SearchSpace };
