# Brief: the request layer (your material, research, the plan)

For a Codex session on the Pro account. Start a new branch `request` from main. Work in a git worktree inside the repo (`git worktree add .worktrees/request -b request main`), never in the main checkout. Read `AGENTS.md`, `docs/ROADMAP.md` (the "Wave 5" section), `docs/briefs/uploads.md`, and `docs/briefs/uploads-report.md` (its "What is weak" list) first.

The goal: a person brings their own material (project files, PDFs, slides, docs, spreadsheets, notes, images, links) or just a prompt, for any purpose, and the video is planned from what they brought, faithful to it, with every claim grounded. Today this layer is about 40 percent of the way there. The bar is 90.

## Where the code is
- `pipeline/stages/material.ts` and `pipeline/lib/material.ts`, `pipeline/lib/uploads.ts`: reading uploaded files into cards.
- `pipeline/lib/reasoner-meta.ts` and `engine/design/material/`: the file reasoner that reads a file with Muse Spark.
- `pipeline/stages/research.ts`, `prompts/research.md`: sourced facts from the web.
- `pipeline/stages/plan.ts`, `prompts/plan.md`: reading what the user wants.
- `pipeline/stages/writer.ts`, `prompts/writer.md`: the script (only where requirements need to be enforced on it).
- `app/server.ts`, `app/public/index.html`: uploads in the web app.

## Build, in this order

1. **Your material, read like a skilled researcher would.** One reader per file type keeps every piece with its location (page, slide, sheet and cell, line). Each source gets a cached source card written by a small agent: claims with locations, figures and what they show, tables and their data, equations, code, terms, steps. Figures are read with vision and the description must agree with the words on the page (the uploads report names a chart described as having no labels). Long files are not cut from the end: cards are layered (sections, then the file), so nothing past a character limit is silently lost. Real PDF, PPTX with notes, XLSX with data and DOCX with tables, made with the tools on this Mac, must read correctly.

2. **The project graph.** A linker, not one merged input. Nodes are sources and their parts; edges are relations an agent finds and checks: a syllabus topic covered by a slide, a rubric weight, a brand guide that applies to every frame, a newer version replacing an older one, a chart that shows a data file, two sources that disagree. Each source gets a role from what it is and how it is used (content, requirement, constraint, evidence, asset), never from its file name. Conflicts are flagged to the user, not resolved silently. The graph is saved with the project.

3. **Requirements, enforced.** From the graph, the planner writes the video's requirements: cover this, show this exact figure, say this claim, never say that, use these colors. After the writer, each requirement is judged by the reasoner against the script and the shot plan, and an unmet one goes back to the writer for repair (one round). Nothing is checked by string matching alone.

4. **Research that cites.** Every fact the research stage returns carries its source (URL or the user's file and location), and the writer is told which facts are from the user's own material and which are from the web. Facts from the user's material win when they disagree with the web, and the disagreement is reported. Searches that find nothing are rewritten and retried once, from what came back.

5. **The plan reads intent.** From the request and the graph: purpose, audience, platform, what the viewer should know or do at the end, what must appear, the length the story needs. Any kind of request, for any purpose (a lesson, a pitch, a product update, a recipe, a memorial, a lab method). No fixed list of video types. The plan is passed on so each later stage gets only its part.

## Real checks
Run two short projects (about 30 seconds each) all the way to a rendered video, with real Muse Spark in every product role:
- a prompt plus a PDF with at least one chart, a slide deck with notes, and a spreadsheet, where the slides say what matters in the PDF;
- a prompt plus two sources that disagree on one number.
Look at the frames and the script yourself: the right figure appears, the requirements are met, the disagreement is flagged. Record paths and spend.

## Do not touch
`engine/` except `engine/design/material/`; `pipeline/stages/scene.ts`, `direction.ts`, `mix.ts`, `render.ts`; `pipeline/lib/kit.ts`, `sound.ts`; `pipeline/run.ts`, `pipeline/lib/meta.ts`, `util.ts`, `project.ts`, `scheduler.ts`, `timing.ts`; `prompts/engine-language.md`, `scene*.md`, `taste-review.md`, `art-direction.md`.

## Rules
- Commit with plain messages and no Co-Authored-By or "Generated with" lines, ever. Do not push; do not merge.
- No em dashes anywhere. Match the surrounding code style.
- General, never tuned to one file or topic. Repair over fallbacks: a file that fails to read goes back for repair or is reported clearly, never dropped silently. Zero hardcoding of what a video should be.
- Keep `npx tsc --noEmit -p .`, `npm run test:pipeline` and `npm run test:engine` clean. New behavior gets tests with a fake reasoner.
- Never commit `.env` or secrets. Do not create keys on dev.meta.ai.
- Spend: Meta at most $4, ElevenLabs only for the two real checks.

## Report
At the end, write `docs/briefs/request-report.md`: what was built, how it was tested, what the two real checks showed (paths to the videos), what is still weak, and spend.
