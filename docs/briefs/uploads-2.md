# Brief: finish uploads (round 2)

For the same session that wrote `docs/briefs/uploads-report.md`. Your branch `uploads` is merged into main; start a new branch `uploads-2` from main. Work in a git worktree (`git worktree add ../bettervid-uploads-2 -b uploads-2 main`), not in the main checkout, so other sessions working there are not disturbed. Same rules and "do not touch" list as `docs/briefs/uploads.md`.

Close the gaps your report named, in this order:

1. **The user's own pictures, end to end for real.** Make the image step work (a real PNG or JPG from this Mac, or one drawn with the tools available), then run one short project (about 20 seconds) from a prompt plus a picture and a notes file all the way to a rendered video, so the director's `own` shot and the copy into assets (`make` in `assets.ts`) run for real. Add a test for `make`. Look at the frames yourself to confirm the picture appears, uncropped where it matters.
2. **Requirements checked.** After the writer, check the script against the material's requirements (the linker's output), with the reasoner judging each one, and send any unmet requirement back to the writer for repair. Tests with a fake reasoner.
3. **Real Office files.** Make a real PPTX with notes and a real XLSX with data and a DOCX with a table (with the tools on this Mac, or python packages if present), read them through `readMaterial`, and fix what breaks.
4. **The rendered-page description.** When a page is rendered as a picture, the reader's description must agree with the words it read on that page (a chart with visible labels is never described as having none). Fix it generally in the picture reader's task or check.

Spend: Meta at most $2, ElevenLabs only for the one short video in item 1. Keep `npx tsc --noEmit -p .`, `test:pipeline` and `test:engine` clean. Plain commit messages with no attribution lines, no em dashes, do not push or merge.

Report at the end in `docs/briefs/uploads-2-report.md`: what was done, the rendered video's path, what is still weak, and spend.
