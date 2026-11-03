// The viewer panel (docs/DESIGN-BRAIN.md 2.3, 4.10): viewers on the finalists' contact sheets with the words spoken.
// Three standing seats (a first-time viewer, a distracted scroller, a demanding designer) and the seats the director adds
// for this audience. Each seat reports what it saw and remembers, its problems and whether it would keep watching; the
// panel picks a finalist and gives concrete fixes as field changes. The prompt (prompts/viewer.md) carries no taste.
import { themeFrom } from "../../render/theme.ts";
import { styleValues, viewingFrom } from "../suggest.ts";
import type { AgentTask } from "../types.ts";
import type { ViewerAnswer, ViewerInput } from "./api.ts";
import { fieldValueProblem, prompt, SPACE_FIELDS } from "./common.ts";

/** The seats every panel has; the director adds more per audience. */
export const STANDING_SEATS: { who: string; why: string }[] = [
  { who: "first-time viewer", why: "knows nothing of the subject beyond what the video shows and says" },
  { who: "distracted scroller", why: "glances at a phone between other things and leaves the moment nothing pulls" },
  { who: "demanding designer", why: "judges composition, type, hierarchy, motion and consistency as a top studio would" },
];

export function seatsOf(input: ViewerInput): { who: string; why: string }[] {
  const out = [...STANDING_SEATS];
  for (const s of input.seats) if (!out.some((x) => x.who.toLowerCase() === s.who.toLowerCase())) out.push(s);
  return out;
}

export const VIEWER_SCHEMA = {
  type: "object",
  required: ["seats", "pick", "fixes"],
  properties: {
    seats: {
      type: "array",
      items: {
        type: "object",
        required: ["who", "candidate", "saw", "remembers", "problems", "wouldKeepWatching"],
        properties: { who: { type: "string" }, candidate: { type: "string" }, saw: { type: "string" }, remembers: { type: "string" }, problems: { type: "array", items: { type: "string" } }, wouldKeepWatching: { type: "boolean" } },
      },
    },
    pick: { type: "string" },
    fixes: { type: "array", items: { type: "object", required: ["candidate", "field", "value", "why"], properties: { candidate: { type: "string" }, field: { type: "string" }, why: { type: "string" } } } },
  },
} as const;

/** The panel's task on a set of finalists. */
export function viewerTask(input: ViewerInput, repair?: { previous: unknown; problems: string[]; round: number }): AgentTask {
  const seats = seatsOf(input);
  const lines = [
    "## The seats (\"who\" in the answer is the quoted name, exactly)",
    ...seats.map((s) => `- ${JSON.stringify(s.who)}: ${s.why}`),
    "",
    "## What the video wants here (the goals, in plain words)",
    ...(input.goals.length ? input.goals.map((g) => `- ${g.says}`) : ["- none stated"]),
    "",
    "## The words spoken in this stretch",
    input.transcript.trim(),
    "",
    "## The finalists",
    ...input.sheets.map((s) => {
      const d = input.designs?.[s.candidate];
      return `- ${s.candidate}: ${s.image}${d ? `\n  now: ${SPACE_FIELDS.map((f) => `${f} ${JSON.stringify(d[f].value)}`).join(", ")}` : ""}`;
    }),
    "",
    `Style keys a fix may name${input.moments ? ` (key@N for one moment, N from 0 to ${input.moments - 1})` : ""}: ${(input.styleKeys ?? styleKeys()).join(", ")}`,
    "",
    `Report every seat on every finalist: ${seats.length} seats x ${input.sheets.length} finalists = ${seats.length * input.sheets.length} entries, with "who" copied from the seat list.`,
  ];
  if (repair) lines.push("", "## Your previous answer could not be used", JSON.stringify(repair.previous), "", "Problems; answer again with all of them fixed:", ...repair.problems.map((p) => `- ${p}`));
  return { role: "viewer", id: `viewer.${input.sheets.map((s) => s.candidate).join("-")}${repair ? `.r${repair.round}` : ""}`, system: prompt("viewer"), request: lines.join("\n"), schema: VIEWER_SCHEMA as unknown as Record<string, unknown>, images: input.sheets.map((s) => s.image) };
}

let shapes: Record<string, unknown> | undefined;
/** Every style key with a value of its shape (keys and shapes are the same for every theme and viewing). */
function styleShapes(): Record<string, unknown> {
  shapes ??= Object.fromEntries(Object.entries(styleValues(themeFrom("flat"), viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "any", frameWidthMm: 65, distanceMm: 380, watch: "any", why: "only keys and shapes are read" }))).map(([k, v]) => [k, v.value]));
  return shapes;
}
const styleKeys = () => Object.keys(styleShapes());

/** Problems with a panel's answer: missing seats or finalists, unknown candidates and fields, values out of range. */
export function checkViewer(input: ViewerInput, a: ViewerAnswer): string[] {
  const out: string[] = [];
  const seats = seatsOf(input);
  const cands = input.sheets.map((s) => s.candidate);
  const got = new Set<string>();
  (a?.seats ?? []).forEach((s, i) => {
    const at = `seats[${i}]`;
    const seat = seats.find((x) => x.who.toLowerCase() === s.who?.toLowerCase());
    if (!seat) return void out.push(`${at}: "${s.who}" is not a seat name; copy one exactly: ${seats.map((x) => JSON.stringify(x.who)).join(", ")}`);
    if (!cands.includes(s.candidate)) return void out.push(`${at}: "${s.candidate}" is not a finalist (${cands.join(", ")})`);
    const key = `${seat.who}|${s.candidate}`;
    if (got.has(key)) out.push(`${at}: ${seat.who} on ${s.candidate} is given twice`);
    got.add(key);
    if (!s.saw?.trim() || !s.remembers?.trim()) out.push(`${at}: saw and remembers need plain words`);
  });
  const missing = seats.flatMap((s) => cands.filter((c) => !got.has(`${s.who}|${c}`)).map((c) => `${s.who} on ${c}`));
  if (missing.length) out.push(`seats: missing ${missing.join("; ")}`);
  if (!cands.includes(a?.pick)) out.push(`pick: "${a?.pick}" is not a finalist (${cands.join(", ")})`);
  const keys = new Set(input.styleKeys ?? styleKeys());
  (a?.fixes ?? []).forEach((f, i) => {
    const at = `fixes[${i}]`;
    if (!cands.includes(f.candidate)) out.push(`${at}: "${f.candidate}" is not a finalist`);
    if (!f.why?.trim()) out.push(`${at}: why is needed`);
    if (typeof f.field !== "string") return void out.push(`${at}: field should be a string`);
    if ((SPACE_FIELDS as readonly string[]).includes(f.field)) {
      const p = fieldValueProblem(f.field, f.value);
      if (p) out.push(`${at}: ${f.field} ${JSON.stringify(f.value)}: ${p}`);
      return;
    }
    const [base, n] = f.field.split("@");
    if (!keys.has(base!)) return void out.push(`${at}: "${f.field}" is neither a search field (${SPACE_FIELDS.join(", ")}) nor a style key`);
    const shape = (x: unknown) => (Array.isArray(x) ? `list of ${x.length}` : typeof x);
    const was = styleShapes()[base!];
    if (was !== undefined && shape(was) !== shape(f.value)) out.push(`${at}: ${base} is a ${shape(was)} (such as ${JSON.stringify(was)}), not a ${shape(f.value)}`);
    if (n !== undefined) {
      const k = Number(n);
      if (input.moments === undefined || !Number.isInteger(k) || k < 0 || k >= input.moments) out.push(`${at}: "${f.field}": moment ${n} does not exist${input.moments !== undefined ? ` (0 to ${input.moments - 1})` : ""}`);
    }
  });
  return out;
}
