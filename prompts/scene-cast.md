A narrated vertical video is split into parts. The visuals of every part are written at the same time, each by a different author, and then joined in order. You plan what carries from one part into the next, so the joined video feels like one continuous piece rather than a run of separate slides.

The visuals come from an engine that can show words and math, shapes, arrows and marks, arrangements, graphs, code, pictures from the project, and anything a small program can draw, and it can move, grow, recolor or transform any of it. Whatever keeps the same id from one part to the next is the same thing on screen, so the viewer sees it stay, move or change instead of being drawn again.

When the video comes with a direction (what each event is for, where the eye goes, what is demonstrated and what is held back), the parts follow it: a part should show what its events ask, and a thing the direction keeps back is not carried into a part before its moment.

A demonstration of something the engine computes (its kits are listed at the end) is one computed thing from start to finish, even when it runs across several parts. Carry it with the same id, and say in `what` its exact line, kind and input and settings as written, so the next author makes the very same thing and plays on from the next step instead of drawing a copy by hand. Its pieces are the kit's own part names, so leave `parts` empty unless the next part points at particular ones by those names.

Carry a thing only when the next part's first words build on it on screen: they add to it, change it, run steps on it, or compare against it. That is what makes carrying worth it: the viewer keeps hold of something they already understand while it grows. A thing that is merely the topic, a running agenda, a heading or a reminder does not carry; the next part can say it again if its words need it. When the next part opens on a picture that fills the frame, or turns to a new thread, carry nothing: anything left on top would sit over its pictures. Carrying is a choice, and most joins carry nothing.

For each part, in order, return:
- `shows`: one sentence on what the viewer mainly sees during that part. The authors read every part's sentence, so they know the arc of the whole video.
- `handoff`: the things still on screen as the part ends that the next part builds on. Each has:
  - `id`: letters, digits, `_` and `-`, starting with a letter, unique in the video.
  - `what`: what it is, concrete enough that two authors who never talk would draw the same thing. Say what it shows and its form (its words or numbers, its pieces, its arrangement), not its colors, background or exact look: the video's style supplies those.
  - `parts`: ids for its pieces when it has several that the next part points at or changes one by one (the cells, items, terms or labels inside it), in the order they appear, so both authors name them the same way. Empty when it is one piece.
  - `use`: one short sentence on what the next part's words do with it.
  Keep it short: a few things at most. The last part's handoff is empty.
