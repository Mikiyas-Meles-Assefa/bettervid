# bettervid

bettervid turns a sentence, or your own files, into a finished, narrated, sourced video. It is for any purpose: a lesson, a pitch, a history, a report from a spreadsheet. You type what you want (and drop in PDFs, Word, PowerPoint, Excel, CSV, text, code or pictures if you have them). Agents built on Meta's models plan it, research it, write it, direct it moment by moment, write every scene in a scene language, measure what they drew, have an art director review it, repair it, and render it. Every step is kept, so you can open any video and read how it was made: the plan, the script, the direction, the frames the reviewers looked at, every source and every picture credit, and what it cost.

Built for the Meta Global AI Developer Hackathon (Oct 27 to Nov 4, 2026). All code here was written during the event.

## Videos to watch first

Made start to finish by the pipeline, no hand edits. Download them from the [v1.0 release](https://github.com/Mikiyas-Meles-Assefa/bettervid/releases/tag/v1.0), or open them on the live site, each with its studio page: the plan, the script, the direction, the frames the reviewers saw, the sources and the spend.

| Video | Style | Length | What it shows |
|---|---|---|---|
| Dijkstra in Five Towns | Chalkboard | 1:30 | a graph search computed by code, each town settling on the words that say it |
| Why the Wrights Flew While Everyone Else Crashed | Documentary collage | 4:01 | archive photographs with their credits, the wind tunnel numbers as a table |
| Standard Deviation by Hand in Six Steps | Chalkboard | 3:29 | a worked exam example, step by step, with typeset math |
| How Merge Sort Actually Works | Neon | 1:34 | the sort computed and played on the words, slow first, then faster |
| Her Battle Too (Taytu at Adwa) | Documentary collage | 2:14 | history from sourced claims, with period art and credited illustrations |
| Find Any Name in Three Tries | Neon | 0:57 | binary search with a phone book |

Live site: https://bettervid.fly.dev. The home page shows these six, listed in `app/showcase.json`.

The 3-minute demo, made from the live site: [bettervid-demo.mp4](https://github.com/Mikiyas-Meles-Assefa/bettervid/releases/download/v1.0/bettervid-demo.mp4).

## How it works

One project is one folder with a `project.json`. Each stage reads what earlier stages wrote, adds its own part, and is skipped next time if its inputs did not change. Stages that do not depend on each other run at the same time.

| Stage | What happens | Model |
|---|---|---|
| material | Your files are opened by code (PDF pages laid out into text, tables and pictures; Word, PowerPoint, Excel, CSV read without extra tools) and read into part cards, with anything a file requires of the video (must say, never say, end with) | Muse Spark |
| plan | Reads your request once and sorts what you asked for: story, tone, visuals, sound, length, why you want it | Muse Spark |
| research | Web research into a fact sheet: claims, each tied to its sources, plus the story in order and the common misconception. The planner skips it when the topic is common knowledge | Muse Spark |
| writer | One pass: the narration, with the reviewer's checklist and the director's demonstration test built into the prompt, then the script in beats with the claims each line rests on and the examples a kit computes | Muse Spark |
| direction | One call: walks the script as the viewer, moment by moment: what each stretch is for, where the eye should be, what is held back, where to pause and let it land (holds), and how a demonstration plays, with the kit's real steps already in hand | Muse Spark |
| voice | Narration with word timings | ElevenLabs |
| director, assets, annotate | Pictures only when your own files bring them, or when a project asks for the hunt (`pictures: "find"`): archive images (Wikimedia Commons, NASA, the Met, Smithsonian, Internet Archive) with their licenses, generated ones where nothing real is needed, parts cut out, marks drawn on the spoken word. Otherwise the scene draws, computes and depicts everything | Muse Spark, Muse Image, SAM |
| scene | Every section is written at once in the scene language, built by the engine, measured by the instruments, looked at by a reviewer and an art director, and corrected once. Things the words are about are depicted with Muse Image and cut into parts with SAM when the writer asks | Muse Spark, Muse Image, SAM |
| timeline, mix, render, mux | Cut on the words; sound effects and music cued to scene moments and mastered to -14 LUFS while the picture renders with Remotion; then joined | Muse Spark for sound cues |
| critic | Optional (`critic: true`): watches frames of the finished video and files notes | Muse Spark |

Which Meta model does what:
- **Muse Spark** writes, directs, reviews and repairs: the plan, research, script, direction, every scene, the sound cues, the art director's review, the repairs, the critic, and reading your files. It also writes new styles from a description.
- **Muse Image** draws pictures in the video's style when a real one is not needed or cannot be found. Nothing generated stands in for a specific real person, document or event.
- **SAM** cuts parts out of pictures, so a figure can be lifted off its background and moved.

## What makes it different

- **Agent-written scenes in a scene language.** Scenes are not templates. Muse Spark writes each section as text in a small language (`prompts/engine-language.md`, `engine/language/`): text, pictures, drawn shapes, math, tables, programs, motion, camera, all timed to word numbers. The engine compiles it and renders it with Remotion. Code never decides layout or timing on its own; it carries out what the agent wrote and reports back.
- **Measured by instruments.** After a section builds, instruments read the frames (`engine/design/instruments/`): how much of the frame is used and by what, legibility, color, salience, where the eye goes, steadiness, timing against the words. Their readings go back to the writer as plain lines. They measure; the agents decide what good means for this video.
- **Reviewed by an art director.** A taste review (`engine/review/taste.ts`, `prompts/taste-review.md`) looks at the same frames with the readings, names the writer's own means in each fix, and checks after the repair whether the fixes landed.
- **Computed truth kits.** When a video demonstrates something exact (a sort, a graph search, linear algebra, math layout), a kit computes it (`engine/kits/`) and the scene plays the real steps on the words that describe them. The numbers on screen come from code, and a program can declare what it proves.
- **Your own files.** Uploads are read first and become sources: claims cite `file:<card>`, your pictures can be used directly, and requirements found in a file are passed to every later stage.
- **A trail for every video.** The studio page shows the plan, intent, script with claim links, direction with holds, scene sections with the frames the reviewers saw and the scene as written, sources, picture credits and licenses, spend per stage and model calls.

## The app

`app/server.ts` (plain Node, no framework) and one page, `app/public/index.html` (no build step).

- **Make** (`#/`): the prompt box with file drop, the style picker (seven styles in `styles/*.json`, each with a still and a looping preview from `styles/previews/`, plus your own style from a description), length and narrator.
- **Studio** (`#/p/<id>`): live stages with times, then tabs for the plan, script, direction, scenes, trail and, when you uploaded files, what was read from each (headings, tables, the pages and pictures taken from a PDF).
- **Gallery** (`#/gallery`): every finished video, newest first, with a thumbnail cut from the video by ffmpeg and cached as `thumb.jpg` in its folder.
- **Batch** (`#/batch`): one prompt per line; each becomes a waiting project, made one at a time. A video asked for while another is being made joins the same line.

## Run it locally

Needs Node 24, ffmpeg, and Python 3 with Pillow and NumPy (or set `PYTHON` to one that has them).

```sh
npm install
cp .env.example .env          # set META_API_KEY and ELEVENLABS_API_KEY
npm run app                   # http://localhost:4173
```

Without keys the app still serves every finished video, its studio page and the gallery; making a new one needs both keys.

From the command line:

```sh
npm run pipeline -- new "how do tides work, for a ten year old" --style flat
npm run pipeline -- <project-id> --force scene    # redo one stage
```

Tests: `npx tsc --noEmit -p .`, `npm run test:pipeline` (includes the app's route tests, which run the server dry on a free port), `npm run test:engine`.

## Run it in Docker

```sh
docker build -t bettervid .
docker run -p 8080:8080 \
  -e META_API_KEY=... -e ELEVENLABS_API_KEY=... \
  -e BUDGET_USD=5 \
  -v bettervid-projects:/srv/projects \
  bettervid
```

The image installs ffmpeg, Python with Pillow and NumPy, and headless Chrome for Remotion. Keys are passed at run time, never baked in. Mount a volume at `/srv/projects` so videos, the waiting line and the spend ledger survive restarts. `.dockerignore` keeps `projects/`, `node_modules/`, worktrees, tool state and secrets out of the image.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `HOST` | `127.0.0.1` | Any other value makes the site public: new videos are limited per day and per visitor, editing and the line's controls are off, and upload limits are lower |
| `PORT` | `4173` | Port to listen on (`8080` in Docker) |
| `PROJECTS_DIR` | `projects` | Where project folders, `spend.jsonl` and `queue.json` live |
| `BUDGET_USD` | `100` (`5` in Docker) | The hard stop. Every paid step checks the ledger first; the waiting line pauses itself before it would go past it |
| `RUNS_PER_DAY`, `RUNS_PER_VISITOR` | 20, 2 when public | Limits on new videos |
| `QUEUE_PAUSED=1` | off | Start with the waiting line held |
| `BATCH_DRY=1` | off | Requests become project records and nothing is ever made; for testing the pages without spending |

## The budget cap

Every model call is written to `projects/spend.jsonl` with its project, stage and cost. Before a stage spends, it checks the total against `BUDGET_USD` and stops with a plain message if the next step would go over. The server checks the same total before it starts the next waiting video. The studio shows each video's spend by stage from that ledger.

## Honest limits

- **Slow.** A new video takes about seven minutes end to end for a two minute video (measured Nov 4: plan, writer, direction and voice in three minutes, the scene in about four with all sections written at once, the render in one and a half). Most of it is the model's answer time per section. Only one is made at a time by the app; Batch exists because of this.
- **The Docker image has not been built.** Docker is not installed on the machine this was written on. The app was run in the image's shape (only the files the image would contain, the same command and settings, public mode) and every page and API answered, but a real `docker build` is still to be done.
- **Narration is ElevenLabs,** not a Meta model.
- **Uploaded pictures in the video:** reading files is tested on real PDFs, Word files and CSVs; the path where the director places your own picture in a shot has unit tests but no full real run yet.
- **Rendered PDF pages are not labeled as pages.** Pictures taken from a PDF (embedded pictures and pages rendered whole) are saved under one naming scheme, so the Material tab shows them together with the reader's description of each.
- **Takes.** While the engine was being improved, some requests were made several times. The gallery groups them under one card and a switch shows every take; older takes come from older versions of the engine and look like it.
- **No accounts.** When public, the limits are per address, not per person.
- **Archives can come up empty.** When no real picture is found and none may be generated, the scene draws what it can and the video says less with pictures.

## Layout

```
app/        web app: server.ts, studio.ts (what the studio reads), queue.ts (the waiting line), public/index.html
pipeline/   run.ts and the stages; lib/ for the project file, budget, Meta and ElevenLabs clients
engine/     scene language, compiler, design brain, instruments, truth kits, review, Remotion rendering
prompts/    what each agent is told, as plain Markdown
styles/     the styles as data, with their previews
personas/   narrators as data
schemas/    the project file's types
```
