// Safe-mode archive search (spike S8): public domain, CC0, CC BY, CC BY-SA and NASA only.
// Returns candidates with a thumbnail for judging and a large image URL for the video.
import { sleep } from "./util.ts";

export type Candidate = { source: string; title: string; license: string; credit: string; page: string; thumb: string; full: string };

const UA = "bettervid/0.1 (hackathon project; mikiyasmeles77@gmail.com)";
const SAFE = /public domain|^pd|cc0|^cc[ -]by(-sa)?( |$|-\d|\d)/i;

async function get(url: string, timeoutMs = 20000): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const j: any = await r.json();
  if (j.error) throw new Error(`${j.error.code ?? "error"}: ${j.error.info ?? ""}`);
  return j;
}

const strip = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function commons(q: string, n: number): Promise<Candidate[]> {
  const u =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${encodeURIComponent(q)}` +
    `&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1600`;
  // Commons sometimes answers 200 with "too busy" under load (S8); one retry after a pause.
  const j = await get(u).catch(async () => (await sleep(15000), get(u)));
  return (Object.values(j.query?.pages ?? {}) as any[])
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ ii }) => ii && /image\/(jpeg|png)/.test(ii.mime) && ii.width >= 500)
    .map(({ p, ii }) => ({
      source: "Wikimedia Commons",
      title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
      license: ii.extmetadata?.LicenseShortName?.value ?? "unknown",
      credit: strip(ii.extmetadata?.Artist?.value) || "unknown",
      page: ii.descriptionurl,
      thumb: ii.thumburl.replace(/\/\d+px-/, "/400px-"),
      full: ii.thumburl,
    }))
    .filter((c) => SAFE.test(c.license))
    .slice(0, n);
}

async function nasa(q: string, n: number): Promise<Candidate[]> {
  const j = await get(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`);
  return (j.collection?.items ?? []).slice(0, n).map((it: any) => {
    const id = it.data?.[0]?.nasa_id;
    return {
      source: "NASA",
      title: it.data?.[0]?.title ?? id,
      license: "NASA (public domain in the US)",
      credit: "NASA",
      page: `https://images.nasa.gov/details/${id}`,
      thumb: it.links?.[0]?.href,
      full: `https://images-assets.nasa.gov/image/${encodeURIComponent(id)}/${encodeURIComponent(id)}~large.jpg`,
    };
  });
}

async function met(q: string, n: number): Promise<Candidate[]> {
  const j = await get(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=${encodeURIComponent(q)}&hasImages=true`);
  const out: Candidate[] = [];
  for (const id of (j.objectIDs ?? []).slice(0, 6)) {
    const o = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null);
    if (o?.isPublicDomain && o.primaryImageSmall)
      out.push({ source: "The Met", title: o.title, license: "CC0", credit: o.artistDisplayName || "The Met", page: o.objectURL, thumb: o.primaryImageSmall, full: o.primaryImage || o.primaryImageSmall });
    if (out.length >= n) break;
  }
  return out;
}

// Interleaves sources so the top hit of each comes first. Failed sources are skipped.
export async function searchArchives(q: string, perSource = 3): Promise<Candidate[]> {
  const found = await Promise.all([commons, nasa, met].map((f) => f(q, perSource).catch((e) => (console.error(`  ${f.name} "${q}": ${e.message}`), [] as Candidate[]))));
  const out: Candidate[] = [];
  for (let k = 0; k < perSource; k++) for (const list of found) if (list[k]) out.push(list[k]!);
  return out;
}

export async function download(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}
