// How reviewers call Meta models. Every reviewer takes an `Ask`, so tests can run the whole loop with no network and no cost.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { outputText, post, tokenCost } from "../../pipeline/lib/meta.ts";

export type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string } | { type: "input_video"; video_url: string };
export type AskCall = {
  model?: "muse-spark-1.3" | "muse-spark-1.2"; // 1.2 for anything that must hear sound
  effort?: "minimal" | "low" | "medium" | "high";
  system: string;
  user: string | Part[];
  schema: object;
  name: string; // also used by test fakes to tell calls apart
};
export type Ask = <T>(c: AskCall) => Promise<T>;

export const text = (t: string): Part => ({ type: "input_text", text: t });

export function ledgerPath() {
  return join(process.env.PROJECTS_DIR ?? "projects", "spend.jsonl");
}

export type Meter = { usd: number; calls: number };

// A real client. It stops at `cap` dollars, and writes each call to the shared ledger so spending is never hidden.
export function metaAsk(o: { project: string; cap: number; meter?: Meter; ledger?: string }): { ask: Ask; meter: Meter } {
  const meter = o.meter ?? { usd: 0, calls: 0 };
  const ledger = o.ledger ?? ledgerPath();
  mkdirSync(dirname(ledger), { recursive: true });
  const charge = (usd: number, detail: string) => {
    meter.usd += usd;
    meter.calls++;
    appendFileSync(ledger, JSON.stringify({ project: o.project, stage: "review", usd: +usd.toFixed(5), detail, at: new Date().toISOString() }) + "\n");
  };
  const ask: Ask = async <T>(c: AskCall) => {
    if (meter.usd >= o.cap) throw new Error(`review cap: spent $${meter.usd.toFixed(3)} of $${o.cap}`);
    const model = c.model ?? "muse-spark-1.3";
    const input = [{ role: "user", content: typeof c.user === "string" ? [text(c.user)] : c.user }];
    const body = {
      model,
      store: false,
      reasoning: { effort: c.effort ?? "low" },
      max_output_tokens: 16000,
      instructions: c.system,
      input,
      text: { format: { type: "json_schema", name: c.name, schema: c.schema, strict: true } },
    };
    // A cut-off or malformed answer is asked again rather than papered over.
    for (let attempt = 1; ; attempt++) {
      const r = await post("/responses", body);
      charge(tokenCost(model, r.usage), c.name);
      try {
        if (r.status !== "completed") throw new Error(`ended ${r.status}`);
        return JSON.parse(outputText(r)) as T;
      } catch (e: any) {
        if (attempt >= 3) throw new Error(`review ${c.name}: ${e.message}`);
      }
    }
  };
  return { ask, meter };
}
