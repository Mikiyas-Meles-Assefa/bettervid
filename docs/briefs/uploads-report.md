# Report: uploads in the web app

Branch `uploads`, not pushed, not merged.

## What was built
- **Uploads in the app.** The prompt box takes drag and drop or a picker, several files at once. Each file shows as a chip with name, type and size, and can be removed before sending. A message can be left empty if files are attached. Files wait in `projects/.uploads/<random token>/`, then the run copies them to `projects/<id>/material/` and records them in `Project.input.files`.
- **Safety.** `pipeline/lib/uploads.ts` strips names down to their last segment and safe characters, and refuses any path that leaves the folder. Files are checked for what they really are (picture headers, PDF and Office files actually opened, text has no binary bytes). Older DOC, PPT and XLS, archives, media and SVG or HEIC each get a plain message.
- **Limits.** Local: 100 MB per file, 400 MB per video, 30 files. Public (`HOST` set): 15 MB, 40 MB, 8 files, 500 MB waiting on disk across visitors. Unused files go after 6 hours. Zip and PDF unpacking are capped, and names inside archives are never used as paths.
- **New stage `material`.** It runs first, because the plan needs to know what the files are when the message says little. The brief asked for before research, and this is. It reads through `readProject` with a Spark reasoner and caches on the files' hashes (`Project.material.key`). A file that cannot be read is named in `problems`, shown in the app and passed to later stages. If nothing is readable, the run stops and says why.
- **Extraction.** `zip.ts`, `office.ts` and `expand.ts` in `engine/design/material/` read DOCX, PPTX (with speaker notes) and XLSX (with dates) with no dependency. Text keeps its page or slide location, tables become table cards, embedded images become picture cards.
- **PDF, with a library (added after this report's first version, at your go-ahead).** `pdf.ts` now uses `pdfjs-dist` (Mozilla, Apache-2.0, 37 MB) and `@napi-rs/canvas` (MIT, 29 MB on this Mac), replacing my hand-written parser. It rebuilds the page from word positions: lines by height, prose columns by the empty strip between them, tables by short cells that line up. A page with no usable text (scan, vector-only, font with no letter map) or with a drawn figure is rendered as a picture for the picture reader. Embedded pictures of any encoding come out as PNG. PDFs with an empty password now open.
- **Stages.** Plan gets a short note of the files. Research treats them as the user's sources, with claims citing `file:<card>.<part>`. The writer gets cards, requirements and problems by name and location. The director gets a new shot kind, `own`, and prefers the user's pictures; a wrong picture name goes back for one repair and then fails loudly. The scene stage now keeps uploaded cards and adds its own beside them, without reading uploads again.
- **In the app.** While a run goes, "Your files" lists what was read from each file (its cards, headings, problems). Sources from files show as plain text, not links.
- **Fixed along the way.** The existing table check compared parsed cells ("north, 7") with raw CSV ("north,7"), so any ordinary CSV read through `readMaterial` failed its check. It now compares against the cells.

## How it was tested
- `npx tsc --noEmit -p .` passes. `test:pipeline`: 130 pass, 0 fail. `test:engine`: 516 pass, 0 fail.
- New `pipeline/stages/uploads.test.ts`: validation, limits, storage paths, each type read with a fake reasoner, stage caching, a failed file, nothing readable, long files, the director's own-picture path.
- Real files: a macOS `textutil` DOCX and six real PDFs from this Mac, including a 300-page license in many languages. Curly quotes and Japanese now read correctly. Nine pages whose font has no letter map are rendered and reported, not garbled. Underlines first made pages look like figures; thin rules no longer count.
- Real PDF through the paid `material` stage: a Core Graphics PDF with two columns, a ruled table, a drawn chart and a picture. Columns read left then right under the title, the table came out as a table card with its values, and the chart page and the picture became picture cards ($0.045). This was not run through the writer.
- Browser, against a test server stopping after `material`: picker, drag and drop event, chips, removal, the bad-picture message, a `../../` name, and a run showing "Your files". The drops were simulated by script, not a real drag from Finder.

## What the real check showed
Prompt: "A short video for our cafe customers about how the cup deposit trial went", 45 seconds, `--until writer`, with invented notes and a CSV.
- Every number in the script comes from the files: 71 of 120, 279 of 310, 11 bags to 6, 1.50 euros, Tomasz before nine, "the cup that comes home".
- The linker found both requirements, with their source part. The script ends "please bring a cup back" and never names Brew Barn.
- Research kept the files as sources and added one outside page in the first run.
- Project: `projects/a-short-video-for-our-cafe-customers-abo-f1523d`.

**The image was not in those two runs.** My image step failed both times (no Pillow, then no `drawtext` in ffmpeg), so the check ran with notes and CSV only, and I did not spot it until after. A third run, `--until material`, read a real PNG correctly but did not go on to the writer. So no real run has shown the writer or director using a user's picture.

## What is weak
- **The `own` picture path has never run for real.** It needs the voice stage, which was off limits. The plan and name check have unit tests; the copy into assets (`make` in `assets.ts`) has no test at all.
- **Real PPTX and non-empty XLSX untested.** Those are checked only on files built in the tests. The one real XLSX found has a single empty sheet, and I could not confirm that it really is empty. The `textutil` DOCX held no real table, so real DOCX tables are untested too.
- **PDF layout is judged from geometry, by fixed measures.** Tested on one real Core Graphics PDF and on made-up word positions, so expect misses on real documents. A gutter narrower than about 1.2 line heights is not seen, so those columns merge. A wrapped table cell breaks a table in two. Tables under 3 rows stay as text. A page with 24 or more shapes that have area counts as a figure, so heavily boxed pages may be rendered needlessly, at about a cent each, and a small chart under that count is missed.
- **A rendered page depends on the reader's eyes.** In the real check the chart's page rendered correctly with its words visible, and the reader copied its words exactly, but its description still said the chart had no labels. A later stage reading that description could be misled.
- **Docker untested.** The image should get the Linux canvas build through `npm ci`, but I did not build it.
- **Long files.** The writer gets 60,000 characters and research 120,000 across all cards. Past that, headings stay and the rest is cut in order, with a note saying so, so the end of a long document is what gets lost. The linker gets everything, which costs more.
- **Requirements are not enforced.** Writer and research are told to meet them, and nothing checks the final script. Both held in the real check, but a check step would be better.
- **Pictures cost.** Each costs a reader call (about $0.01), capped at 40 per file. A user picture the director uses is read a second time by the intent author in the scene stage.
- **Public mode.** Uploads have no per-visitor limit beyond token limits and the shared 500 MB, so one visitor can fill the waiting space for a while.
- The heading list in "Your files" was added after the browser check, so it is type-checked but not seen on the page.

## Spend
About $0.48 on Meta for the real check across three runs, plus under a cent for the browser run, against the $1 limit. The PDF check added $0.045, so about $0.53 in all. No ElevenLabs. New packages: `pdfjs-dist` and `@napi-rs/canvas`.
