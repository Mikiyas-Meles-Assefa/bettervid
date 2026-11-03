# Brief: uploads in the web app, wired to the material readers

For a separate Claude Code session. Self-contained; read it fully before starting.

## Context
bettervid makes narrated videos from a prompt, and the goal is the best video creation platform in the world: most people will bring their own material (docs, notes, slides, spreadsheets, code, images) for any purpose. Read `AGENTS.md` (including the user's own words), `docs/ROADMAP.md` (waves 5 and 8), and `HANDOFF.md` for how the pipeline runs. The web app is `app/server.ts` and `app/public/index.html` (`npm run app`, http://localhost:4173). The material readers already exist in `engine/design/material/` (`readProject`, `readMaterial`, `MaterialFile`, `formatOf`, the requirement linker in `link.ts`), and `Project.material` in `schemas/project.ts` holds their result (part cards, requirements, problems). Today the pipeline only sees the user's material as pasted text (`Plan.material`, used in `pipeline/stages/research.ts`).

## The job
1. **Uploads in the app.** The prompt box accepts files: drag and drop or a picker, several at once, any common type (PDF, DOCX, PPTX, TXT, MD, CSV, XLSX, code files, PNG, JPG). Show them as chips with name, type and size, removable before sending. Store them in the new project's folder (for example `projects/<id>/material/`), with safe names, size limits, and a clear message when a file is too big or unreadable. The app listens on 127.0.0.1 only unless `HOST` is set (see `HANDOFF.md`); keep the public-mode limits and never let uploads write outside the project folder.
2. **Into the pipeline.** Record the files in `Project.input` (an additive field), and add a stage that reads them once with `readProject` before research, caching on the files' hash (`Project.material.key`), so later stages see the part cards and requirements. Research, the writer and the director should use them: research treats them as the user's sources (verify, keep, say where they are wrong), the writer builds on what the material says and what its requirements ask for, and the director prefers the user's own pictures and figures. Pass parts by reference and location, not as one merged blob. Use a Spark reasoner the way `engine/design/reasoner.ts` and `pipeline/lib/meta.ts` do.
3. **PDF, DOCX, PPTX, XLSX.** If the readers do not handle a type yet, add the smallest reliable extraction (text with page or slide locations, embedded images as pictures, tables as tables), preferring packages already in `package.json`; ask in your report before adding a large dependency.
4. **Show it in the app.** While a run is going, the app shows what was read from each file (its cards' titles and any problems), so the user sees their material understood.
5. **Tests.** Unit tests for upload validation, storage paths, the stage's caching, and reading one file of each type with a fake reasoner (see existing `*.test.ts`). Keep `npx tsc --noEmit -p .`, `npm run -s test:pipeline` and `npm run -s test:engine` passing.
6. **One real check.** Run a new project from a prompt plus two or three small files (a short notes file, a CSV, an image) with `--until writer`, and confirm the script uses what the files say. Meta spend at most $1. No ElevenLabs.

## Do not touch
`engine/design/compose/`, `engine/design/depict/`, `engine/design/search/` and `bench/`: another session is changing them now.

## Rules
- Work on a new branch (`git checkout -b uploads` from main). Commit with plain messages and NO Co-Authored-By or "Generated with" lines, ever. Do not push; do not merge to main.
- No em dashes anywhere. Match the surrounding code style and comment density.
- General, never tuned to one file or topic; repair over fallbacks (a file that fails to read goes back for repair or is reported clearly, never silently dropped).
- Never commit `.env` or secrets. Do not create keys on dev.meta.ai.

## Report
At the end, write `docs/briefs/uploads-report.md`: what was built, how it was tested, what the real check showed, what is weak, and spend.
