import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Timing = { kind: "stage" | "model"; name: string; start: string; ms: number; status: "done" | "failed" | "cached"; model?: string; effort?: string | null; inputTokens?: number | null; outputTokens?: number | null };
type Run = { id: string; folder: string; start: number; records: Timing[]; status: string };
const context = new AsyncLocalStorage<{ run?: Run; stage?: string }>();

function flush(run: Run) {
  writeFileSync(join(run.folder, "timings.json"), JSON.stringify({ run: run.id, start: new Date(run.start).toISOString(), ms: Date.now() - run.start, status: run.status, records: run.records }, null, 2));
}
export function record(row: Timing) {
  const run = context.getStore()?.run;
  if (!run) return;
  run.records.push(row);
  appendFileSync(join(run.folder, "run.log"), `[timing] ${JSON.stringify({ run: run.id, ...row })}\n`);
  flush(run);
}
export const currentStage = () => context.getStore()?.stage;
export const effortSetting = (stage = currentStage()) => stage ? process.env[`PIPELINE_EFFORT_${stage.toUpperCase()}`] : undefined;
export function effort(fallback: string): string {
  const value = effortSetting() ?? fallback;
  if (!["minimal", "low", "medium", "high"].includes(value)) throw new Error(`invalid reasoning effort: ${value}`);
  return value;
}
export function inStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  return context.run({ ...context.getStore(), stage }, fn);
}
export async function timedRun<T>(folder: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(folder, { recursive: true });
  const start = Date.now();
  const run: Run = { id: new Date(start).toISOString(), folder, start, records: [], status: "running" };
  return context.run({ run }, async () => {
    flush(run);
    try { const result = await fn(); run.status = "done"; return result; }
    catch (e) { run.status = "failed"; throw e; }
    finally {
      flush(run);
      appendFileSync(join(folder, "run.log"), `[run] ${JSON.stringify({ run: run.id, ms: Date.now() - start, status: run.status })}\n`);
    }
  });
}

// ElevenLabs reports credits rather than tokens. Include the complete response download in its wall time.
export async function modelResponse(model: string, url: string, options: RequestInit): Promise<{ response: Response; body: string }> {
  const start = Date.now();
  let ok = false;
  try {
    const response = await fetch(url, options);
    const body = await response.text();
    ok = response.ok;
    return { response, body };
  } finally {
    record({ kind: "model", name: currentStage() ?? "voice", start: new Date(start).toISOString(), ms: Date.now() - start,
      status: ok ? "done" : "failed", model: `elevenlabs/${model}`, effort: null, inputTokens: null, outputTokens: null });
  }
}
