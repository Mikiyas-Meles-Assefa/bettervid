# Review of the first three engine videos (Nov 2)

Three requests run end to end on the engine: standard deviation for an exam (chalkboard), merge sort (neon), the Wright brothers (collage). Frames checked every 3 to 4 seconds, then each problem traced to its cause.

The user's verdict: chalkboard good apart from visual issues; neon good teaching (slow first merge, then faster, then the general case) with visual issues; collage very bad.

## Problems and causes

| # | Problem | Seen in | Cause |
|---|---|---|---|
| 1 | Content sits in the top half; the bottom is empty | all three | Layout fits content by width, so tall phone frames are never filled |
| 2 | Sizes jump between states; a table shrinks right when the answer arrives | stats, merge | Layout re-fits the whole screen at every state, so adding a row rescales everything |
| 3 | Light card with light text, nearly invisible | stats | `back=paper` on a dark style is drawn by the chalk pen as a pale fill; nothing checks text contrast against what is behind it |
| 4 | Faded, washed-out frames | all three | `dim` and `focus` used on most states; even at 0.45 to 0.55 the screen looks greyed |
| 5 | Text on text: titles over labels, old text fading out under new text | all three | Collision checks cover tags and labels only, not laid-out text against pinned items, images or leaving items |
| 6 | Text written straight onto photos, unreadable | collage | Text over a picture has no backing unless the scene asks for one |
| 7 | Text cut off at the frame edge ("200 shapes tes") | collage | The camera zooms after layout; layout does not know the camera will crop |
| 8 | The subject cropped out of the photo: the famous first-flight photo shows only sand and a bench, a ring circles empty sky | collage | `frame=fill` cover-crops a wide photo into 9:16 at the center; the annotate stage's focus box is not used to choose the crop |
| 9 | A picture inside a card shows as a blank card | collage | The card's background is drawn above the picture inside it |
| 10 | One card bar ("three problems") sits over every photo for 30 seconds | collage | Objects handed across sections stay on screen as overlays |
| 11 | Small pictures floating on a big beige page with a heavy vignette | collage | Pictures placed inside layout as small items instead of filling or framing |
| 12 | Wrong or odd pictures: a bullet shape for "home to Dayton", a modern-looking engine, a clip-art icon | collage | Picture check accepts wrong kinds and mismatched styles |
| 13 | Generated stand-ins for real things: a map, the brothers' workshop with made-up faces, a glider in a desert, tracks in sand | collage | When the real image is not found, the "illustrate the idea" path generates scenes that read as the real event |
| 14 | Label contradicts the narration ("1902 glider" while "the 1903 Flyer" is said); a table of lift numbers with no source | collage | Nothing checks on-screen text against the words or the research |
| 15 | Pointer icons and notes too small to read | merge | Emoji and note sizes below the readable floor are not caught |
| 16 | The sort drawn by hand instead of computed | merge | Spark chose boxes over the `sort` kit |
| 17 | x instead of x̄ in a formula | stats | Formula typed as plain text instead of math |
| 18 | The frame check passed all of this | all three | 6 small stills per section; in the collage run every section was "changed" twice, so the check rewrote rather than converged |

## Missed in the first pass: the styles themselves (raised by the user)

The first pass judged correctness and readability, not whether the videos look good. They do not.

| # | Problem | Seen in | Cause |
|---|---|---|---|
| 19 | The collage style is unattractive overall: beige paper, a heavy dark vignette, plain serif text dropped onto photos with nothing behind it, generated clip-art beside archival photos. It does not look designed and is not enjoyable | collage | The style has no design for text on pictures, for mixing real and generated images, or for its page; it was never judged on looks |
| 20 | Dimmed things in neon turn flat grey-blue, so lit and dimmed parts look like two different styles | neon | Dimming is plain opacity, not something each style defines for itself |
| 21 | Cream cards inside the chalkboard (a white board on a blackboard) with yellow text that is invisible and ugly | chalkboard | `back=paper` is drawn as a pale chalk fill, and nothing in the style says which colors may sit on which surface |

Every style needs a design pass: how text sits on pictures, what dimming looks like in that style, what a card or panel is, color pairings that always read, and how generated pictures match real ones. The frame check must judge "does this look good and fit the style", not only "is it readable".

## After wave 1 (user's verdict on the reruns)

Same scripts and voices, new visuals. Style clearly improved but is about 60 to 65% of where it should be; the user would not pick neon for anything, though others might. Teaching got worse in merge sort: the first version used fingers moving along the lists and a slow first merge, which held attention; the rerun only talks about dividing and never shows it, and four numbers is a poor example for showing a sort. The good pacing in the first version was luck: nothing plans it, and the example comes from the writer. This is wave 2 (direction: plan what to show, how slowly, where the eye goes, demonstrate rather than describe, and choose examples that make the idea visible). Remaining frame bugs from the reruns (blank frame, a bar over math, squashed tables, math in a foreign font, titles at the frame edge, ghost fades, labels over boxes, empty and crowded frames, repair loops that do not converge) are being fixed before wave 2.

## What went right

- Scripts fit each request (no history for the exam, mechanism for merge sort, a real "why they succeeded" story).
- Merge sort paced well: first merge step slow with "copy 27", then "same on the right", then the final merge one take at a time. This came from the script and Spark's scene, not from any planned tempo, so it is not reliable yet.
- Stats built a table one column at a time and boxed the total; the arithmetic is right throughout.
- Archival photos, cut-outs and rings work on the engine.

## Grouped by where the fix lives

- **Layout and drawing (engine):** 1, 2, 3, 5, 7, 9, 11, 15.
- **Pictures (engine and assets):** 6, 8, 12, 13.
- **Scene writing (scene step):** 4, 10, 16, 17.
- **Checking (review):** 14, 18, and judging looks (19 to 21).
- **Style design:** 19, 20, 21.
