export type Task = { name: string; needs: string[]; run: () => Promise<void> };

// Start ready tasks together. Once one fails, drain work already running before the caller saves or exits.
export async function schedule(tasks: Task[], parallel = true): Promise<void> {
  const names = new Set(tasks.map((t) => t.name));
  if (names.size !== tasks.length) throw new Error("duplicate scheduler task");
  for (const t of tasks) for (const dep of t.needs) if (!names.has(dep)) throw new Error(`${t.name}: missing dependency ${dep}`);
  const pending = new Set(tasks);
  const done = new Set<string>();
  const running = new Map<string, Promise<void>>();
  let failed = false;
  let error: unknown;
  while (pending.size || running.size) {
    if (!failed) for (const task of pending) {
      if (!task.needs.every((n) => done.has(n))) continue;
      pending.delete(task);
      const work = Promise.resolve().then(task.run).then(() => { done.add(task.name); }, (e) => { failed = true; error ??= e; }).finally(() => { running.delete(task.name); });
      running.set(task.name, work);
      if (!parallel) break;
    }
    if (!running.size) {
      if (failed) throw error;
      if (pending.size) throw new Error("scheduler dependency cycle");
      return;
    }
    await Promise.race(running.values());
  }
  if (failed) throw error;
}

export const dependencies: Record<string, string[]> = {
  material: [], plan: ["material"], research: ["plan"], writer: ["research"], direction: ["writer"],
  voice: ["writer", "direction"], director: ["voice"], board: ["voice"], stage: ["voice"],
  assets: ["director"], annotate: ["assets"], scene: ["annotate", "voice"],
  timeline: ["scene", "board", "stage", "annotate"], mix: ["timeline"], render: ["timeline"], mux: ["mix", "render"], critic: ["mux"],
};

// A worker takes the next item as soon as it finishes; results stay in input order.
export async function parallelMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, limit)) }, async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]!, i); }
      catch (e) { failed = true; throw e; }
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return out;
}
