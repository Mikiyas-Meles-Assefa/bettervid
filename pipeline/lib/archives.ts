// Safe-mode archive search (spike S8): public domain, CC0, CC BY, CC BY-SA and NASA only.
// Sources: Wikimedia Commons, NASA, The Met, Smithsonian Open Access (CC0 media only) and the Internet Archive (items
// marked public domain or CC BY / BY-SA). The Library of Congress answers scripts with a browser challenge (403), so it
// is not searched directly; much of its public domain material is mirrored on Commons.
// Returns candidates with a thumbnail for judging and a large image URL for the video.
import { sleep } from "./util.ts";

export type Candidate = { source: string; title: string; license: string; credit: string; page: string; thumb: string; full: string; size?: string };

// Below this on the short side, a still blown up to a 1080x1920 frame looks blurry (seen on Oct 29: 649x649).
export const MIN_SIDE = 1000;

const UA = "bettervid/0.1 (hackathon project; mikiyasmeles77@gmail.com)";
const SAFE = /public domain|^pd|cc0|^cc[ -]by(-sa)?( |$|-\d|\d)/i;

// Retries network failures (seen Oct 29: "fetch failed" on every archive at once for a few seconds), including a
// connection that drops mid-download, so the body is read here and handed back as a buffered Response.
async function fetchRetry(url: string, timeoutMs: number, tries = 3): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
      return new Response(await r.arrayBuffer(), { status: r.status, headers: r.headers });
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(2000 * i);
    }
  }
}

async function get(url: string, timeoutMs = 20000): Promise<any> {
  const r = await fetchRetry(url, timeoutMs);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const j: any = await r.json();
  if (j.error) throw new Error(`${j.error.code ?? "error"}: ${j.error.info ?? ""}`);
  return j;
}

const strip = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

let inFlight = 0;
const waiting: (() => void)[] = [];
async function politely<T>(f: () => Promise<T>, limit = 2): Promise<T> {
  if (inFlight >= limit) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await f();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function commons(q: string, n: number): Promise<Candidate[]> {
  const u =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(q)}` +
    `&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1600`;
  // Commons sometimes answers 200 with "too busy" under load (S8). Ask politely: two searches at a time, and a
  // too-busy answer waits longer each time before asking again.
  const j = await politely(async () => {
    for (let i = 1; ; i++) {
      try {
        return await get(u);
      } catch (e) {
        if (i >= 4) throw e;
        await sleep(8000 * i);
      }
    }
  });
  return (Object.values(j.query?.pages ?? {}) as any[])
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ ii }) => ii && /image\/(jpeg|png)/.test(ii.mime) && Math.min(ii.width, ii.height) >= MIN_SIDE)
    .map(({ p, ii }) => ({
      source: "Wikimedia Commons",
      title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
      license: ii.extmetadata?.LicenseShortName?.value ?? "unknown",
      credit: strip(ii.extmetadata?.Artist?.value) || "unknown",
      page: ii.descriptionurl,
      // Commons only serves standard thumbnail widths; 400px returns 400 Bad Request, 500px works.
      thumb: ii.thumburl.replace(/\/\d+px-/, "/500px-"),
      full: ii.thumburl,
      size: `${ii.width}x${ii.height}`,
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

// Smithsonian Open Access. Without SI_API_KEY it uses api.data.gov's shared DEMO_KEY, which needs no sign-up but allows
// few calls an hour, so judges can run it without credentials. Only media marked CC0 is kept.
// Once the key is over its limit (429), the source rests for a while instead of failing on every search.
let siRestUntil = 0;
async function smithsonian(q: string, n: number): Promise<Candidate[]> {
  if (Date.now() < siRestUntil) return [];
  const key = process.env.SI_API_KEY || "DEMO_KEY";
  try {
    const j = await get(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(`${q} AND online_media_type:"Images"`)}&rows=${n * 3}&api_key=${key}`);
    return smithsonianCandidates(j).slice(0, n);
  } catch (e: any) {
    if (/^429/.test(e.message)) {
      siRestUntil = Date.now() + 10 * 60_000;
      throw new Error(`over the hourly limit${key === "DEMO_KEY" ? " of the shared DEMO_KEY (set SI_API_KEY, free from api.data.gov)" : ""}; resting for 10 minutes`);
    }
    throw e;
  }
}

export function smithsonianCandidates(j: any): Candidate[] {
  const out: Candidate[] = [];
  for (const row of j?.response?.rows ?? []) {
    const d = row.content?.descriptiveNonRepeating ?? {};
    const m = (d.online_media?.media ?? []).find((x: any) => x.type === "Images" && x.usage?.access === "CC0" && x.idsId);
    if (!m) continue;
    const big = (m.resources ?? []).find((r: any) => r.width && r.height);
    if (big && Math.min(big.width, big.height) < MIN_SIDE) continue;
    const ids = `https://ids.si.edu/ids/deliveryService?id=${encodeURIComponent(m.idsId)}`;
    out.push({
      source: `Smithsonian (${d.data_source ?? "Open Access"})`,
      title: String(row.title ?? "untitled"),
      license: "CC0",
      credit: d.data_source ?? "Smithsonian Institution",
      page: d.record_link ?? ids,
      thumb: `${ids}&max=500`,
      full: `${ids}&max=2048`,
      ...(big ? { size: `${big.width}x${big.height}` } : {}),
    });
  }
  return out;
}

// Internet Archive image items whose license is public domain or CC BY / BY-SA. The item's own largest image is used.
async function internetArchive(q: string, n: number): Promise<Candidate[]> {
  // A slash inside a wildcard breaks the search backend, so ask broadly and let iaLicense keep only the safe licenses.
  const query = `(${q}) AND mediatype:image AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons*)`;
  const j = await get(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=licenseurl&fl[]=creator&rows=${n * 2}&output=json`);
  const metas = await Promise.all((j.response?.docs ?? []).map((doc: any) => get(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`).then((m) => internetArchiveCandidate(doc, m)).catch(() => null)));
  return metas.filter((c): c is Candidate => !!c).slice(0, n);
}

export function internetArchiveCandidate(doc: any, meta: any): Candidate | null {
  const license = iaLicense(doc.licenseurl);
  if (!license) return null;
  const files = (meta?.files ?? []).filter((f: any) => /^(JPEG|PNG)$/i.test(f.format ?? "") && !/thumb/i.test(f.name ?? ""));
  // Items rarely list pixel sizes, so file size stands in for the largest original; the download is measured later.
  const f = [...files].sort((a: any, b: any) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  if (!f || Number(f.size ?? 0) < 150_000) return null; // small files are small images
  return {
    source: "Internet Archive",
    title: String(doc.title ?? doc.identifier),
    license,
    credit: [doc.creator].flat().filter(Boolean).join(", ") || "Internet Archive",
    page: `https://archive.org/details/${doc.identifier}`,
    thumb: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
    full: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(f.name)}`,
  };
}

export function iaLicense(url = ""): string | null {
  if (/publicdomain\/zero/i.test(url)) return "CC0";
  if (/publicdomain\/mark/i.test(url)) return "Public domain";
  const m = url.match(/creativecommons\.org\/licenses\/(by(?:-sa)?)\/([\d.]+)/i);
  return m ? `CC ${m[1]!.toUpperCase()} ${m[2]}` : null;
}

const SOURCES = [commons, nasa, met, smithsonian, internetArchive];

// Interleaves sources so the top hit of each comes first. Failed sources are skipped.
export async function searchArchives(q: string, perSource = 3): Promise<Candidate[]> {
  const found = await Promise.all(SOURCES.map((f) => f(q, perSource).catch((e) => (console.error(`  ${f.name} "${q}": ${e.message}`), [] as Candidate[]))));
  const out: Candidate[] = [];
  for (let k = 0; k < perSource; k++) for (const list of found) if (list[k]) out.push(list[k]!);
  return out;
}

export async function download(url: string): Promise<Uint8Array> {
  const r = await fetchRetry(url, 60000);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}
