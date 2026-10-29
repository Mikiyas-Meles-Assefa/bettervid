# Research brief (shared by all research agents)

Today is 2026-10-29. Your training data is older than this, so verify everything with live web search and fetch. Prefer official docs, pricing pages and changelogs. Note when something was retired, renamed or launched recently.

## The project
bettervid: a "director in a box" for the Meta Global AI Developer Hackathon (deadline Nov 4, 2026, 21:00 ET, solo, ~5 build days).
User gives any intent (a prompt, a PDF, a URL, a video). The system outputs a finished, narrated, edited video at the craft level of Veritasium, Kurzgesagt, Johnny Harris, Vox and top IG/TikTok explainers. Portrait (9:16, 60 to 120 s) first, landscape later. Education first, but also stories, history, science, math, social posts and series.

Pipeline hypothesis (to be tested, not assumed):
1. Research: Muse Spark + web search builds a fact sheet with sources.
2. Writer: retention-built script with narrator delivery cues.
3. Director: Muse Wonder plans a JSON shot list.
4. Assets: per beat, an editor agent picks the best source: real web photo/archival, stock or archival clip, "receipt" (headline/tweet/paper), meme/reaction, Muse Image generated art, diagram or code. SAM 3.1 cuts subjects out of anything. One style treatment unifies mixed sources. Depth map for 2.5D parallax.
5. Sound: TTS narration, forced alignment for word timings, music, SFX.
6. Editor: code-rendered timeline (Remotion likely, Manim for math), typography kit, word captions, rendered in parallel (Modal).
7. Critic: Muse Spark watches the rendered MP4 with audio and files per-shot fix tickets.

Rules: Meta models must be the core. External APIs and OSS are allowed if judges need no credentials of their own. Partner-served Meta models (Fireworks, Baseten) count as Meta. Bonus prizes: open weights ($10k), Best Creative with Muse Image/Wonder ($5k), agentic, most viral on X.

## What we need from you
For every tool or model in your topic: what it does, quality (with evidence: benchmarks, arena rankings, reviews, sample links), price (exact units), speed/latency, rate limits, input/output formats, license (commercial OK? open weights? attribution?), API maturity, gotchas, and a verdict for bettervid (use / backup / skip, and why). Compare alternatives, especially cheaper or open-source ones, and anything from Meta.

## Output rules
- Write your summary to `research/<topic>.md` (your topic name is given in your task). Start with a 10-line TL;DR with recommendations, then detail tables, then open questions.
- Every fact gets a source URL and a confidence tag: `[verified]` (official doc you read), `[reported]` (third party), `[unverified]` (inferred).
- Save ground truth: for each important source, save a file in `research/sources/<topic>/<short-slug>.md` with the URL, the date retrieved, and the key verbatim excerpts (pricing tables, limits, API shapes). Not whole pages, just the parts that matter.
- Never use em dashes. Plain, direct English.
- Do not sign up for anything, spend money, submit forms, or use any API keys. Research only.
- Do not edit files outside `research/`.
