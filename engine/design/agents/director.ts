// The director (docs/DESIGN-BRAIN.md 2.3, 4.6, 4.7): one agent per video. It decides the viewing (platform, frame,
// distance, UI zones, captions), the tempo, how much each moment carries the video (the search spends there), what the
// viewer should know, feel and wait for after each moment, how demonstrations play, the video's goals with instrument
// settings, style overrides, the search budget, corrections of the plan against the material (each a visible note) and
// extra viewer seats. The prompt (prompts/director.md) gives knowledge, never recipes; the answer is checked strictly.
import { styleValues, viewingFrom } from "../suggest.ts";
import type { AgentTask, Box, DecisionRecord, Design, DemoPlan, Focus, IntentPlan, Viewing } from "../types.ts";
import type { DirectorAnswer, DirectorInput } from "./api.ts";
import { cardsText, checkGoals, dec, FOCI, goalSchema, instrumentInfo, instrumentsText, isNum, overrideProblem, planNames, planText, prompt, styleFor, styleText, viewingText } from "./common.ts";

const BOX = { type: "array", items: { type: "number" } } as const;

export const VIEWING_SCHEMA = {
  type: "object",
  required: ["width", "height", "fps", "screen", "frameWidthMm", "distanceMm", "watch", "uiZones", "captions", "why"],
  properties: {
    width: { type: "integer" },
    height: { type: "integer" },
    fps: { type: "number" },
    screen: { type: "string" },
    frameWidthMm: { type: "number" },
    distanceMm: { type: "number" },
    watch: { type: "string" },
    uiZones: { type: "array", items: { type: "object", required: ["box", "what"], properties: { box: BOX, what: { type: "string" } } } },
    captions: { type: "object", required: ["show", "why"], properties: { show: { type: "boolean" }, box: BOX, why: { type: "string" } } },
    why: { type: "string" },
  },
} as const;

const SPEED = { anyOf: [{ type: "string", enum: ["real", "slow", "fast"] }, { type: "number" }] } as const;

export const DIRECTOR_SCHEMA = {
  type: "object",
  required: ["viewing", "tempo", "moments", "demos", "goals", "overrides", "budget", "corrections", "seats", "why"],
  properties: {
    viewing: VIEWING_SCHEMA,
    tempo: { type: "object", required: ["value", "why"], properties: { value: { type: "number" }, why: { type: "string" } } },
    moments: {
      type: "array",
      items: {
        type: "object",
        required: ["moment", "importance", "know"],
        properties: { moment: { type: "integer" }, importance: { type: "number" }, know: { type: "string" }, feel: { type: "string" }, waiting: { type: "string" }, focus: { type: "string", enum: [...FOCI] } },
      },
    },
    demos: {
      type: "array",
      items: { type: "object", required: ["moment", "act", "speed", "why"], properties: { moment: { type: "integer" }, act: { type: "integer" }, speed: SPEED, replay: { type: "object", required: ["speed"], properties: { speed: SPEED } }, why: { type: "string" } } },
    },
    goals: { type: "array", items: goalSchema("video") },
    overrides: { type: "array", items: { type: "object", required: ["key", "value", "why"], properties: { key: { type: "string" }, why: { type: "string" } } } },
    budget: { type: "object", required: ["candidatesPerMoment", "rounds", "calls"], properties: { candidatesPerMoment: { type: "integer" }, rounds: { type: "integer" }, calls: { type: "integer" } } },
    corrections: { type: "array", items: { type: "object", required: ["was", "now", "source"], properties: { moment: { type: "integer" }, was: { type: "string" }, now: { type: "string" }, source: { type: "string" } } } },
    seats: { type: "array", items: { type: "object", required: ["who", "why"], properties: { who: { type: "string" }, why: { type: "string" } } } },
    why: { type: "string" },
  },
} as const;

/** What the budget's calls buy, so the director can set them for every moment it wants searched. */
export function budgetText(plan: IntentPlan): string {
  const n = plan.moments.filter((m) => !m.plain).length;
  return `Calls are shared by importance. A moment the search reaches costs at least ${CALLS_PER_MOMENT} calls: the designer writes its goals and space, and its last call is always its look at the final round, where it picks. Each further round costs one more call, and the viewer panel one more. This plan has ${n} moment${n === 1 ? "" : "s"} to search, so ${n * CALLS_PER_MOMENT} calls reach every one of them once; with fewer, the least important keep their design untried.`;
}

/** The director's system prompt: its role and the library of research it consults. */
export const directorSystem = () => `${prompt("director")}\n\n${prompt("library")}`;

/** The director's task for a video; on a repair round it carries the previous answer and its problems. */
export function directorTask(input: DirectorInput, repair?: { previous: unknown; problems: string[]; round: number }): AgentTask {
  const viewing = input.viewing ?? input.start.viewing;
  const start = input.start;
  const S = styleValues(input.theme, viewing);
  const demos = start.demos.map((d) => `- m${d.moment} act a${d.act}: ${JSON.stringify(d.speed.value)}${d.replay ? `, replay ${JSON.stringify(d.replay.value.speed)}` : ""} (${d.speed.why ?? d.why})`);
  const lines = [
    "## The brief",
    input.brief.trim(),
    ...(input.direction ? ["", "## The direction plan the plan was written from", input.direction.trim()] : []),
    "",
    "## The plan",
    planText(input.plan, input.words, input.holds),
    "",
    "## Material",
    cardsText(input.cards, input.requirements),
    "",
    "## Where the engine would start (suggestions, replace anything)",
    `Viewing: ${viewingText(viewing)}`,
    `Style: ${input.styleName}. Tempo ${start.tempo.value} (${start.tempo.why}).`,
    `Budget: ${JSON.stringify(start.budget)}. ${budgetText(input.plan)}`,
    demos.length ? `Demonstrations as suggested:\n${demos.join("\n")}` : "No demonstrations suggested.",
    "",
    "## Instruments (goals name one instrument and one of its values)",
    instrumentsText(instrumentInfo(viewing)),
    "",
    "## The style's suggestions (keys you may override, with the reason each has now)",
    styleText(styleFor(S, input.plan, input.cards, start.moments.flatMap((m) => m.proposals.map((p) => p.value.kind)))),
  ];
  if (repair) lines.push("", "## Your previous answer could not be used", JSON.stringify(repair.previous), "", "Problems; answer again with all of them fixed:", ...repair.problems.map((p) => `- ${p}`));
  return { role: "director", id: repair ? `director.r${repair.round}` : "director", system: directorSystem(), request: lines.join("\n"), schema: DIRECTOR_SCHEMA as unknown as Record<string, unknown> };
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks

const boxProblem = (b: unknown): string | undefined => {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((x) => isNum(x) && x >= 0 && x <= 1)) return "a box is [x0, y0, x1, y1] as fractions 0 to 1 of the frame";
  const [x0, y0, x1, y1] = b as Box;
  return x1 > x0 && y1 > y0 ? undefined : "a box needs x1 above x0 and y1 above y0";
};

export function checkViewing(v: Viewing | undefined, at = "viewing"): string[] {
  if (!v || typeof v !== "object") return [`${at} is missing`];
  const out: string[] = [];
  for (const k of ["width", "height", "fps", "frameWidthMm", "distanceMm"] as const) if (!isNum(v[k]) || v[k] <= 0) out.push(`${at}.${k} should be a number above 0`);
  for (const k of ["screen", "watch", "why"] as const) if (typeof v[k] !== "string" || !v[k].trim()) out.push(`${at}.${k} needs plain words`);
  (v.uiZones ?? []).forEach((z, i) => {
    const p = boxProblem(z?.box);
    if (p) out.push(`${at}.uiZones[${i}]: ${p}`);
  });
  if (!v.captions || typeof v.captions.show !== "boolean") out.push(`${at}.captions.show should be true or false`);
  else if (v.captions.show && v.captions.box !== undefined) {
    const p = boxProblem(v.captions.box);
    if (p) out.push(`${at}.captions.box: ${p}`);
  }
  return out;
}

/** Where a correction's words occur in the plan: a thing's text or description, an act's argument, an ask. */
function textsOf(plan: IntentPlan, moment?: number): string[] {
  const ms = moment === undefined ? plan.moments : plan.moments.slice(moment, moment + 1);
  const named = new Set(ms.flatMap((m) => [m.show, m.reveal, ...m.keep, ...m.acts.flatMap((a) => a.ids)].filter(Boolean) as string[]));
  return [
    ...plan.things.filter((t) => moment === undefined || named.has(t.id)).flatMap((t) => [t.text, t.desc]),
    ...ms.flatMap((m) => [m.ask, ...m.acts.map((a) => a.arg), ...m.becomes.map((b) => b.text), ...m.arrows.map((a) => a.label)]),
  ].filter((x): x is string => typeof x === "string");
}

/** Problems with a director's answer for this input: an empty list means it can be applied. */
export function checkDirector(input: DirectorInput, a: DirectorAnswer): string[] {
  const out: string[] = [];
  const plan = input.plan;
  const n = plan.moments.length;
  const viewing = a?.viewing ?? input.viewing ?? input.start.viewing;
  out.push(...checkViewing(a?.viewing));
  if (!a?.tempo || !isNum(a.tempo.value) || a.tempo.value <= 0) out.push("tempo.value should be a number above 0 (1 is the style's own pace)");
  const seen = new Set<number>();
  (a?.moments ?? []).forEach((m, i) => {
    const p = `moments[${i}]`;
    if (!Number.isInteger(m.moment) || m.moment < 0 || m.moment >= n) return void out.push(`${p}: moment ${m.moment} does not exist; moments are numbered 0 to ${n - 1} (m0 ... m${n - 1}), not by word`);
    if (seen.has(m.moment)) out.push(`${p}: moment ${m.moment} is given twice`);
    seen.add(m.moment);
    if (!isNum(m.importance) || m.importance < 0 || m.importance > 1) out.push(`${p}: importance should be from 0 to 1`);
    if (!m.know?.trim()) out.push(`${p}: know needs plain words (what the viewer should know after m${m.moment})`);
    if (m.focus !== undefined && !(FOCI as readonly string[]).includes(m.focus)) out.push(`${p}: focus "${m.focus}" should be one of ${FOCI.join(", ")}`);
  });
  const missing = plan.moments.map((_, k) => k).filter((k) => !seen.has(k));
  if (missing.length) out.push(`moments: every moment needs an entry; missing ${missing.map((k) => `m${k}`).join(", ")}`);
  const demoSeen = new Set<string>();
  (a?.demos ?? []).forEach((d, i) => {
    const p = `demos[${i}]`;
    const m = plan.moments[d.moment];
    if (!m) return void out.push(`${p}: moment ${d.moment} does not exist (0 to ${n - 1})`);
    if (!m.acts[d.act]) return void out.push(`${p}: m${d.moment} has no act a${d.act}${m.acts.length ? ` (it has ${m.acts.map((x, j) => `a${j} ${x.verb}`).join(", ")})` : " (it has no acts)"}`);
    if (demoSeen.has(`${d.moment}.${d.act}`)) out.push(`${p}: m${d.moment} a${d.act} is given twice`);
    demoSeen.add(`${d.moment}.${d.act}`);
    for (const [k, s] of [["speed", d.speed], ["replay.speed", d.replay?.speed]] as const) if (s !== undefined && !(s === "real" || s === "slow" || s === "fast" || (isNum(s) && s > 0))) out.push(`${p}: ${k} should be "real", "slow", "fast" or a share of real speed above 0`);
  });
  const names = planNames(plan, input.cards);
  const holds = new Set(input.holds.map((h) => h.id));
  const reqs = new Set([...input.requirements, ...input.cards.flatMap((c) => c.requirements)].map((r) => r.id));
  out.push(...checkGoals(a?.goals ?? [], { viewing, names, holds, requirements: reqs, scope: "video", ...(input.drawn ? { drawn: { names: new Set(input.drawn), cards: input.cards } } : {}) }, "goals"));
  const S = styleValues(input.theme, viewing);
  (a?.overrides ?? []).forEach((o, i) => {
    const p = overrideProblem(o.key, o.value, S, n);
    if (p) out.push(`overrides[${i}]: ${p}`);
    if (!o.why?.trim()) out.push(`overrides[${i}]: why is needed`);
  });
  const b = a?.budget;
  if (!b || ![b.candidatesPerMoment, b.rounds, b.calls].every((x) => Number.isInteger(x) && x >= 1)) out.push("budget: candidatesPerMoment, rounds and calls should be whole numbers of at least 1");
  (a?.corrections ?? []).forEach((c, i) => {
    const p = `corrections[${i}]`;
    if (c.moment !== undefined && (!Number.isInteger(c.moment) || c.moment < 0 || c.moment >= n)) return void out.push(`${p}: moment ${c.moment} does not exist (0 to ${n - 1})`);
    if (!c.was?.trim() || !c.now?.trim() || !c.source?.trim()) return void out.push(`${p}: was, now and source are needed`);
    if (c.was === c.now) return void out.push(`${p}: was and now are the same`);
    if (!textsOf(plan, c.moment).some((t) => t.includes(c.was))) out.push(`${p}: "${c.was}" is not in the plan${c.moment !== undefined ? ` at m${c.moment}` : ""}; copy the exact words to correct`);
  });
  (a?.seats ?? []).forEach((s, i) => {
    if (!s.who?.trim() || !s.why?.trim()) out.push(`seats[${i}]: who and why are needed`);
  });
  if (!a?.why?.trim()) out.push("why: a sentence on the whole direction is needed");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Apply

/** The plan with the director's corrections made, and a visible note for each (never silent). */
export function applyCorrections(plan: IntentPlan, a: DirectorAnswer): { plan: IntentPlan; notes: string[] } {
  const out: IntentPlan = structuredClone(plan);
  const notes: string[] = [];
  for (const c of a.corrections ?? []) {
    const fix = (s: string | undefined) => (s !== undefined && s.includes(c.was) ? s.split(c.was).join(c.now) : s);
    const ms = c.moment === undefined ? out.moments : out.moments.slice(c.moment, c.moment + 1);
    const named = new Set(ms.flatMap((m) => [m.show, m.reveal, ...m.keep, ...m.acts.flatMap((x) => x.ids)].filter(Boolean) as string[]));
    for (const t of out.things) if (c.moment === undefined || named.has(t.id)) (t.text = fix(t.text)), (t.desc = fix(t.desc));
    for (const m of ms) {
      m.ask = fix(m.ask);
      for (const x of m.acts) x.arg = fix(x.arg);
      for (const b of m.becomes) b.text = fix(b.text);
      for (const r of m.arrows) r.label = fix(r.label) ?? r.label;
    }
    const note = `corrected${c.moment !== undefined ? ` at m${c.moment}` : ""}: "${c.was}" is now "${c.now}" (${c.source})`;
    notes.push(note);
    out.notes.push(note);
  }
  return { plan: out, notes };
}

/** The design with the director's answer in it. Every value it sets is Decided from "director" with its why. */
export function applyDirector(design: Design, a: DirectorAnswer): Design {
  const decisions: DecisionRecord[] = [];
  const rec = (area: string, choice: string, why: string, moment?: number) => decisions.push({ area, ...(moment !== undefined ? { moment } : {}), choice, goals: [], from: "director", why });
  const viewing = viewingFrom(a.viewing);
  rec("viewing", `${viewing.width}x${viewing.height}, ${viewing.screen}, ${viewing.watch}; captions ${viewing.captions.show ? "shown" : "not shown"}`, `${viewing.why}; captions: ${viewing.captions.why}`);
  rec("tempo", String(a.tempo.value), a.tempo.why);
  const moments = design.moments.map((md) => {
    const d = a.moments.find((x) => x.moment === md.moment);
    if (!d) return md;
    const said = [`know: ${d.know}`, d.feel && `feel: ${d.feel}`, d.waiting && `waiting for: ${d.waiting}`].filter(Boolean).join("; ");
    rec("direction", `importance ${d.importance}${d.focus ? `, focus ${d.focus}` : ""}`, said, md.moment);
    return { ...md, importance: dec(d.importance, "director", said), ...(d.focus ? { focus: dec(d.focus as Focus, "director", said) } : {}) };
  });
  const demos: DemoPlan[] = design.demos.filter((x) => !a.demos.some((d) => d.moment === x.moment && d.act === x.act));
  for (const d of a.demos) {
    demos.push({ moment: d.moment, act: d.act, speed: dec(d.speed, "director", d.why), ...(d.replay ? { replay: dec(d.replay, "director", d.why) } : {}), why: d.why });
    rec("demonstration", `a${d.act}: ${d.speed}${d.replay ? `, replay ${d.replay.speed}` : ""}`, d.why, d.moment);
  }
  demos.sort((x, y) => x.moment - y.moment || x.act - y.act);
  const overrides = [...design.overrides.filter((o) => !a.overrides.some((x) => x.key === o.key)), ...a.overrides.map((o) => ({ key: o.key, value: o.value, why: o.why }))];
  for (const o of a.overrides) rec("override", `${o.key} = ${JSON.stringify(o.value)}`, o.why);
  // Video goals come from the director alone: a new answer replaces the last one's.
  const goals = [...design.goals.filter((g) => g.scope !== "video"), ...a.goals.map(({ moment: _m, ...g }) => ({ ...g, scope: "video" as const }))];
  for (const c of a.corrections) rec("correction", `"${c.was}" is now "${c.now}"`, c.source, c.moment);
  for (const s of a.seats) rec("seat", s.who, s.why);
  rec("budget", JSON.stringify(a.budget), a.why);
  return { ...design, viewing, tempo: dec(a.tempo.value, "director", a.tempo.why), moments, demos, overrides, goals, budget: { ...a.budget }, decisions: [...design.decisions, ...decisions] };
}

/** Whole numbers summing to `total` (at least `floor` each when the total allows), in proportion to `share`. */
function split(total: number, share: number[], floor: number): number[] {
  const n = share.length;
  const base = Math.min(floor, Math.floor(total / n));
  const left = Math.max(0, total - base * n);
  const raw = share.map((s) => s * left);
  const out = raw.map((r) => base + Math.floor(r));
  let rest = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let j = 0; rest > 0; j = (j + 1) % n, rest--) out[order[j]!.i]!++;
  return out;
}

/** Model calls a searched moment needs at least: the designer writes its goals and space, then looks at the candidates and picks. */
export const CALLS_PER_MOMENT = 2;

/**
 * The search effort per moment: the video's budget split by the director's importance, so the moments that carry the
 * video get more candidates, rounds and calls. Candidates and calls sum exactly to the budget (candidatesPerMoment
 * times the moments, and calls). Every moment that gets calls gets at least CALLS_PER_MOMENT, so its last round is
 * always looked at by the designer; when the calls cannot cover every moment, the most important ones get them and the
 * rest get none (the search says so for each). Rounds are a ceiling per moment: the most important moment may use all
 * of them, the others in proportion. `skip`: moments that are not searched (marked plain), which take no share.
 */
export function allocate(design: Design, skip: ReadonlySet<number> = new Set()): { moment: number; candidates: number; rounds: number; calls: number }[] {
  const n = design.moments.length;
  if (!n) return [];
  const imp = design.moments.map((m) => (skip.has(m.moment) ? 0 : Math.max(0, m.importance.value)));
  const live = design.moments.map((m) => !skip.has(m.moment));
  const shareOf = (on: boolean[]) => {
    const sum = imp.reduce((s, x, i) => s + (on[i] ? x : 0), 0);
    const count = on.filter(Boolean).length;
    return imp.map((x, i) => (!on[i] ? 0 : sum > 0 ? x / sum : 1 / Math.max(1, count)));
  };
  // Which moments the calls reach: all when they cover CALLS_PER_MOMENT each, else the most important first.
  const reach = Math.floor(design.budget.calls / CALLS_PER_MOMENT);
  const order = design.moments.map((m, i) => ({ i, imp: imp[i]! })).filter((x) => live[x.i]).sort((a, b) => b.imp - a.imp || a.i - b.i);
  const called = design.moments.map(() => false);
  for (const x of order.slice(0, reach)) called[x.i] = true;
  const share = shareOf(live);
  const callShare = shareOf(called);
  const top = Math.max(...share, 1e-9);
  const cand = splitOver(design.budget.candidatesPerMoment * n, share, live, 1);
  const calls = splitOver(design.budget.calls, callShare, called, CALLS_PER_MOMENT);
  return design.moments.map((m, i) => ({ moment: m.moment, candidates: cand[i]!, rounds: live[i] ? Math.max(1, Math.round((design.budget.rounds * share[i]!) / top)) : 0, calls: calls[i]! }));
}

/** `split` over the moments marked `on` only; the others get 0. */
function splitOver(total: number, share: number[], on: boolean[], floor: number): number[] {
  const idx = on.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  const out = share.map(() => 0);
  if (!idx.length) return out;
  const part = split(total, idx.map((i) => share[i]!), floor);
  idx.forEach((i, j) => (out[i] = part[j]!));
  return out;
}
