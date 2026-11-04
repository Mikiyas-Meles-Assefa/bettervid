# Submission (Meta Global AI Developer Hackathon, Indie track)

Deadline: Wed Nov 4, 21:00 ET (Thu Nov 5, 05:00 Doha). Aim for 18:00 ET. Form: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit

## What to paste

**Name:** bettervid

**One line:** A sentence or your own files in, a finished narrated video out, for any purpose: agents on Muse Spark plan it, write it, direct it, draw every scene in a scene language, measure it, review it and repair it.

**Description (about 150 words):**
bettervid is a video creation platform built on an agent-native video engine. You type what you want, or drop in PDFs, slides, spreadsheets and pictures, and get a finished, narrated video for any purpose: a lesson, a pitch, a how-to, a history, an onboarding. Muse Spark does the creative work end to end: it reads your request and your files, researches with web search, writes the script, directs it moment by moment with holds and demonstrations, then writes every scene as text in a small scene language that the engine compiles and renders. Instruments measure what was drawn (fill, legibility, where the eye goes, timing against the words); a reviewer and an art director look at the frames; Spark repairs its own scene once. When a video demonstrates something exact, a kit computes it, so the numbers on screen are right by construction. Muse Image draws what the scene depicts, SAM cuts it into parts that move. Every video keeps its trail: plan, script, direction, frames the reviewers saw, sources, credits, spend.

**Meta tooling:** Muse Spark 1.3 (plan, research with web search, script, direction, every scene, the look review, the art director, repairs, sound cues, file reading, style writing); Muse Image (depicted things and pictures in the video's style, the style previews); SAM 3.1 (cutting depicted things and uploaded pictures into parts). Open weights: none in the loop yet.

**Links:** repository (public), demo video (3 min, unlisted YouTube or a file link), live product (URL once hosted), three showcase videos (files in the repo release or links).

## The 3-minute demo video (record with QuickTime, voice over as you go)

0:00 The problem, 15 s. "Every video tool gives you a template. I wanted an engine that works like a team: research, write, direct, draw, review, fix. And I wanted it to work from my own files."

0:15 Make a video, 30 s. The home page. Type a prompt, pick a style from the seven previews, press Make. Cut to the studio page: stages lighting up, the plan and intent appearing, the script.

0:45 How it works, 45 s. The direction tab: moments, holds, a demonstration with computed steps. The scenes tab: the scene as text in the scene language, next to the frames the reviewers saw, and the art director's notes with the means named. Say: "Spark writes every scene as text. The engine builds it, measures it, and shows Spark its own frames. Spark fixes its own work once."

1:30 Three videos, 60 s. Play 20 seconds of each: a computed demonstration (merge sort or Dijkstra), a lesson with math (Cramer's rule or standard deviation), and one for a completely different purpose (the bakery ad or the onboarding).

2:30 Your own files, 20 s. Drop a PDF with a chart. The Material tab: what was read, the figure, the requirement it set. The video showing that figure.

2:50 Close, 10 s. "Any purpose, your material, a team of agents on Meta's models. bettervid."

## Hosting on Fly.io

Once, on this Mac (needs your Fly account and a card on it; the machine below is about $2 a day while it runs):

```sh
brew install flyctl
fly auth login
fly apps create bettervid
fly volumes create projects --region fra --size 20 --yes
fly secrets set META_API_KEY=... ELEVENLABS_API_KEY=...
fly deploy
```

`fly deploy` builds the Dockerfile on Fly's builder (the image has never been built here, so the first build may surface a missing package; paste the error to me). The site is then at https://bettervid.fly.dev with the public limits on: 20 videos a day, 2 per visitor, a $5 cap.

The hosted gallery starts empty because `projects/` is not in the image. Seed it with the showcase projects:

```sh
scripts/fly-seed.sh <project-id> <project-id> ...
```

Then open https://bettervid.fly.dev/#/gallery and each studio page once to make the thumbnails.

## Before you submit

1. The repository is pushed and public (or shared with the judges).
2. The three showcase videos are reachable: as a GitHub release attachment (under 2 GB) or links.
3. The live product URL answers: `/`, `#/gallery`, one studio page. If hosting is not done, say so in the form and point at the Docker instructions in the README.
4. The demo video is uploaded and the link works in a private window.
5. The form's Meta tooling field names Muse Spark, Muse Image and SAM.
