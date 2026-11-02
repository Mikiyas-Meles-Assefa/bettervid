# Starting prompt for the engine work

Paste this into a fresh session:

Read AGENTS.md, HANDOFF.md, docs/ENGINE-PLAN.md and docs/FIXES.md, then research/spikes/S12-manim.md if it exists. Also read video/Stage.tsx, pipeline/stages/stage.ts and prompts/stage.md, which are the small engine we are growing from.

We are building the universal engine on top of Remotion. Start with the foundation only: the shared contract for the scene graph, scene language and how kits plug in, so about 6 subagents can then work in parallel without collisions. Prove the contract by sketching the Dijkstra video and a code walkthrough on it. The Cramer's rule video must also fit.

Show me the foundation in plain words before spawning subagents, and tell me what you need from me, including budget and new packages. Do not use Sonnet.
