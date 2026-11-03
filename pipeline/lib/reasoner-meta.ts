// The production Reasoner (engine/design/types.ts): every agent task answered by a Meta model. It calls the Responses
// API through `post` itself rather than `json()`, because `json()` always asks for strict structured output, and strict
// mode only takes schemas whose objects are closed with every property required. A task whose schema is like that is
// asked in strict mode; any other schema goes into the request, and the answer is read from the text.
//
// Every answer is checked against its schema. One that does not match goes back to the model with what was wrong, for a
// set number of repairs; after the last one the task fails loudly. Nothing lesser stands in for an answer.
import { readFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { parseAnswer, validate } from "../../engine/design/reasoner.ts";
import type { AgentRole, AgentTask, Answer, Reasoner } from "../../engine/design/types.ts";
import { outputText, post as metaPost, tokenCost } from "./meta.ts";

type Schema = Record<string, unknown>;
type Model = "muse-spark-1.3" | "muse-wonder-1.0";
type Effort = "minimal" | "low" | "medium" | "high";

export type MetaReasonerOptions = {
  model?: Model;
  /** Reasoning effort per role; a role not named uses `medium`. */
  effort?: Partial<Record<AgentRole, Effort>>;
  /** A spending limit for every task this reasoner answers. Asking past it throws before the call is made. */
  budget?: { usd?: number; calls?: number };
  /** Called with the cost of every call, so the stage records what it spent (`charge(p, "scene", ...)`). */
  charge?: (usd: number, detail: string) => void;
  /** Called before every call with what this reasoner has spent; throw to stop (a project-wide budget). */
  checkBudget?: (spent: { usd: number; calls: number }) => void;
  /** Attempts per call when the network fails or the model stops early (on top of `post`'s own retries). */
  tries?: number;
  /** Rounds in which an answer that does not match its schema goes back with its problems. */
  repairs?: number;
  maxOutput?: number;
  /** For tests: the Responses call and how a picture becomes a URL the model can open. */
  post?: (path: string, body: unknown) => Promise<any>;
  image?: (file: string) => string;
};

export type LedgerRow = { id: string; role: AgentRole; calls: number; usd: number; repairs: number; ok: boolean };
export type Ledger = { usd: number; calls: number; tasks: LedgerRow[] };

/** Whether strict structured output takes this schema: every object closed, every property required, all the way down. */
export function strictable(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;
  const s = schema as Schema;
  const types = ([] as unknown[]).concat(s.type ?? []);
  if (types.includes("object") || s.properties) {
    if (s.additionalProperties !== false) return false;
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const req = new Set((s.required as string[] | undefined) ?? []);
    if (Object.keys(props).some((k) => !req.has(k))) return false;
    if (!Object.values(props).every(strictable)) return false;
  }
  if (s.items && !strictable(s.items)) return false;
  for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[k]) && !(s[k] as unknown[]).every(strictable)) return false;
  return true;
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** A picture file as a data URL. A URL is passed through as it is. */
export function imageUrl(file: string): string {
  if (/^(data:|https?:)/.test(file)) return file;
  const path = isAbsolute(file) ? file : resolve(file);
  return `data:${MIME[extname(path).toLowerCase()] ?? "image/png"};base64,${readFileSync(path).toString("base64")}`;
}

const schemaText = (schema: Schema) => `Answer with one JSON value matching this schema, and nothing else:\n\n\`\`\`json\n${JSON.stringify(schema, null, 1)}\n\`\`\``;

export function metaReasoner(opts: MetaReasonerOptions = {}): Reasoner & { ledger: Ledger } {
  const model = opts.model ?? "muse-spark-1.3";
  const call = opts.post ?? ((path: string, body: unknown) => metaPost(path, body));
  const image = opts.image ?? imageUrl;
  const tries = Math.max(1, opts.tries ?? 2);
  const repairs = Math.max(0, opts.repairs ?? 2);
  const ledger: Ledger = { usd: 0, calls: 0, tasks: [] };

  const guard = (task: AgentTask) => {
    const b = opts.budget ?? {};
    if (b.calls !== undefined && ledger.calls >= b.calls) throw new Error(`reasoner budget: ${ledger.calls} calls of ${b.calls} spent before ${task.id}`);
    if (b.usd !== undefined && ledger.usd >= b.usd) throw new Error(`reasoner budget: $${ledger.usd.toFixed(3)} of $${b.usd} spent before ${task.id}`);
    opts.checkBudget?.({ usd: ledger.usd, calls: ledger.calls });
  };

  // One call, with the request as given; network failures and early stops are tried again.
  const once = async (task: AgentTask, row: LedgerRow, request: string, strict: boolean): Promise<string> => {
    let last: unknown;
    for (let t = 1; t <= tries; t++) {
      guard(task);
      const content: unknown[] = [{ type: "input_text", text: request }, ...(task.images ?? []).map((f) => ({ type: "input_image", image_url: image(f) }))];
      const body = {
        model,
        store: false,
        reasoning: { effort: opts.effort?.[task.role] ?? "medium" },
        max_output_tokens: opts.maxOutput ?? 32000,
        instructions: task.system,
        input: [{ role: "user", content }],
        ...(strict && task.schema ? { text: { format: { type: "json_schema", name: task.role, schema: task.schema, strict: true } } } : {}),
      };
      ledger.calls += 1;
      row.calls += 1;
      try {
        const r = await call("/responses", body);
        const usd = tokenCost(model, r?.usage);
        ledger.usd += usd;
        row.usd += usd;
        if (usd) opts.charge?.(usd, `${task.role} ${task.id}`);
        if (r?.status && r.status !== "completed") throw new Error(`meta ${model} ended ${r.status}: ${JSON.stringify(r.incomplete_details)}`);
        return outputText(r);
      } catch (e) {
        last = e;
        if ((e as Error).message?.startsWith("reasoner budget")) throw e;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };

  return {
    ledger,
    async ask<T>(task: AgentTask): Promise<Answer<T>> {
      const row: LedgerRow = { id: task.id, role: task.role, calls: 0, usd: 0, repairs: 0, ok: false };
      ledger.tasks.push(row);
      const strict = !!task.schema && strictable(task.schema);
      const base = task.schema && !strict ? `${task.request.trim()}\n\n${schemaText(task.schema)}` : task.request;
      let request = base;
      for (let round = 0; ; round++) {
        const text = await once(task, row, request, strict);
        if (!task.schema) {
          row.ok = true;
          return { status: "answered", value: text.trim() as T };
        }
        let problems: string[];
        let value: unknown;
        try {
          value = strict ? JSON.parse(text) : parseAnswer(text);
          problems = validate(value, task.schema);
        } catch (e) {
          problems = [`the answer is not JSON: ${(e as Error).message}`];
        }
        if (!problems.length) {
          row.ok = true;
          return { status: "answered", value: value as T };
        }
        if (round >= repairs) throw new Error(`${task.id}: the answer still does not match its schema after ${repairs} repair${repairs === 1 ? "" : "s"}: ${problems.slice(0, 5).join("; ")}`);
        row.repairs += 1;
        request = `${base}\n\nYour last answer could not be used:\n${problems.slice(0, 25).map((p) => `- ${p}`).join("\n")}\n\nYour last answer was:\n${text.slice(0, 20000)}\n\nWrite a corrected answer.`;
      }
    },
  };
}
