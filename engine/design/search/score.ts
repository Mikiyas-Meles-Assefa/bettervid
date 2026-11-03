// Scoring: how far an instrument's reading is from a goal an agent wrote. 0 is met, 1 is far, and the miss grows
// smoothly in between, measured against the goal's own range (never a constant of the engine):
//   min and max   the distance outside the band over the band's width
//   min or max    the distance past the bound over the bound's own size (a goal "at least 0.3" missed by 0.1 is a third off)
//   near          the distance from the target over half the band (when min and max are given) or the target's size
// A reading the goal names that no instrument reported is a full miss, with the reason in the notes: a goal that
// cannot be measured is not met. A value the instrument says does not apply in this window (Reading.outside: a silence
// in another moment) is not scored at all: the goal holds where its measure applies, and counts nowhere else.
import type { Goal, GoalScore, Reading } from "../types.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The size of a bound, for a relative miss: its magnitude, or 1 for a bound at 0 (a count that should stay at 0). */
const sizeOf = (x: number) => (Math.abs(x) > 1e-9 ? Math.abs(x) : 1);

/** The miss of one value against a want, 0 met to 1 far. */
export function missOf(v: number, want: Goal["want"]): number {
  if (!Number.isFinite(v)) return 1;
  const { min, max, near } = want;
  const band = min !== undefined && max !== undefined && max > min ? max - min : undefined;
  let miss = 0;
  if (min !== undefined && v < min) miss = Math.max(miss, (min - v) / (band ?? sizeOf(min)));
  if (max !== undefined && v > max) miss = Math.max(miss, (v - max) / (band ?? sizeOf(max)));
  if (near !== undefined) miss = Math.max(miss, Math.abs(v - near) / (band ? band / 2 : sizeOf(near)));
  return clamp01(miss);
}

/** The reading a goal names: the instrument and the value. Settings are matched by the caller (evaluate.ts). */
export function valueFor(goal: Pick<Goal, "instrument" | "value">, readings: Reading[]): number | undefined {
  for (const r of readings) if (r.instrument === goal.instrument && goal.value in r.values) return r.values[goal.value];
  return undefined;
}

/** Whether a reading says the goal's value does not apply in its window. */
export const outsideOf = (goal: Pick<Goal, "instrument" | "value">, readings: Reading[]) => readings.some((r) => r.instrument === goal.instrument && !(goal.value in r.values) && (r.outside ?? []).includes(goal.value));

export function scoreGoal(goal: Goal, readings: Reading[]): GoalScore {
  const value = valueFor(goal, readings);
  if (value === undefined && outsideOf(goal, readings)) return { goal: goal.id, miss: 0, applies: false };
  if (value === undefined) return { goal: goal.id, miss: 1 };
  return { goal: goal.id, value, miss: missOf(value, goal.want) };
}

/**
 * Every goal scored, and the total: the weighted mean miss (0 every goal met, 1 every goal far; lower is better).
 * Goals of weight 0 are reported and do not count.
 */
export function scoreCandidate(goals: Goal[], readings: Reading[]): { scores: GoalScore[]; total: number; unmeasured: string[] } {
  const scores = goals.map((g) => scoreGoal(g, readings));
  let w = 0;
  let sum = 0;
  goals.forEach((g, i) => {
    const gw = scores[i]!.applies === false ? 0 : Math.max(0, g.weight);
    w += gw;
    sum += gw * scores[i]!.miss;
  });
  const unmeasured = goals.filter((_, i) => scores[i]!.value === undefined && scores[i]!.applies !== false).map((g) => `${g.id}: no ${g.instrument} reading "${g.value}"`);
  return { scores, total: w > 0 ? sum / w : 0, unmeasured };
}

/** One line per goal for an agent: the goal, the value and the miss. */
export function scoresText(goals: Goal[], scores: GoalScore[]): string {
  return goals
    .map((g) => {
      const s = scores.find((x) => x.goal === g.id);
      const want = [g.want.min !== undefined ? `>= ${g.want.min}` : "", g.want.max !== undefined ? `<= ${g.want.max}` : "", g.want.near !== undefined ? `near ${g.want.near}` : ""].filter(Boolean).join(", ");
      if (s?.applies === false) return `${g.id} (${g.instrument} ${g.value} ${want}, weight ${g.weight}): does not apply here`;
      return `${g.id} (${g.instrument} ${g.value} ${want}, weight ${g.weight}): ${s?.value === undefined ? "not measured" : s.value} -> miss ${(s?.miss ?? 1).toFixed(2)}`;
    })
    .join("\n");
}
