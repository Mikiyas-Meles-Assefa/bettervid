// What the director, the designer and the viewer panel share: their prompts (data in ./prompts/*.md), the request text
// of the plan, the material and the instruments, the goal schema, and the checks that turn an answer naming unknown
// moments, fields, instruments or values into problems for a repair round (never a silent drop).
import { readFileSync } from "node:fs";
import { ARRANGEMENTS } from "../compose/pack.ts";
import { instruments } from "../instruments/index.ts";
import { LAYOUT } from "../search/evaluate.ts";
import type { Decided, From, Goal, IntentPlan, PartCard, Requirement, Viewing, Word } from "../types.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Prompts are data: one Markdown file per agent, and a library of research the agents consult.

const cache = new Map<string, string>();
export function prompt(name: string): string {
  if (!cache.has(name)) cache.set(name, readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim());
  return cache.get(name)!;
}
export const PROMPTS = ["library", "director", "designer", "viewer"] as const;

export const dec = <T>(value: T, from: From, why?: string): Decided<T> => ({ value, from, ...(why ? { why } : {}) });
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// ---------------------------------------------------------------------------------------------------------------------
// Names an answer may use: the plan's things, the user's material and its parts.

export function planNames(plan: IntentPlan, cards: PartCard[] = []): Set<string> {
  const out = new Set<string>(plan.things.map((t) => t.id));
  for (const c of cards) {
    out.add(c.name);
    for (const p of Object.keys(c.parts)) out.add(`${c.name}.${p}`);
  }
  // Ids a moment names that no line declares (a part of the material written only in a moment) count too.
  for (const m of plan.moments) for (const id of [m.show, m.reveal, ...m.keep, ...(m.compare ?? []), ...m.wrong, ...m.acts.flatMap((a) => a.ids)]) if (id) out.add(id);
  // The composer names a moment's question as ask@<its word> (compose.ts ids), so a goal can measure it.
  for (const m of plan.moments) if (m.ask) out.add(`ask@${m.word}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan as text: things, then each moment with its spoken words and times.

const time = (words: Word[], i: number) => words[Math.max(0, Math.min(i, words.length - 1))]?.start ?? 0;

export function momentWords(plan: IntentPlan, k: number, words: Word[]): { from: number; to: number; text: string } {
  const m = plan.moments[k]!;
  const end = plan.moments[k + 1]?.word ?? words.length;
  const from = time(words, m.word);
  const last = words[Math.min(end, words.length) - 1];
  return { from, to: last ? (last.end ?? last.start) : from, text: words.slice(m.word, end).map((w) => w.text).join(" ") };
}

export function momentLine(plan: IntentPlan, k: number): string {
  const m = plan.moments[k]!;
  const bits: string[] = [];
  if (m.show) bits.push(`show ${m.show}`);
  if (m.reveal) bits.push(`reveal ${m.reveal}`);
  if (m.keep.length) bits.push(`keep ${m.keep.join(", ")}`);
  if (m.compare) bits.push(`compare ${m.compare.join(" and ")}`);
  if (m.ask) bits.push(`ask "${m.ask}"`);
  for (const b of m.becomes) bits.push(`${b.id} becomes ${b.text !== undefined ? `"${b.text}"` : b.n}`);
  for (const f of m.from) bits.push(`${f.a} from ${f.b}`);
  for (const a of m.arrows) bits.push(`${a.a} -> ${a.b}${a.label ? ` "${a.label}"` : ""}`);
  if (m.wrong.length) bits.push(`wrong ${m.wrong.join(", ")}`);
  if (m.stress) bits.push("stress");
  if (m.pace !== "normal") bits.push(`pace ${m.pace}`);
  m.acts.forEach((a, i) => bits.push(`act a${i}: ${a.ids.join(" ")} ${a.verb}${a.to ? ` ${a.to}` : ""}${a.arg ? ` "${a.arg}"` : ""}${a.speed ? ` (${a.speed})` : ""}`));
  if (m.pinned.length) bits.push(`pinned by the author: ${m.pinned.map((p) => p.text).join(" | ")}`);
  if (m.plain) bits.push("plain (the author refuses proposals here)");
  return bits.join("; ");
}

export function planText(plan: IntentPlan, words: Word[], holds: { id: string; afterWord: number; seconds: number; purpose?: string }[] = []): string {
  const lines: string[] = [];
  if (plan.feel || plan.audience) lines.push(`The author's top lines: ${[plan.feel && `feel ${plan.feel}`, plan.audience && `for ${plan.audience}`].filter(Boolean).join(", ")}`);
  lines.push("Things:");
  for (const t of plan.things) lines.push(`- ${t.id} (${t.kind}): ${t.kind === "object" ? t.desc : t.kind === "many" ? `${t.many?.n} ${t.many?.unit}` : t.kind === "material" ? `${t.material?.name}${t.material?.part ? `.${t.material.part}` : ""}` : `"${t.text}"`}`);
  lines.push("", "Moments (mK is the moment's number; answers name moments by K):");
  plan.moments.forEach((_, k) => {
    const w = momentWords(plan, k, words);
    lines.push(`- m${k} (from word ${plan.moments[k]!.word}, ${w.from.toFixed(1)} to ${w.to.toFixed(1)} s): "${w.text}"`, `  ${momentLine(plan, k) || "nothing named"}`);
  });
  if (holds.length) {
    lines.push("", "Silences in the narration:");
    for (const h of holds) lines.push(`- ${h.id}: ${h.seconds} s after word ${h.afterWord} ("${words[h.afterWord]?.text ?? ""}", ${time(words, h.afterWord).toFixed(1)} s)${h.purpose ? `, for ${h.purpose}` : ""}`);
  }
  const total = words.at(-1);
  if (total) {
    const spoken = total.end ?? total.start;
    // Silences sit after their word: the video runs until the last of them ends, which may be after the last word.
    const end = Math.max(spoken, ...holds.map((h) => (words[h.afterWord]?.end ?? time(words, h.afterWord)) + h.seconds));
    lines.push("", `The words end at about ${spoken.toFixed(1)} s (${words.length} words)${end > spoken + 0.05 ? `; with its silences the video runs to about ${end.toFixed(1)} s` : ""}.`);
  }
  return lines.join("\n");
}

export function cardsText(cards: PartCard[], requirements: Requirement[] = []): string {
  if (!cards.length && !requirements.length) return "The user brought no material.";
  const lines: string[] = ["The user's material:"];
  for (const c of cards) {
    lines.push(`- ${c.name} (${c.kind}, ${c.file}): ${c.about}`);
    const parts = Object.entries(c.parts);
    if (parts.length) lines.push(`  parts: ${parts.map(([p, v]) => `${c.name}.${p} (${v.about}${v.text ? `: "${v.text}"` : ""})`).join("; ")}`);
    if (c.data) lines.push(`  data (${c.data.kind}${c.data.unit ? `, ${c.data.unit}` : ""}): ${c.data.labels.map((l, i) => `${l} ${c.data!.values[i]}`).join(", ")}${c.data.total !== undefined ? `; total stated ${c.data.total}` : ""}`);
    if (c.text) lines.push(`  text: ${c.text.length > 1200 ? `${c.text.slice(0, 1200)} ...` : c.text}`);
    if (!c.checked.ok) lines.push(`  the reader's check found: ${c.checked.notes.join("; ")}`);
  }
  const reqs = [...requirements, ...cards.flatMap((c) => c.requirements.filter((r) => !requirements.some((x) => x.id === r.id)))];
  if (reqs.length) {
    lines.push("", "Requirements the material states (id: kind, detail, where):");
    for (const r of reqs) lines.push(`- ${r.id}: ${r.kind}${r.applies ? ` (about ${r.applies})` : ""}: ${r.detail} (${r.source.file}${r.source.where ? `, ${r.source.where}` : ""}; ${r.why})`);
  }
  return lines.join("\n");
}

export function viewingText(v: Viewing): string {
  const zones = v.uiZones.map((z) => `${z.what} [${z.box.map(fmt).join(", ")}]`).join("; ") || "none";
  return `${v.width}x${v.height} at ${v.fps} fps, ${v.screen}, frame ${v.frameWidthMm} mm wide seen from ${v.distanceMm} mm, ${v.watch}; UI zones: ${zones}; captions ${v.captions.show ? `shown${v.captions.box ? ` in [${v.captions.box.map(fmt).join(", ")}]` : ""}` : "not shown"} (${v.captions.why})`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instruments: what they report, their value names and their suggested settings.

export type InstrumentInfo = { name: string; describe: string; suggested: Record<string, unknown> };

export function instrumentInfo(viewing: Viewing): InstrumentInfo[] {
  return Object.values(instruments).map((i) => ({ name: i.name, describe: i.describe, suggested: i.suggest(viewing) as Record<string, unknown> }));
}

export function instrumentsText(list: InstrumentInfo[]): string {
  return list.map((i) => `- ${i.name}: ${i.describe}\n  suggested settings: ${JSON.stringify(i.suggested)}`).join("\n");
}

/** A section of an instrument's description ("Values:" or "Settings:"), split into the names it lists. */
function namesIn(describe: string, head: "Values" | "Settings"): string[] {
  const m = new RegExp(`${head}:([\\s\\S]*?)(?:\\.\\s+(?:Series|Settings|Values)\\b|\\.?\\s*$)`).exec(describe);
  if (!m) return [];
  let body = m[1]!;
  for (let i = 0; i < 3; i++) body = body.replace(/\([^()]*\)/g, " ");
  return body
    .split(/[,;:]|\band\b/)
    .map((s) => s.trim().replace(/\.$/, "").trim())
    .filter((s) => /^[A-Za-z]\w*(?:\.(?:<[^>]+>|\w+))*$/.test(s));
}

/** The value names an instrument reports, as patterns: `share.<plan name>` matches `share.` and any name. */
export function valueNames(describe: string): string[] {
  return namesIn(describe, "Values");
}
export function settingNames(describe: string): string[] {
  return namesIn(describe, "Settings");
}

/** Problems with a value name for an instrument: unknown names, and placeholders that name nothing in the plan. */
export function valueProblem(describe: string, value: string, names: Set<string>, holds: Set<string>): string | undefined {
  const pats = valueNames(describe);
  // A value the description names in full (area.anchor) is known before any pattern with a placeholder (area.<name>).
  if (pats.includes(value)) return undefined;
  for (const p of pats) {
    const segs = p.split(/\.(?![^<]*>)/);
    const vs = value.split(".");
    // A placeholder takes the rest of the value (a name may have a part: card.part).
    const ph = segs.findIndex((s) => s.startsWith("<"));
    if (ph < 0) {
      if (p === value) return undefined;
      continue;
    }
    const tail = segs.slice(ph + 1);
    if (vs.length < segs.length) continue;
    if (!segs.slice(0, ph).every((s, i) => s === vs[i])) continue;
    if (!tail.every((s, i) => s === vs[vs.length - tail.length + i])) continue;
    const said = vs.slice(ph, vs.length - tail.length).join(".");
    const isHold = /id/.test(segs[ph]!);
    if (isHold ? holds.has(said) : names.has(said)) return undefined;
    return `"${value}": ${said} is not ${isHold ? `a silence id (${[...holds].join(", ") || "there are none"})` : "a name in the plan or the material"}`;
  }
  return `"${value}" is not a value this instrument reports (it reports ${pats.join(", ")})`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Goals: the shared schema and check.

/** A goal as the schema shows it to an agent; `goalSchema("video")` leaves out the moment, which video goals do not have. */
export function goalSchema(scope: "video" | "moment") {
  const { moment: _m, scope: _s, ...rest } = GOAL_SCHEMA.properties;
  const required = [...GOAL_SCHEMA.required, "scope", ...(scope === "moment" ? ["moment"] : [])];
  return { ...GOAL_SCHEMA, required, properties: { ...rest, scope: { type: "string", enum: [scope] }, ...(scope === "moment" ? { moment: { type: "integer" } } : {}) } };
}

export const GOAL_SCHEMA = {
  type: "object",
  required: ["id", "says", "instrument", "value", "want", "weight", "why"],
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["video", "moment"] },
    moment: { type: "integer" },
    says: { type: "string" },
    instrument: { type: "string" },
    settings: { type: "object" },
    value: { type: "string" },
    want: { type: "object", properties: { min: { type: "number" }, max: { type: "number" }, near: { type: "number" } } },
    weight: { type: "number" },
    why: { type: "string" },
  },
} as const;

export type GoalCtx = { viewing: Viewing; names: Set<string>; holds: Set<string>; requirements: Set<string>; scope: "video" | "moment"; moment?: number };

export function checkGoals(goals: Goal[], ctx: GoalCtx, at: string): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  goals.forEach((g, i) => {
    const p = `${at}[${i}]${g?.id ? ` (${g.id})` : ""}`;
    if (!g || typeof g !== "object") return void out.push(`${p} is not a goal`);
    if (ids.has(g.id)) out.push(`${p}: the id ${g.id} is used twice`);
    ids.add(g.id);
    if (g.scope && g.scope !== ctx.scope) out.push(`${p}: scope is "${g.scope}", but this answer writes ${ctx.scope} goals`);
    if (ctx.scope === "moment" && g.moment !== undefined && g.moment !== ctx.moment) out.push(`${p}: moment ${g.moment}, but this answer is about moment ${ctx.moment}`);
    if (ctx.scope === "video" && g.moment !== undefined) out.push(`${p}: a video goal has no moment (moment goals are the designer's)`);
    // The search's own reading of the composer's boxes counts as an instrument too (search/evaluate.ts LAYOUT).
    const inst = instruments[g.instrument] ?? (g.instrument === LAYOUT.name ? { describe: LAYOUT.describe, suggest: () => LAYOUT.suggested } : undefined);
    if (!inst) return void out.push(`${p}: no instrument "${g.instrument}" (there are ${[LAYOUT.name, ...Object.keys(instruments)].join(", ")})`);
    const vp = typeof g.value === "string" ? valueProblem(inst.describe, g.value, ctx.names, ctx.holds) : `value should be a value name`;
    if (vp) out.push(`${p}: ${vp}`);
    const want = g.want ?? {};
    if (![want.min, want.max, want.near].some(isNum)) out.push(`${p}: want needs min, max or near`);
    if (isNum(want.min) && isNum(want.max) && want.min > want.max) out.push(`${p}: want.min ${want.min} is above want.max ${want.max}`);
    if (!isNum(g.weight) || g.weight < 0 || g.weight > 1) out.push(`${p}: weight should be a number from 0 to 1`);
    if (!g.says?.trim() || !g.why?.trim()) out.push(`${p}: says and why are needed, in plain words`);
    if (g.settings !== undefined) {
      if (typeof g.settings !== "object" || Array.isArray(g.settings)) out.push(`${p}: settings should be an object`);
      else {
        const known = new Set([...Object.keys(inst.suggest(ctx.viewing) as object), ...settingNames(inst.describe), "why"]);
        for (const k of Object.keys(g.settings)) if (!known.has(k)) out.push(`${p}: ${g.instrument} has no setting "${k}" (it has ${[...known].join(", ")})`);
        const r = (g.settings as Record<string, unknown>).requirement;
        if (r !== undefined && typeof r === "string" && !ctx.requirements.has(r)) out.push(`${p}: no requirement "${r}" (there are ${[...ctx.requirements].join(", ") || "none"})`);
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Style overrides: key or key@N, a key the style suggests, a value of the same shape.

export function overrideProblem(key: unknown, value: unknown, style: Record<string, { value: unknown }>, moments: number, onlyMoment?: number): string | undefined {
  if (typeof key !== "string") return "key should be a string";
  const [base, n] = key.split("@");
  const s = style[base!];
  if (!s) return `"${base}" is not a style value (see the style's suggestions for the keys)`;
  if (n !== undefined) {
    const k = Number(n);
    if (!Number.isInteger(k) || k < 0 || k >= moments) return `"${key}": moment ${n} does not exist (moments 0 to ${moments - 1})`;
    if (onlyMoment !== undefined && k !== onlyMoment) return `"${key}": this answer may only override moment ${onlyMoment} (write ${base}@${onlyMoment} or ${base})`;
  }
  const shape = (v: unknown) => (Array.isArray(v) ? `list of ${v.length}` : typeof v);
  if (shape(s.value) !== shape(value)) return `"${key}": the style's value is a ${shape(s.value)} (${JSON.stringify(s.value)}), the override a ${shape(value)}`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fields a search varies, and what a value of each looks like.

export const SPACE_FIELDS = ["subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"] as const;
export type SpaceField = (typeof SPACE_FIELDS)[number];
export const FOCI = ["one", "two", "none", "hidden", "all"] as const;
export const CAMERA_MOVES = ["hold", "push", "drift", "cut", "follow"] as const;
/** Proposal kinds the composer draws (engine/design/compose/compose.ts). */
export const PROPOSAL_KINDS = ["placeholder", "compare-scale", "level", "pointer"] as const;

const pair01 = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((x) => isNum(x) && x >= 0 && x <= 1);

export function fieldValueProblem(field: string, v: unknown): string | undefined {
  switch (field) {
    case "subjectScale":
      return isNum(v) && v > 0 && v <= 1.5 ? undefined : "a share of the usable frame, above 0 (1 fills it)";
    case "subjectAt":
      return pair01(v) ? undefined : "[x, y] as fractions of the usable frame, 0 to 1";
    case "arrangement":
      return typeof v === "string" && (ARRANGEMENTS as readonly string[]).includes(v) ? undefined : `one of ${ARRANGEMENTS.join(", ")}`;
    case "supportOpacity":
      return isNum(v) && v >= 0 && v <= 1 ? undefined : "an opacity from 0 to 1";
    case "typeScale":
      return isNum(v) && v > 0 ? undefined : "a multiplier above 0 on the style's type scale";
    case "lead":
      return isNum(v) ? undefined : "seconds (negative: after the word)";
    case "dwell":
      return isNum(v) && v >= 0 ? undefined : "seconds, 0 or more";
    case "camera": {
      const c = v as { zoom?: unknown; at?: unknown; move?: unknown; frames?: unknown };
      if (!c || typeof c !== "object") return "an object {zoom, at, move}";
      if (!isNum(c.zoom) || c.zoom <= 0) return "camera.zoom should be a number above 0 (1 is the whole frame)";
      if (!pair01(c.at)) return "camera.at should be [x, y] fractions of the frame";
      if (!(CAMERA_MOVES as readonly unknown[]).includes(c.move)) return `camera.move should be one of ${CAMERA_MOVES.join(", ")}`;
      if (c.frames !== undefined && (!isNum(c.frames) || c.frames < 0)) return "camera.frames should be a number of frames";
      return undefined;
    }
  }
  return `"${field}" is not a field the search varies (${SPACE_FIELDS.join(", ")})`;
}

export function styleText(values: Record<string, { value: unknown; why: string }>): string {
  return Object.entries(values)
    .map(([k, v]) => `- ${k} = ${JSON.stringify(v.value)}: ${v.why}`)
    .join("\n");
}

/**
 * The style's suggestions that can matter to this video: values read only by abilities the video does not use (a
 * chart's redraw with no chart, a fall with nothing falling) are left out of the prompt to keep it short. This maps
 * abilities to the keys they read; it is not a judgment of what is worth changing, and the checks accept every key.
 */
export function styleFor(values: Record<string, { value: unknown; why: string }>, plan: IntentPlan, cards: PartCard[] = [], proposals: string[] = []): Record<string, { value: unknown; why: string }> {
  const verbs = new Set(plan.moments.flatMap((m) => m.acts.map((a) => a.verb)));
  const kinds = new Set(plan.things.map((t) => t.kind));
  const ms = plan.moments;
  const uses: Record<string, boolean> = {
    chart: cards.some((c) => c.data),
    picture: cards.length > 0,
    apparatus: kinds.has("object"),
    flow: verbs.has("flows") || verbs.has("flashes") || verbs.has("fills"),
    fall: verbs.has("falls"),
    turns: verbs.has("turns"),
    sways: verbs.has("sways"),
    runs: verbs.has("runs"),
    reading: verbs.has("reads"),
    many: kinds.has("many"),
    compare: ms.some((m) => m.compare) || proposals.includes("compare-scale"),
    becomes: ms.some((m) => m.becomes.length > 0),
    level: proposals.includes("level") || cards.some((c) => c.data),
    strike: ms.some((m) => m.wrong.length > 0),
    wrong: ms.some((m) => m.wrong.length > 0),
    demo: verbs.has("falls") || verbs.has("flows"),
    ask: ms.some((m) => m.ask),
  };
  const group: Record<string, string> = { "type.wrong": "wrong", "type.question": "ask", "type.placeholder": "ask", "motion.placeholderPulse": "ask", "motion.placeholderDip": "ask", "motion.objectPulse": "apparatus" };
  const out: Record<string, { value: unknown; why: string }> = {};
  for (const [k, v] of Object.entries(values)) if (uses[group[k] ?? k.split(".")[0]!] !== false) out[k] = v;
  return out;
}
