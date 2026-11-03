import { sleep } from "./util.ts";

// One rolling request window per client, including retries.
export function requestGate(limit = 150, windowMs = 60_000, clock = { now: Date.now, sleep }) {
  const starts: number[] = [];
  let gate = Promise.resolve();
  return async () => {
    const turn = gate.then(async () => {
      while (starts.length && starts[0]! <= clock.now() - windowMs) starts.shift();
      while (starts.length >= limit) {
        await clock.sleep(Math.max(1, starts[0]! + windowMs - clock.now()));
        while (starts.length && starts[0]! <= clock.now() - windowMs) starts.shift();
      }
      starts.push(clock.now());
    });
    gate = turn.catch(() => {});
    await turn;
  };
}
