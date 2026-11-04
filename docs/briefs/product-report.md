# Report: the product layer

Branch `product`, not pushed, not merged. Based on `main` at 9f46a36 (the worktree first opened on an older commit from Nov 2 that had no uploads, no `app/preview.ts` and no `docs/briefs/`, so the branch was moved to `main` before any work).

No video was made, no model was called, nothing was spent. Every check used the finished projects already in `projects/`.

## What was built

**Home (`#/`).** The headline says what it is in one line ("Turn a sentence or your own files into a finished video"), the lede adds any purpose and the human-team bar. Three showcase thumbnails fan out beside it on wide screens, so the first glance shows what comes out. The prompt box keeps file drop and chips (now with a drop veil and a hint of the accepted types; Cmd or Ctrl+Enter submits). The style picker shows all seven styles from `styles/*.json` with their stills, the loop playing on hover, focus or when chosen, plus the custom styles and "Describe your own". Length pills and a narrator select sit under it, then "Make video" with an honest note on time (about a quarter of an hour per minute of video). Below: the Showcase row, six videos chosen by hand in `app/showcase.json` (id plus one line each). The footer names the Meta models and their roles (Muse Spark plans, researches, writes, directs, reviews and repairs; Muse Image draws; SAM cuts parts out), plus ElevenLabs and Remotion, so nothing is claimed for Meta that Meta does not do.

**Studio (`#/p/<id>[/<tab>]`).** Player on the left (sticky), with a small facts grid (length, sourced facts, sections, pictures, spend, moments), Download and Make another. On the right the status, title, the request and the takeaway, then tabs (arrow keys, Home and End work; tabs with nothing to show are left out):
- Overview: stages with live progress and times, model calls per stage when `run.log` has them, Replay and Edit captions (kept from before), the plan (topic, why, angle, the misconception it fixes, what was asked for), critic notes.
- Script: beats with their role and claim chips that jump to the claim in the Trail, then how the writing changed pass by pass.
- Direction: goal, promise, arc, the look, every moment with its time range, where the eye goes, what the viewer then knows, what is held back, demonstrations and holds.
- Scenes: each section with its words, rounds, the frames the reviewers looked at (`scene/sN/once/shown`, or the latest `look*/shown` for older runs) with timecodes, enlargeable, and the scene as written.
- Trail: fact sheet (claims with quotes, sources, confidence), sources, every picture with credit, license and page link, spend by stage from `projects/spend.jsonl`, model calls table, stage time bars.
- Material (only with uploads): what the files require of the video, then per file: headings, tables drawn as tables, pages and pictures taken from it (with the reader's description and the words it read), problems, and the full text that was read in a scroll box. `pipeline/stages/material.ts` saves PDF page renders and embedded pictures together in `material/.extracted/<file>.image-N.png`; the tab shows them all, and says plainly when a PDF had no pictures and no rendered pages.

**Gallery (`#/gallery`).** Every project with a `video.mp4`, sorted by when it was finished. Thumbnails are cut by ffmpeg (thumbnail filter a quarter of the way in, 480 px wide), cached as `thumb.jpg` in the project folder, remade only when the video is newer, at most two at a time. Style filter. The same request made several times (merge sort has 10 takes) shows as one card, preferring the showcase take, with "1 of N takes" and a switch to show every take.

**Batch (`#/batch`).** One prompt per line, shared style, length and narrator, then "Add N to the line". Each line becomes a real project record (`project.json`, no stages), listed in "The line" with remove buttons, pause and resume, and the budget. The server makes one at a time: when a run ends it starts the next waiting one with `pipeline/run.ts <id>`, unless the line is paused, `BATCH_DRY=1`, or the ledger is at `BUDGET_USD` (then it pauses itself and says why). A single video asked for on the home page while something else is being made now joins the line instead of being turned away. When public (`HOST` set), batches are capped at 5, each prompt counts against the per-visitor limit, and pause and remove are off.

**Server.** `app/studio.ts` (what the studio reads: direction, sections and stills, pictures, ledger spend, model calls, material, CSV tables, thumbnails, stage labels), `app/queue.ts` (the line, `queue.json` next to the projects), new routes `/api/showcase`, `/api/queue`, `/api/batch`, `/p/<id>/thumb.jpg` and `/p/<id>/<path>` (pictures only, only inside that project's folder). The "mux" stage is labeled "Joining picture and sound" and sits after "render" in the progress list. Lists send a slim card (the gallery's data went from 337 KB to 20 KB). The server prints the port it really listens on.

**Hosting.** `npm run app` uses `--env-file-if-exists`, so it starts without a `.env`. The Dockerfile adds `python3-numpy` (the pipeline tools need it), creates `/srv/projects`, sets `PYTHON`, and adds a health check on `/api/options`. `.dockerignore` keeps out `projects`, `node_modules`, `.worktrees`, `.claude`, `.env*`, `bench/work`, logs and media.

**README.md** rewritten for the judges, 130 lines.

## How it was checked

- `npx tsc --noEmit -p .`: clean. `npm run test:pipeline`: 163 pass, 0 fail (160 before plus 3 new).
- New `app/server.test.ts`, added to `test:pipeline`: starts the server on a free port with an empty temporary projects folder, `BATCH_DRY=1` and `QUEUE_PAUSED=1`, and checks `/`, `/api/options` (seven styles, each with a still), `/api/videos`, `/api/showcase`, one project's studio data, picture serving (and that `project.json` and `..%2F` paths are refused), a batch of two with a blank line, queue order and positions, the record's settings, a single video joining the line, removal deleting a never-started record, and that resuming in dry mode starts nothing.
- Server on 4173 against a folder of links to the real projects, dry and paused: every page and API fetched with curl (`/`, `/api/options`, `/api/videos`, `/api/showcase`, `/api/queue`, studio data for every one of the 53 projects, thumbnails, stills, PDF pictures, uploaded pictures, previews, video byte ranges, 404s).
- Browser pane, desktop and phone (375 px), light and dark: home, studio (all tabs on merge-min-a4, wright-w1, stats-w2, the harbour PDF project), gallery, batch (two prompts added in dry mode, opened, one removed). No console errors on any page. No horizontal page scroll at 375 px or at desktop width (one overflow from a long picture title was found and fixed). Tab arrow keys move and select.
- Container shape (Docker is not installed on this Mac, see below): only the files the image would get (copied with `.dockerignore` as the exclude list, 18 MB without `node_modules`), run with the image's command and settings (`HOST` set, so public mode; `PORT=8080`; relative `PROJECTS_DIR`; `BUDGET_USD=5`). All pages and APIs answered; public mode refused pausing the line and a batch of six.
- No `pipeline/run.ts` process was started by any of this. A pipeline process seen running during the check (`headphones-fast`, started 22:23 from the main checkout) belongs to another session.

Screenshots taken during the check are in `/Users/miki/.claude/projects/-Users-miki-Desktop-deskt-bettervid/1c1a23c9-e0df-486a-be94-302ef0e3a00b/tool-results/` (the `mcp-Claude_Browser-blob-*` files); none are committed.

## What is still weak

- **`docker build` has not been run.** Docker is not installed here. The container shape was checked by hand, but the Linux build of `@napi-rs/canvas`, the apt packages and Remotion's Chrome download are untested in the image.
- **The batch runner has never run a real video.** By the rules of this job it was only tested dry and paused. The path it uses (`pipeline/run.ts <id>` on a fresh record) is the pipeline's normal resume path, and a record made by the server matches what `pipeline new` writes, but a first real run should be watched.
- **Batch has no uploads.** Each line is a prompt only; files go through the home page.
- **Rendered PDF pages and embedded pictures share one naming scheme** in `material/.extracted`, so the Material tab cannot label which is a whole page. It shows the reader's description of each.
- **Takes.** Ten merge sort takes, three stats takes and two Wright takes exist because the engine was being improved. The gallery groups them; the representative is the showcase take if there is one, else the newest, which for some groups is a short test clip.
- **Thumbnails** were written as `thumb.jpg` into 28 real project folders (every one with a video) during the check (they are cache, regenerated if the video changes). The merge sort thumbnails are mostly empty dark frames because the frames themselves are sparse.
- **Studio for very old projects** (Oct 29 to 30) has no direction, no scene sections and no run log, so those tabs and the model calls are absent there.
- `index.html` is 81 KB unminified and served without compression.
- The home page's style loop and the fan rely on `requestAnimationFrame`, which a hidden tab does not run; in a visible tab they work.

## Commands

Locally (Node 24, ffmpeg, Python 3 with Pillow and NumPy):

```sh
npm install
cp .env.example .env                      # META_API_KEY, ELEVENLABS_API_KEY
npm run app                               # http://localhost:4173
PROJECTS_DIR=/path/to/projects npm run app
BATCH_DRY=1 QUEUE_PAUSED=1 npm run app    # look at every page with no chance of a run
npx tsc --noEmit -p . && npm run test:pipeline
```

Docker:

```sh
docker build -t bettervid .
docker run -p 8080:8080 -e META_API_KEY=... -e ELEVENLABS_API_KEY=... -e BUDGET_USD=5 \
  -v bettervid-projects:/srv/projects bettervid
# http://localhost:8080
```

To change the showcase, edit `app/showcase.json` (project ids that have a `video.mp4`; missing ones are skipped).
