# S8: do free archives cover the proof and example beats?

Date: 2026-10-29. Script: `scripts/spikes/s8-archives.ts`, beats in `scripts/spikes/s8-beats.json`. Thumbnails, `candidates.json` and `results.json`: `media/spikes/s8/` (gitignored), logs `media/spikes/logs/s8-*.log`.

**Verdict: PASS, 21 of 24 beats (88%)** got a usable, accurately matching, commercially licensed image. Bar was 70% across 3 topics.

## Method
- 3 topics, 8 beats each, chosen to span easy to hard for archives: John Snow and cholera (19th-century history), Apollo 13 (NASA-documented), CRISPR (modern science).
- Each beat has a narration line, what the shot needs, and **one** search phrase written up front (no retries or tuning per beat), the way the director would write it.
- Safe mode only. Sources, top 3 each, all keyless:
  - Wikimedia Commons, filtered to public domain, CC0, CC BY and CC BY-SA by `LicenseShortName`, images only.
  - Openverse with `license_type=commercial`.
  - NASA Images.
  - The Met, `isPublicDomain` objects only.
- Spark 1.3 (effort low) saw up to 10 thumbnails (400 px) per beat with source and title, and answered `{pick, usable, reason}` under a strict "accurate subject" rule. I then checked every pick by eye.

## Results

| Topic | Usable | Misses |
|---|---|---|
| John Snow | 5 of 8 | "miasma cholera illustration" and "Vibrio cholerae micrograph" returned no safe images (Commons' top hits were PDFs and book scans); "Bazalgette sewer construction London" returned only wrong subjects, which Spark correctly rejected |
| Apollo 13 | 8 of 8 | none. 7 picks from NASA, 1 from Commons |
| CRISPR | 8 of 8 | none. All from Commons |

- Every pick checked by eye is the right subject: the Snow map, the Barker portrait of Snow, *Monster Soup*, the Saturn V launch, the damaged service module, the CO2 "mailbox", a T2 phage TEM, the Cas9 structure, a sickle cell smear, portraits of Doudna and He Jiankui.
- Caveats Spark missed: the "Broad Street pump" pick is the modern replica on Broadwick Street (Spark called it "actual"), and the crew portrait should be checked for which lineup it shows (Mattingly was replaced by Swigert before launch). The writer and critic should phrase these accurately ("a replica of the pump stands there today").
- Licenses of the 21 picks: 7 public domain, 7 NASA, 2 CC BY, 5 CC BY-SA. All carry a creator and page URL for the credits card.

## Source health on Oct 29
- **Openverse was down all run**: every query timed out (earlier probes got 502/504 after ~55 s). It contributed nothing; the result above is without it. The script caps it at 10 s.
- **Commons** twice answered `200` with `cirrussearch-too-busy-error`. Treat error bodies as failures and retry with backoff (15 s worked).
- **The Met** returns plenty of public-domain objects but almost never the right subject for these topics; no pick came from it. Keep it for art and history topics only.
- **NASA** is excellent for space: fast, relevant, all usable.

## For the pipeline (stage 5a)
- Commons plus NASA carry the load. Search all safe sources in parallel, show Spark up to ~10 thumbnails, take its pick, and keep the `AssetRecord` (source, title, license, creator, page URL).
- On a miss, retry once with a simpler phrase (S4 showed the same pattern), then fall back to generated art in the style, as the plan says. All 3 misses here would be fine as generated illustrations.
- **CC BY-SA:** 5 of 21 picks are share-alike. Using one in a video may require releasing that video under CC BY-SA too. Prefer PD, CC0, NASA and CC BY when Spark rates candidates equal, and record the SA flag so the credits card and the output license stay honest. Not legal advice.
- Judge cost: ~$0.0065 per beat with ~6 to 9 thumbnails, ~$0.003 with 3. A 30 s video with ~6 real-asset beats is about $0.04.

## Cost
- Searches free. Spark judging: 22 calls, about $0.13.
