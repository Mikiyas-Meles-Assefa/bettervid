# assets-rights: sourcing real assets legally (research date 2026-10-29)

Sources saved in `research/sources/assets-rights/` (openverse, wikimedia-commons, nasa, met, pexels, pixabay, unsplash, tenor-bing-google, glam-apis, stock-video, legal-clips-memes, receipts-tools). Tags: [verified] = official doc or live API call I made, [reported] = third party, [unverified] = inferred. Not legal advice.

## TL;DR (recommendations)
1. Default-safe image/video stack needs no keys beyond free ones: Wikimedia Commons + Openverse + NASA + Met + Smithsonian + Rijksmuseum + Library of Congress + Internet Archive (Prelinger) + Pexels/Pixabay video. Every call returns license fields we can store per asset.
2. Build one `AssetRecord` per file: source URL, creator, license short name, license URL, attribution string, retrieved date. Auto-generate the credits list from it (Openverse and Commons return ready-made fields).
3. Dead or dying, do NOT build on: Tenor API (shut down 2026-06-30), Bing Search API (retired 2025-08-11), Google Custom Search JSON (closed to new customers, ends 2027-01-01), NYPL Repo API (ends 2026-08-01), Met `/v1/search` (retired 2026-10-01, use `/v1.1/search`).
4. Web image search (Brave Images $5/1k, Serper $0.30-1/1k) finds what a human editor would find, but results carry NO reliable license. Make it opt-in "editorial/educational fair-use mode", never the default, and log provenance.
5. Memes: generate originals (Muse Image or template-free text/reaction cards). Third-party meme images and Giphy GIFs are not licensed for commercial use. Imgflip caption_image is free but uses templates of copyrighted images and adds a watermark.
6. Receipts (headlines, papers, tweets): render our own typographic mock "quote cards" by default (text quoted with attribution, no screenshot). Real screenshots are opt-in fair-use (commentary), headless browser locally (Playwright) instead of paid APIs.
7. YouTube clips: default off. Only allow CC BY videos (API `videoLicense=creativeCommon`, verified via `status.license`) with credit. yt-dlp is a ToS breach; ship the hackathon demo without it.
8. Maps: Natural Earth (public domain) + OSM data (ODbL, credit "(c) OpenStreetMap contributors") rendered locally with MapLibre. Charts: our own from OWID data (CC BY) with citation.
9. Credit list: a closing card plus description text, generated from AssetRecords. Pexels/Pixabay/Unsplash API terms demand visible source credit; Unsplash also needs hotlinking and download pings, so skip Unsplash.
10. Fair use is a defense decided case by case, not a license. Content ID auto-claims regardless. For viral portrait output, prefer public domain, CC0 and generated art, and keep fair-use items short, transformed and flagged.

## 1. Open image/video sources

| Source | Auth | Limits | License | Video | Notes |
|---|---|---|---|---|---|
| Openverse `api.openverse.org/v1/images` | none for anon; OAuth optional | anon 20/min burst, 200/day sustained [verified live headers] | per item CC or PD; returns `license`, `license_url`, `creator`, ready `attribution` string [verified] | no (images, audio) | Aggregates Flickr, Wikimedia, etc. Docs warn license data accuracy not guaranteed [verified]. Registered limits not confirmed [unverified]. Filter `license_type=commercial`. Source: sources/assets-rights/openverse.md |
| Wikimedia Commons (`api.php` + `extmetadata`) | none, send User-Agent | polite use; no hard number found [unverified] | per file; `LicenseShortName`, `LicenseUrl`, `AttributionRequired`, `Artist`, `Copyrighted` [verified live] | yes (webm/ogv) | Best archival source. Beware wrong-file title matches (File:Migrant_Mother.jpg is an unrelated CC BY-SA photo). Also "PD in US only" files and personality/trademark rights. Search: `api.wikimedia.org/core/v1/commons/search/page` [verified] |
| NASA Images `images-api.nasa.gov` | none | not stated; polite | mostly US-gov PD; "should be credited"; no implied endorsement; identifiable people and third-party-labeled items need care [verified] | yes, real archival video (Apollo etc.) [verified live] | Good for space and history |
| Met Open Access | none | 80 req/s [verified] | CC0 only when `isPublicDomain:true` [verified] | no | `/v1/search` retired 2026-10-01; use `/v1.1/search`, returned IDs live [verified] |
| Smithsonian Open Access `api.si.edu` | free api.data.gov key; DEMO_KEY works | DEMO_KEY header `x-ratelimit-limit: 10` [verified]; real key higher, number unconfirmed | CC0 for open access items (per-item flag) [unverified field] | few | Large, mixed quality |
| Rijksmuseum `data.rijksmuseum.nl` | no key on live call [verified] | unknown | CC0 wherever possible, IIIF hi-res [reported] | no | Linked Art JSON, awkward but works. Paintings, Dutch golden age |
| Europeana | `wskey` (free), `api2demo` for tests | unknown | `reusability=open`; metadata CC0, MEDIA follows `edm:rights` [reported] | some | Check rights per item; many "in copyright" |
| Library of Congress `loc.gov` JSON | none | Cloudflare challenge hit my plain curl [verified]; stated "Working Within Limits" page not read | No blanket license; many PD (FSA/OWI photos, Prints & Photographs); read item rights advisory | film and audio via streaming services | Needs polite UA and backoff. Best for US history photos (Dust Bowl, WWII) |
| Internet Archive (`advancedsearch.php`, `licenseurl` field) | none | not found | per item; Prelinger: many PD dedication but "DO NOT ASSUME" all are [reported] | yes (8.5k+ Prelinger films; 10,461 in query) [verified count] | Filter `licenseurl` containing publicdomain/CC0/CC BY. Prelinger shotlist metadata not for commercial reuse. Suggested credit text in sources file |
| NYPL | token | Repo API ended 2026-08-01, no replacement [reported] | CC0 metadata on GitHub | no | Skip |
| Pexels | key (free, instant) | 200/h, 20k/month; free raise on request [verified] | Pexels license (commercial OK) | yes, up to 4K (`/v1/videos/search`) [verified] | Must show prominent Pexels link; credit photographers. Stock, not archival |
| Pixabay | key | 100 req/60s; cache 24h; no permanent hotlinking; no mass downloads [verified] | Pixabay Content License | yes, `/api/videos/` up to 4K | Download to own storage (allowed for use). Show Pixabay as source |
| Unsplash | key | quotas unspecified [verified] | Unsplash License | no | API terms force hotlinking, download pings, profile credit; poor fit for rendered video. Skip |
| Coverr | API for approved partners [unverified] | n/a | free commercial, attribution optional, no AI-training use, no redistribution [reported] | yes | Site download only, manual |
| Mixkit | no API found | n/a | Free vs Restricted license per clip [reported] | yes | Manual only; check label per clip |

Quality: Pexels/Pixabay for generic B-roll is fine but looks "stocky" and some are AI-generated [reported]. Archival (Commons, LoC, NASA, IA) is where editorial character comes from; expect low resolution, scans, uneven metadata.

## 2. Web search APIs (images/video)

| API | Image support | Price | Status | Licensing filter |
|---|---|---|---|---|
| Brave Search | Images, News, Videos endpoints in the same plan | $5 per 1k requests; free tier removed 2026-02-12, replaced by about $5 monthly credit (a snippet says up to $20), card required, attribution for free credit, 50 qps [reported] | live | none |
| Serper.dev (Google results) | `/images` | 1 credit per 10 results; $50 for 50k credits down to $0.30/1k; 2,500 free once [reported] | live | none (can add `tbs=sur:fc` style usage-rights param, unverified) |
| SerpApi | Google Images | Free 250/mo, $25 for 1k, $75 for 5k, $150 for 15k [reported] | live | `tbs` passthrough, unverified. Legal Shield only on Production plan |
| Tavily | `include_images`, optional descriptions [reported] | 1 credit basic search ($0.008/credit), 1,000 free credits/mo | live (Nebius acquiring, reported) | none, no license data |
| Exa | no clear image endpoint found [unverified] | $7/1k incl 10 results [reported] | live | n/a, use for page discovery then extract images |
| Bing Search API | retired 2025-08-11, all endpoints, no replacement for images [reported] | n/a | dead | n/a |
| Google Custom Search JSON | closed to new customers; existing until 2027-01-01 [reported] | was $5/1k | dying | `rights` param existed; moot |

Key point: none of these gives trustworthy licenses. Treat their output as "found on web, rights unknown". Hotlinked/rehosted web photos are the classic infringement case; use only in a clearly flagged fair-use lane. Verdict: Brave Images as the single opt-in web fallback (fits "judges need no credentials of their own" only if we ship our own key; check). Backup Serper (cheapest).

## 3. Maps and data
- Natural Earth: public domain, no attribution required but welcomed [unverified, from background knowledge]. Use for country/coast outlines, render with MapLibre or d3-geo locally.
- OpenStreetMap data: ODbL, credit "(c) OpenStreetMap contributors" [unverified here]. OSMF public tile servers have a usage policy that forbids heavy use; render from own vector tiles (Protomaps/OpenMapTiles) or Overpass-derived GeoJSON instead.
- Mapbox: wordmark and OSM credit required on its maps and needs a token; skip for hackathon, MapLibre + own data is key-free [unverified].
- Historical maps: David Rumsey (mixed licenses), LoC maps (PD mostly), Wikimedia Commons "Old maps" (check per file).
- Our World in Data: own charts CC BY, cite OWID; third-party datasets keep their licenses; one chart returned 403 as non-redistributable [verified FAQ]. Recommendation: pull CSV, redraw in our style, cite "Our World in Data / <original source>".

## 4. Receipts
- Headless browser (Playwright/Puppeteer) locally is free and best fidelity. Paid: Microlink free 25/day, Pro $49/mo [reported]; ScreenshotOne 100 free/mo, $17 for 2,000 [reported].
- arXiv API gives title, authors, abstract text; arXiv metadata is free to use; papers have per-paper licenses [unverified]. Safe receipt: render a typographic card quoting the title, journal and a short abstract excerpt with citation, not a page screenshot.
- Legal: screenshots of news pages, papers and tweets are copyrighted expression. Using a headline plus a short excerpt for commentary is typically fair use in the US, but it is a defense, not a right. Tweets add platform ToS limits and the author's privacy; avoid private individuals. Default to "re-typeset quote card" (facts and short quotes), opt-in "real screenshot".

## 5. Memes and GIFs
- Tenor API: dead for everyone as of 2026-06-30 [reported, 9to5google]. Giphy: beta key 100 calls/hour, search max 50 results, production key needs application and fee, "Powered by GIPHY" attribution [reported]. Giphy license: personal non-commercial; it cannot clear underlying film rights [reported]. Verdict: skip for commercial or viral output.
- Imgflip: `/get_memes` free no login; `/caption_image` free with account credentials, watermark unless Premium ($9.99/mo; GIF, search, AI meme) [reported]; official doc not fully read [unverified]. KnowYourMeme: no API, scraping prohibited by them [reported].
- Meme law: Griner v. King (8th Cir. 2024) rejected fair use for a campaign using the Success Kid meme commercially; Warhol (2023) tightens factor one when purpose is the same and use is commercial [reported]. Non-commercial commentary is more defensible, but a hackathon "most viral" entry that gains followers is arguably promotional.
- Content ID: auto-matches music and film clips, can't evaluate fair use; a claim blocks monetization, strikes follow disputes [reported, EFF/YouTube]. TikTok and Instagram have their own audio and clip matching [unverified].
- Why generated memes win: Muse Image makes original "reaction" art (a character, a face, a caption card) with no third-party IP, no claim risk, consistent style, and counts toward the Meta-core and Best Creative prizes. Avoid depicting real people or brand characters.

## 6. Clips from YouTube and elsewhere
- yt-dlp: no US court has ruled on it; the 2020 RIAA sec 1201 attack on youtube-dl was reversed by GitHub after EFF's letter; Yout lost in D. Conn.; downloading violates YouTube ToS (contract, account risk) [reported]. Don't ship as default; a judge's reproducible demo should not depend on it.
- Creative Commons YouTube: `search.list?type=video&videoLicense=creativeCommon` [verified doc]; it is CC BY, require credit. Reconfirm each hit through `videos.list` `status.license`. Beware re-uploads by people who don't hold rights.
- Public-domain film: Prelinger/Internet Archive (check `licenseurl`), NASA video, LoC film, US government works (US federal agencies' footage is PD but contains third-party material sometimes).
- News footage licensing: AP/Reuters-type about $80-150 per second with 30 s minimum; Producers Library $49-79/s; BFI GBP3,600 first minute [reported]. Documentary insurers want clearance logs and fair use opinion letters [reported]. Not viable for us; use only as opt-in "bring your own license".
- Fair use limits: four factors, transformation, amount, market effect; short clips used as the object of commentary fare best; no safe seconds count.

## 7. Attribution best practice (automatic credits)
- Store per asset: `title, creator, creator_url, source_url (landing page), license_name, license_url, modified (bool + what)`. Openverse returns `attribution`; Commons gives `Artist`, `LicenseShortName`, `LicenseUrl`, `AttributionRequired` [verified]. CC's TASL pattern: Title, Author, Source, License.
- Render: end-card "Sources" (3-5 s, skippable by design), plus a `credits.md` and description text for the post. Only list items needing attribution in-frame; log all items in the manifest.
- Mark modifications (cropped, color-treated) as CC BY requires "indicate if changes were made" [verified for OWID text]. CC BY-SA is a problem for remixes (share-alike); allowlist CC0, PD, CC BY; exclude NC and ND and SA by default.
- Pexels/Pixabay API terms want visible source links where results are shown [verified]; a credits line satisfies the spirit.

## 8. How production teams do it
Little is publicly documented. Searches found style analyses only, nothing on Vox, Johnny Harris or Kurzgesagt licensing specifics [unverified]. Industry norm from general sources: licensed stock/archive (Getty, Storyblocks, news archives), public-domain archives, fair use for commentary with a lawyer-signed clearance log, E&O insurance [reported]. Kurzgesagt is mostly original illustration, which matches our "generate original art" default.

## 9. Recommended sourcing order per beat type

| Beat | Default-safe (auto) | Opt-in (flagged, user confirms) |
|---|---|---|
| Proof (photo/doc of a real event) | 1 Wikimedia Commons / LoC / NASA / IA public domain; 2 Smithsonian, Europeana open; 3 Muse Image "illustration of" labeled as recreation, never passed off as real | Brave Images web photo (fair use, with source credit on screen); real screenshot of news/page |
| Example (concrete illustration) | Pexels/Pixabay video or photo; Commons CC BY with credit; else generated | CC BY YouTube clip with credit |
| Abstract (concept) | Muse Image art, diagrams, Manim; Met/Rijksmuseum CC0 paintings as style plates | none needed |
| Joke / reaction | Original generated reaction card or character; Remotion text meme layouts with no third-party image | Imgflip template captions (watermark/IP risk); Giphy (non-commercial only); known meme images (fair use, risk) |
| Map | Natural Earth + OSM data via MapLibre, credit line; Commons historical maps (check license) | Mapbox styled maps with token |
| Number / stat | Own chart from OWID or primary data, cite source; quote card | Screenshot of original chart (check source license) |
| Receipt (headline/paper/tweet) | Re-typeset quote card with outlet, date and URL; arXiv title/abstract card | Real headless-browser screenshot cropped to headline (fair use commentary) |

Pipeline notes: apply SAM cutouts and a unifying style treatment only to assets whose license allows modification (CC0, PD, CC BY; not ND). Cache downloads (Pixabay requires 24 h cache; no hotlinking). Keep a `rights_mode` flag (`safe` default, `editorial`) and put it in the manifest the critic can read.

## Open questions
- Openverse registered-key limits and Wikimedia API rate guidance (not retrieved).
- Smithsonian real key limit; CC0 flag field name.
- Library of Congress rate limit and robot policy (Cloudflare blocked curl).
- Whether Exa returns image URLs; Brave image result fields (thumbnail vs source) and exact current free credit ($5 vs $20).
- Imgflip current auth (username/password vs API key) and watermark rule from the official page.
- Coverr API availability; Mixkit has no API.
- Natural Earth, OSM, Mapbox terms were from background knowledge, not fetched.
- Whether Meta's hackathon rules treat our own Brave/Pexels keys as acceptable for judges (key must be shipped by us).
- Any documented sourcing practice for Vox, Johnny Harris, Kurzgesagt.
