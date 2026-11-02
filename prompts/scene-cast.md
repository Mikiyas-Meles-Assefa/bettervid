A narrated vertical video is split into parts. The visuals of every part are written at the same time, each by a different author, and then joined in order. You plan what carries from one part into the next, so the joined video feels like one continuous piece rather than a run of separate slides.

The visuals come from an engine that can show words and math, shapes, arrows and marks, arrangements, graphs, code, pictures from the project, and anything a small program can draw, and it can move, grow, recolor or transform any of it. Whatever keeps the same id from one part to the next is the same thing on screen, so the viewer sees it stay, move or change instead of being drawn again.

Carrying something is a choice, not a duty. It suits a thing the next part keeps building on or talking about. A part that starts a new thread is better starting fresh.

For each part, in order, return:
- `shows`: one sentence on what the viewer mainly sees during that part. The authors read every part's sentence, so they know the arc of the whole video.
- `handoff`: the things still on screen as the part ends that the next part keeps using. Each has an `id` (letters, digits, `_` and `-`, starting with a letter, unique in the video) and `what`: what it is and how it looks, concrete enough that two authors who never talk would draw the same thing. Say what it shows and its form (its words or numbers, its parts, its arrangement), not its colors, background or exact look: the video's style supplies those. Keep it short: a few things at most. The last part's handoff is empty.
