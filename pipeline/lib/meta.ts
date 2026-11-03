// Meta API client for the pipeline: Responses calls with retries, structured output, and cost per call.
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { env, sleep } from "./util.ts";
import { requestGate } from "./rate-limit.ts";
import { currentStage, effort, record } from "./timing.ts";

// IPv6 is unreachable from the dev machine, and connecting to api.meta.ai over IPv4 sometimes takes 2 to 7 s, longer than
// Node gives each address when it races IPv4 against IPv6. So connect over IPv4 only, with the normal OS timeout.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

const BASE = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

// USD per token or per call, from research/meta.md (docs/pricing, Oct 29).
export const PRICE = {
  "muse-spark-1.3": { in: 1.25e-6, cached: 0.15e-6, out: 4.25e-6 },
  "muse-spark-1.2": { in: 1.25e-6, cached: 0.15e-6, out: 4.25e-6 },
  "muse-spark-1.3-contributor": { in: 0.1e-6, cached: 0.002e-6, out: 0.2e-6 },
  "muse-spark-1.2-contributor": { in: 0.1e-6, cached: 0.002e-6, out: 0.2e-6 },
  "muse-wonder-1.0": { in: 4e-6, cached: 0.2e-6, out: 20e-6 },
  webSearch: 2.5e-3,
  image: 0.01,
  sam: 0.0025,
} as const;

// Spark calls go to the Contributor tier unless META_TIER=standard: about 12 times cheaper, but Meta may train on what is
// sent and it allows 150 requests a minute (429s are retried below). Wonder has no Contributor tier.
export const CONTRIBUTOR = (process.env.META_TIER ?? "contributor") !== "standard";
export const wireModel = (m: string): string => (CONTRIBUTOR && /^muse-spark-1\.[23]$/.test(m) ? `${m}-contributor` : m);

export type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };

export function tokenCost(model: keyof typeof PRICE, u: Usage = {}, searches = 0): number {
  const p = PRICE[wireModel(model) as keyof typeof PRICE] as { in: number; cached: number; out: number };
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return ((u.input_tokens ?? 0) - cached) * p.in + cached * p.cached + (u.output_tokens ?? 0) * p.out + searches * PRICE.webSearch;
}

const withTier = (b: any) => (b && typeof b.model === "string" ? { ...b, model: wireModel(b.model) } : b);

// POST with retries: network errors, 429 (Retry-After) and 5xx. Other errors throw with the body.
async function request(path: string, body: unknown, tries = 5): Promise<any> {
  for (let i = 1; ; i++) {
    let res: Response | undefined;
    let text = "";
    try {
      await rateLimit();
      res = await fetch(`${BASE}${path}`, {
        method: "POST",
        // A FormData body (multipart, as /images/edits needs) sets its own content type.
        headers: { authorization: `Bearer ${env("META_API_KEY")}`, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
        body: body instanceof FormData ? body : JSON.stringify(withTier(body)),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      // Read the body inside the try: on this network a connection can drop mid-response ("terminated", read ETIMEDOUT).
      text = await res.text();
    } catch (e: any) {
      if (i >= tries) throw e;
      console.error(`  meta ${path}: ${e?.cause?.code ?? e.message}, retry ${i}`);
      await sleep(5000 * i);
      continue;
    }
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

const rateLimit = requestGate();

export async function post(path: string, body: unknown, tries = 5): Promise<any> {
  const b = body as any;
  const model = body instanceof FormData ? String(body.get("model") ?? "unknown") : b?.model ?? "unknown";
  const sent = b?.reasoning?.effort ? { ...b, reasoning: { ...b.reasoning, effort: effort(b.reasoning.effort) } } : body;
  const start = Date.now();
  let result: any;
  try {
    result = await request(path, sent, tries);
    return result;
  } finally {
    record({ kind: "model", name: currentStage() ?? path, start: new Date(start).toISOString(), ms: Date.now() - start,
      status: result && (!result.status || result.status === "completed") ? "done" : "failed", model: wireModel(model), effort: (sent as any)?.reasoning?.effort ?? null,
      inputTokens: result?.usage?.input_tokens ?? null, outputTokens: result?.usage?.output_tokens ?? null });
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
