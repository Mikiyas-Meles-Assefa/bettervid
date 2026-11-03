// Asking an agent until its answer can be used: the task goes out, the answer is checked, and a task with the problems
// goes out again (its repair round), until the answer is clean or the repair rounds run out. Nothing lesser stands in
// for an answer: a task still wrong after its repairs is reported as failed, with its problems, for the caller to show.
// Through a file Reasoner every round is resumable: an unanswered task is pending and a rerun replays the answered ones.
import type { AgentTask, Reasoner } from "../types.ts";

export type Repair = { previous: unknown; problems: string[]; round: number };

export type Settled<A> =
  | { status: "answered"; value: A; id: string; asked: number; repaired: string[] }
  | { status: "pending"; file: string; id: string; asked: number }
  | { status: "failed"; id: string; problems: string[]; asked: number };

/** Asks `make()` and checks its answer; on problems asks `make(repair)` with them, up to `repairs` times. */
export async function settle<A>(reasoner: Reasoner, make: (repair?: Repair) => AgentTask, check: ((a: A) => string[]) | undefined, repairs: number): Promise<Settled<A>> {
  let repair: Repair | undefined;
  const repaired: string[] = [];
  for (let round = 0; ; round++) {
    const task = make(repair);
    const a = await reasoner.ask<A>(task);
    if (a.status === "pending") return { status: "pending", file: a.file, id: task.id, asked: round + 1 };
    const problems = check ? check(a.value) : [];
    if (!problems.length) return { status: "answered", value: a.value, id: task.id, asked: round + 1, repaired };
    if (round >= repairs) return { status: "failed", id: task.id, problems, asked: round + 1 };
    repaired.push(`${task.id}: ${problems.length} problem${problems.length > 1 ? "s" : ""} (${problems.slice(0, 2).join("; ")})`);
    repair = { previous: a.value, problems, round: round + 1 };
  }
}
