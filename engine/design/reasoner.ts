// A Reasoner that answers through files, for development: every task is written to <dir>/ask/<task id>.md (the system
// prompt, the request, the answer's JSON schema and the pictures to look at), and an agent answers it by writing
// <dir>/answer/<task id>.json. Until the answer exists the task is pending, so a caller stops and runs again later; a
// task already answered is returned at once, so a rerun resumes where it stopped. Any role can use it (reader,
// director, designer, viewer).
//
// An answer that is not JSON or does not match the schema is not used and not replaced by anything lesser: it is moved
// to <task id>.bad.json and the task is written again with what was wrong, so the agent repairs it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentTask, Answer, Reasoner } from "./types.ts";

type Schema = Record<string, unknown>;

/** Problems of a value against a JSON schema, loosely: types, required keys, enums, items and nested properties. */
export function validate(value: unknown, schema: Schema | undefined, at = "answer"): string[] {
  if (!schema) return [];
  const out: string[] = [];
  const types = ([] as unknown[]).concat(schema.type ?? []) as string[];
  const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v);
  if (types.length) {
    const t = typeOf(value);
    const fits = types.some((x) => x === t || (x === "number" && t === "integer"));
    if (!fits) return [`${at} should be ${types.join(" or ")}, not ${t}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) out.push(`${at} should be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((s) => !validate(value, s as Schema, at).length)) out.push(`${at} matches none of the allowed shapes`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) out.push(`${at} needs at least ${schema.minItems} items`);
    if (schema.items && typeof schema.items === "object") value.forEach((v, i) => out.push(...validate(v, schema.items as Schema, `${at}[${i}]`)));
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (!(k in obj)) out.push(`${at}.${k} is missing`);
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) out.push(...validate(v, props[k], `${at}.${k}`));
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") out.push(...validate(v, schema.additionalProperties as Schema, `${at}.${k}`));
    }
  }
  return out;
}

/** The answer text as JSON: a fenced block or the first object or list in it. */
export function parseAnswer(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = (fenced ? fenced[1]! : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    if (start < 0) throw new Error("no JSON in the answer");
    return JSON.parse(body.slice(start, Math.max(body.lastIndexOf("}"), body.lastIndexOf("]")) + 1));
  }
}

const safe = (id: string) => id.replace(/[^\w.-]+/g, "_");

/** The task as a file an agent reads. */
export function taskText(task: AgentTask, answerFile: string, problems: string[] = []): string {
  const parts = [`# Task ${task.id} (${task.role})`, "", "## System", "", task.system.trim(), "", "## Request", "", task.request.trim()];
  if (task.images?.length) parts.push("", "## Pictures to look at (open each one)", "", ...task.images.map((f) => `- ${isAbsolute(f) ? f : resolve(f)}`));
  if (task.schema) parts.push("", "## Answer schema", "", "Answer with one JSON value matching this schema, and nothing else:", "", "```json", JSON.stringify(task.schema, null, 1), "```");
  if (problems.length) parts.push("", "## Your last answer could not be used", "", ...problems.map((p) => `- ${p}`), "", "Write a corrected answer.");
  parts.push("", `Write the answer to ${answerFile}`, "");
  return parts.join("\n");
}

export function fileReasoner(dir: string): Reasoner & { askFile(id: string): string; answerFile(id: string): string } {
  const askFile = (id: string) => join(dir, "ask", `${safe(id)}.md`);
  const answerFile = (id: string) => join(dir, "answer", `${safe(id)}.json`);
  return {
    askFile,
    answerFile,
    async ask<T>(task: AgentTask): Promise<Answer<T>> {
      mkdirSync(join(dir, "ask"), { recursive: true });
      mkdirSync(join(dir, "answer"), { recursive: true });
      const file = answerFile(task.id);
      // The task's fingerprint, kept beside its ask: an answer written for an earlier version of a task (its request or
      // schema changed since) is set aside as stale and the task asked again.
      const print = createHash("sha1").update(JSON.stringify(task)).digest("hex");
      const printFile = askFile(task.id).replace(/\.md$/, ".hash");
      const asked = existsSync(printFile) ? readFileSync(printFile, "utf8") : undefined;
      const write = (problems: string[] = []) => {
        writeFileSync(askFile(task.id), taskText(task, file, problems));
        writeFileSync(printFile, print);
        return { status: "pending" as const, file: askFile(task.id) };
      };
      if (existsSync(file) && asked !== undefined && asked !== print) {
        renameSync(file, file.replace(/\.json$/, ".stale.json"));
        return write();
      }
      if (existsSync(file)) {
        let problems: string[];
        try {
          const value = parseAnswer(readFileSync(file, "utf8"));
          problems = validate(value, task.schema);
          if (!problems.length) return { status: "answered", value: value as T };
        } catch (e) {
          problems = [`the answer is not JSON: ${(e as Error).message}`];
        }
        renameSync(file, file.replace(/\.json$/, ".bad.json"));
        return write(problems);
      }
      if (!existsSync(askFile(task.id)) || asked !== print) return write();
      return { status: "pending", file: askFile(task.id) };
    },
  };
}
