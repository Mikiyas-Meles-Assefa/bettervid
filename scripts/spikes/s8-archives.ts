// S8: do free archives return a usable asset for most proof and example beats? Safe mode only:
// public domain, CC0, CC BY, CC BY-SA. Sources: Wikimedia Commons, Openverse, NASA, the Met.
// Step "search" (free) saves candidates and thumbnails, and on rerun only retries beats with none; step "judge" asks Spark to pick per beat (~$0.004 each).
// Usage: npm run spike scripts/spikes/s8-archives.ts search|judge [maxDollars]  (judge resumes from results.json)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { metaPost } from "../lib/meta.ts";
import { save, sleep } from "../lib/util.ts";

type Beat = { line: string; need: string; query: string };
type Candidate = { source: string; title: string; license: string; credit: string; page: string; thumb: string; file?: string };

const DIR = "media/spikes/s8";
const UA = "bettervid-spike/0.1 (hackathon research; mikiyasmeles77@gmail.com)";
const topics: Record<string, Beat[]> = JSON.parse(readFileSync("scripts/spikes/s8-beats.json", "utf8"));
const PER_SOURCE = 3;
const SAFE = /public domain|^pd|cc0|^cc[ -]by(-sa)?( |$|-\d|\d)|^by(-sa)?$/i;

const get = async (url: string, timeoutMs = 20000) => {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const j: any = await r.json();
  if (j.error) throw new Error(`${j.error.code ?? "error"}: ${j.error.info ?? JSON.stringify(j.error)}`);
  return j;
};
const strip = (html = "") => html.replace(/<[^>]+>/g, "").trim();

async function commons(q: string): Promise<Candidate[]> {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(q)}` +
    `&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=400`;
  // Commons sometimes answers 200 with an error body under parallel load; retry once after a pause.
  const j = await get(u).catch(async (e) => (console.error(`commons retry: ${e.message}`), await sleep(15000), get(u)));
  const pages = Object.values(j.query?.pages ?? {}) as any[];
  return pages
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ ii }) => ii && /image\/(jpeg|png|tiff)/.test(ii.mime))
    .map(({ p, ii }) => ({
      source: "commons", title: p.title.replace(/^File:/, ""), license: ii.extmetadata?.LicenseShortName?.value ?? "unknown",
      credit: strip(ii.extmetadata?.Artist?.value), page: ii.descriptionurl, thumb: ii.thumburl,
    }))
    .filter((c) => SAFE.test(c.license))
    .slice(0, PER_SOURCE);
}

async function openverse(q: string): Promise<Candidate[]> {
  // Openverse was returning 502/504 after ~55 s on Oct 29, so cap the wait.
  const j = await get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=8`, 10000);
  return (j.results ?? [])
    .map((r: any) => ({ source: `openverse/${r.provider}`, title: r.title, license: `${r.license} ${r.license_version ?? ""}`.trim(), credit: r.attribution, page: r.foreign_landing_url, thumb: r.thumbnail }))
    .filter((c: Candidate) => /^(by|by-sa|cc0|pdm)/i.test(c.license))
    .slice(0, PER_SOURCE);
}

async function nasa(q: string): Promise<Candidate[]> {
  const j = await get(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`);
  return (j.collection?.items ?? []).slice(0, PER_SOURCE).map((it: any) => ({
    source: "nasa", title: it.data?.[0]?.title, license: "NASA (US government, credit NASA)", credit: "NASA",
    page: `https://images.nasa.gov/details/${it.data?.[0]?.nasa_id}`, thumb: it.links?.[0]?.href,
  }));
}

async function met(q: string): Promise<Candidate[]> {
  const j = await get(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=${encodeURIComponent(q)}&hasImages=true`);
  const out: Candidate[] = [];
  for (const id of (j.objectIDs ?? []).slice(0, 8)) {
    const o = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null);
    if (o?.isPublicDomain && o.primaryImageSmall) out.push({ source: "met", title: o.title, license: "CC0", credit: `The Met, ${o.artistDisplayName || "unknown"}`, page: o.objectURL, thumb: o.primaryImageSmall });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

// Reruns keep beats that already have candidates and only search the empty ones again.
async function search() {
  const prev: Record<string, any[]> = existsSync(`${DIR}/candidates.json`) ? JSON.parse(readFileSync(`${DIR}/candidates.json`, "utf8")) : {};
  const all: Record<string, any[]> = {};
  for (const [topic, beats] of Object.entries(topics)) {
    all[topic] = [];
    for (const [i, beat] of beats.entries()) {
      if (prev[topic]?.[i]?.candidates?.length) {
        all[topic].push(prev[topic][i]);
        continue;
      }
      const found = await Promise.all([commons, openverse, nasa, met].map((f) => f(beat.query).catch((e) => (console.error(`${f.name} "${beat.query}": ${e.message}`), []))));
      // Interleave sources so the judge sees the top hit of each first.
      const cands: Candidate[] = [];
      for (let k = 0; k < PER_SOURCE; k++) for (const list of found) if (list[k]) cands.push(list[k]);
      for (const [n, c] of cands.entries()) {
        const file = `${DIR}/${topic}/${i}-${n}.jpg`;
        try {
          const r = await fetch(c.thumb, { headers: { "user-agent": UA } });
          if (!r.ok) throw new Error(String(r.status));
          await save(file, new Uint8Array(await r.arrayBuffer()));
          c.file = file;
        } catch (e: any) {
          console.error(`thumb ${c.thumb}: ${e.message}`);
        }
      }
      const kept = cands.filter((c) => c.file);
      all[topic].push({ ...beat, candidates: kept });
      console.log(JSON.stringify({ topic, beat: i, query: beat.query, bySource: found.map((l) => l.length), thumbs: kept.length }));
      await sleep(3500); // Openverse anonymous burst limit is 20 per minute
    }
  }
  writeFileSync(`${DIR}/candidates.json`, JSON.stringify(all, null, 2));
}

async function judge(maxDollars: number) {
  const all = JSON.parse(readFileSync(`${DIR}/candidates.json`, "utf8"));
  let spent = 0;
  // Resume: beats already judged (not cut off by the budget) are kept, so reruns only pay for the rest.
  const results: any[] = existsSync(`${DIR}/results.json`) ? JSON.parse(readFileSync(`${DIR}/results.json`, "utf8")) : [];
  for (const [topic, beats] of Object.entries<any[]>(all)) {
    for (const [i, beat] of beats.entries()) {
      if (results.some((r) => r.topic === topic && r.beat === i)) continue;
      if (spent >= maxDollars) {
        console.log(JSON.stringify({ stopped: "budget", spent }));
        break;
      }
      const cands = beat.candidates.slice(0, 10);
      if (!cands.length) {
        results.push({ topic, beat: i, query: beat.query, usable: false, pick: null, reason: "no candidates" });
        console.log(JSON.stringify(results.at(-1)));
        continue;
      }
      const content = [
        ...cands.flatMap((c: Candidate, k: number) => [
          { type: "input_text", text: `Candidate ${k} (${c.source}): ${c.title}` },
          { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(c.file!).toString("base64")}` },
        ]),
        { type: "input_text", text:
          `You pick real archival images for a documentary-style explainer video. Narration: "${beat.line}" The shot needs: ${beat.need}.\n` +
          "Pick the single best candidate that accurately shows what the shot needs and would look good full screen or as a cutout in a vertical video. " +
          "Be strict: a loosely related or wrong subject is not usable; a different but historically accurate image of the same thing is fine. " +
          'Reply with JSON only: {"pick": <candidate number or null>, "usable": true|false, "reason": "one sentence"}' },
      ];
      const r = await metaPost("/responses", { model: "muse-spark-1.3", store: false, reasoning: { effort: "low" }, max_output_tokens: 8000, input: [{ role: "user", content }] });
      const u = r.json?.usage ?? {};
      spent += (u.input_tokens ?? 0) * 1.25e-6 + (u.output_tokens ?? 0) * 4.25e-6;
      const text = r.json?.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("") ?? "";
      let v: any = {};
      try { v = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
      const picked = Number.isInteger(v.pick) ? cands[v.pick] : null;
      results.push({ topic, beat: i, query: beat.query, candidates: cands.length, usable: !!v.usable && !!picked, pick: picked ? { source: picked.source, title: picked.title, license: picked.license, file: picked.file, page: picked.page } : null, reason: v.reason ?? text.slice(0, 200), tokens: u.input_tokens, status: r.status });
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  writeFileSync(`${DIR}/results.json`, JSON.stringify(results, null, 2));
  const by = (t?: string) => results.filter((r) => !t || r.topic === t);
  for (const t of [...Object.keys(all), undefined]) {
    const rs = by(t);
    console.log(JSON.stringify({ topic: t ?? "ALL", usable: rs.filter((r) => r.usable).length, of: rs.length, pct: Math.round((100 * rs.filter((r) => r.usable).length) / rs.length) }));
  }
  console.log(JSON.stringify({ spent: +spent.toFixed(4) }));
}

const step = process.argv[2];
if (step === "search") await search();
else if (step === "judge") {
  if (!existsSync(`${DIR}/candidates.json`)) throw new Error("run search first");
  await judge(Number(process.argv[3] ?? 0.11));
} else throw new Error("usage: s8-archives.ts search|judge [maxDollars]");
