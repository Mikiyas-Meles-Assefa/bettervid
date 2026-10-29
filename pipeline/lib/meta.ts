// Meta API client for the pipeline: Responses calls with retries, structured output, and cost per call.
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { env, sleep } from "./util.ts";

// IPv6 is unreachable from the dev machine and IPv4 to api.meta.ai can take over Node's 250 ms default (spike S10).
setDefaultAutoSelectFamilyAttemptTimeout(2000);

const BASE = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

// USD per token or per call, from research/meta.md (docs/pricing, Oct 29).
export const PRICE = {
  "muse-spark-1.3": { in: 1.25e-6, cached: 0.15e-6, out: 4.25e-6 },
  "muse-spark-1.2": { in: 1.25e-6, cached: 0.15e-6, out: 4.25e-6 },
  "muse-wonder-1.0": { in: 4e-6, cached: 0.2e-6, out: 20e-6 },
  webSearch: 2.5e-3,
  image: 0.01,
  sam: 0.0025,
} as const;

export type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };

export function tokenCost(model: keyof typeof PRICE, u: Usage = {}, searches = 0): number {
  const p = PRICE[model] as { in: number; cached: number; out: number };
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return ((u.input_tokens ?? 0) - cached) * p.in + cached * p.cached + (u.output_tokens ?? 0) * p.out + searches * PRICE.webSearch;
}

// POST with retries: network errors, 429 (Retry-After) and 5xx. Other errors throw with the body.
export async function post(path: string, body: unknown, tries = 5): Promise<any> {
  for (let i = 1; ; i++) {
    let res: Response | undefined;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env("META_API_KEY")}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch (e: any) {
      if (i >= tries) throw e;
      console.error(`  meta ${path}: ${e?.cause?.code ?? e.message}, retry ${i}`);
      await sleep(2000 * i);
      continue;
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if ((res.status === 429 || res.status >= 500) && i < tries) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 3000 * 2 ** (i - 1);
      console.error(`  meta ${path}: ${res.status}, retry ${i} in ${wait} ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`meta ${path} ${res.status}: ${text.slice(0, 600)}`);
  }
}

// With web search on, Spark sends short progress messages before the answer, so take the last message only.
export function outputText(r: any): string {
  const last = (r.output ?? []).filter((o: any) => o.type === "message").at(-1);
  return (last?.content ?? []).map((c: any) => c.text ?? "").join("");
}

type JsonCall = {
  model?: "muse-spark-1.3" | "muse-wonder-1.0";
  effort?: "minimal" | "low" | "medium" | "high";
  system: string;
  user: string | unknown[];
  schema: object;
  schemaName: string;
  webSearch?: boolean;
  maxOutput?: number;
};

// One Responses call that must return JSON matching the schema. Returns the parsed value and its cost.
export async function json<T>(c: JsonCall): Promise<{ value: T; usd: number; searches: number; raw: any }> {
  const model = c.model ?? "muse-spark-1.3";
  const r = await post("/responses", {
    model,
    store: false,
    reasoning: { effort: c.effort ?? "low" },
    max_output_tokens: c.maxOutput ?? 32000,
    instructions: c.system,
    input: [{ role: "user", content: typeof c.user === "string" ? [{ type: "input_text", text: c.user }] : c.user }],
    text: { format: { type: "json_schema", name: c.schemaName, schema: c.schema, strict: true } },
    ...(c.webSearch ? { tools: [{ type: "web_search" }] } : {}),
  });
  const searches = (r.output ?? []).filter((o: any) => o.type === "web_search_call").length;
  const usd = tokenCost(model, r.usage, searches);
  if (r.status !== "completed") throw Object.assign(new Error(`meta ${model} ended ${r.status}: ${JSON.stringify(r.incomplete_details)}`), { usd });
  const text = outputText(r);
  try {
    return { value: JSON.parse(text) as T, usd, searches, raw: r };
  } catch {
    throw Object.assign(new Error(`meta ${model} returned non-JSON: ${text.slice(0, 300)}`), { usd });
  }
}

type TextCall = Omit<JsonCall, "schema" | "schemaName" | "webSearch">;

// One Responses call that returns free text. Used for writing prose: a JSON form makes the model write in boxes.
export async function text(c: TextCall): Promise<{ value: string; usd: number; raw: any }> {
  const model = c.model ?? "muse-spark-1.3";
  const r = await post("/responses", {
    model,
    store: false,
    reasoning: { effort: c.effort ?? "low" },
    max_output_tokens: c.maxOutput ?? 32000,
    instructions: c.system,
    input: [{ role: "user", content: typeof c.user === "string" ? [{ type: "input_text", text: c.user }] : c.user }],
  });
  const usd = tokenCost(model, r.usage);
  if (r.status !== "completed") throw Object.assign(new Error(`meta ${model} ended ${r.status}: ${JSON.stringify(r.incomplete_details)}`), { usd });
  return { value: outputText(r).trim(), usd, raw: r };
}
