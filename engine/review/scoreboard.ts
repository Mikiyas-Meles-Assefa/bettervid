// Benchmark runner and scoreboard. A version's results are one JSON file, written after every request so a stopped run
// resumes. A request that did not produce a video counts as not run, never as a score.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Kit, Request } from "./benchmark.ts";
import type { Cut, Report, Scores } from "./types.ts";

export type Entry = { id: string; kit: Kit; scores?: Scores; usd?: number; failed?: string };
export type Results = { version: string; entries: Entry[] };

const file = (dir: string, version: string) => join(dir, `${version}.json`);

export function loadResults(dir: string, version: string): Results {
  const f = file(dir, version);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { version, entries: [] };
}

export function listVersions(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
}

export type RunOptions = {
  version: string;
  dir: string;
  requests: Request[];
  make: (r: Request) => Promise<Cut | null>; // makes or finds the video; null means none is available
  review: (cut: Cut, r: Request) => Promise<Report>;
  stopped?: () => string | null; // a reason to stop, such as a spending cap
};

export async function runBenchmark(o: RunOptions): Promise<Results> {
  mkdirSync(o.dir, { recursive: true });
  const results = loadResults(o.dir, o.version);
  const done = new Set(results.entries.filter((e) => e.scores).map((e) => e.id));
  for (const r of o.requests) {
    if (done.has(r.id)) continue;
    const stop = o.stopped?.();
    if (stop) {
      console.log(`stopped: ${stop}`);
      break;
    }
    results.entries = results.entries.filter((e) => e.id !== r.id);
    try {
      const cut = await o.make(r);
      if (!cut) continue;
      const report = await o.review(cut, r);
      results.entries.push({ id: r.id, kit: r.kit, scores: report.scores, usd: report.usd });
    } catch (e: any) {
      results.entries.push({ id: r.id, kit: r.kit, failed: String(e.message).slice(0, 300) });
    }
    writeFileSync(file(o.dir, o.version), JSON.stringify(results, null, 1));
  }
  return results;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export type Row = { version: string; run: number; failed: number; overall: number; soundOff: number; learned: number; fit: number; held: number; beatsAudio: number; truthErrors: number; worst: number; usd: number };

export function summarize(r: Results): Row {
  const ok = r.entries.flatMap((e) => (e.scores ? [e.scores] : []));
  const compared = ok.filter((s) => s.audioAlone !== null);
  return {
    version: r.version,
    run: ok.length,
    failed: r.entries.length - ok.length,
    overall: mean(ok.map((s) => s.overall)),
    soundOff: mean(ok.map((s) => s.soundOff)),
    learned: mean(ok.map((s) => s.learned)),
    fit: mean(ok.map((s) => s.fit)),
    held: mean(ok.map((s) => s.held)),
    beatsAudio: compared.length ? compared.filter((s) => s.learned > s.audioAlone!).length / compared.length : 0,
    truthErrors: ok.reduce((a, s) => a + s.truthErrors, 0),
    worst: ok.reduce((a, s) => a + s.worst, 0),
    usd: r.entries.reduce((a, e) => a + (e.usd ?? 0), 0),
  };
}

// Versions are only compared on requests both finished, so a version cannot look better by skipping the hard ones.
// A change below `noise` is reported as unchanged; S13 measured how far repeat runs of one video drift.
export function compare(a: Results, b: Results, noise = 0.08) {
  const before = new Map(a.entries.flatMap((e) => (e.scores ? [[e.id, e.scores] as const] : [])));
  const pairs = b.entries.flatMap((e) => (e.scores && before.has(e.id) ? [{ id: e.id, was: before.get(e.id)!, now: e.scores }] : []));
  const delta = pairs.map((p) => ({ id: p.id, change: p.now.overall - p.was.overall, truth: p.now.truthErrors - p.was.truthErrors }));
  return {
    shared: pairs.length,
    change: mean(delta.map((d) => d.change)),
    better: delta.filter((d) => d.change > noise).map((d) => d.id),
    worse: delta.filter((d) => d.change < -noise || d.truth > 0).map((d) => d.id),
    onlyBefore: [...before.keys()].filter((id) => !pairs.some((p) => p.id === id)),
  };
}

export function table(rows: Row[]): string {
  const head = "| Version | Run | Failed | Overall | Sound off | Learned | Fit | Held | Beats audio | Truth errors | Severe tickets | Cost |\n|---|---|---|---|---|---|---|---|---|---|---|---|";
  const pct = (x: number) => x.toFixed(2);
  const line = (r: Row) => `| ${r.version} | ${r.run} | ${r.failed} | ${pct(r.overall)} | ${pct(r.soundOff)} | ${pct(r.learned)} | ${pct(r.fit)} | ${pct(r.held)} | ${Math.round(r.beatsAudio * 100)}% | ${r.truthErrors} | ${r.worst} | $${r.usd.toFixed(2)} |`;
  return [head, ...rows.map(line)].join("\n");
}
