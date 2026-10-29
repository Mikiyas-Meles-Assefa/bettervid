import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { env, sleep } from "./util.ts";

export const META_BASE = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

export type MetaResult = { status: number; ms: number; headers: Record<string, string>; json: any; text: string };

// api.meta.ai sometimes times out at TCP connect (seen 3 times on Oct 29), so retry network errors.
async function fetchRetry(url: string, init: RequestInit, tries = 4): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e: any) {
      if (i >= tries) throw e;
      console.error(`fetch ${url} failed (${e?.cause?.code ?? e.message}), retry ${i}`);
      await sleep(2000 * i);
    }
  }
}

// Raw fetch on purpose: spikes need the rate-limit headers the SDK hides.
export async function metaPost(path: string, body: unknown): Promise<MetaResult> {
  const t0 = Date.now();
  const res = await fetchRetry(`${META_BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("META_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return finish(res, t0);
}

// Files API upload (purpose=user_data), for video inputs too big or awkward to inline.
export async function metaUpload(path: string, mime: string): Promise<MetaResult> {
  const t0 = Date.now();
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([readFileSync(path)], { type: mime }), basename(path));
  const res = await fetchRetry(`${META_BASE}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("META_API_KEY")}` },
    body: form,
  });
  return finish(res, t0);
}

// /images/edits takes multipart: fields (objects as JSON strings) plus 1 to 10 reference images as image[0], image[1], ...
export async function metaEdit(fields: Record<string, unknown>, images: string[]): Promise<MetaResult> {
  const t0 = Date.now();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  images.forEach((p, i) => form.append(`image[${i}]`, new Blob([readFileSync(p)], { type: "image/png" }), basename(p)));
  const res = await fetchRetry(`${META_BASE}/images/edits`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("META_API_KEY")}` },
    body: form,
  });
  return finish(res, t0);
}

async function finish(res: Response, t0: number): Promise<MetaResult> {
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms: Date.now() - t0, headers: Object.fromEntries(res.headers), json, text };
}

export function rateHeaders(h: Record<string, string>) {
  return Object.fromEntries(Object.entries(h).filter(([k]) => /ratelimit|retry-after|request-id|cost|usage/i.test(k)));
}
