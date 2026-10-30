# Fixes log

Fixes and ideas the user raised while reviewing test videos. All are open unless marked. Every fix must be a general rule that works for any topic, request and style, never a patch for one video, and tools are options: having a tool does not mean using it.

## Raised by the user (Oct 30)

1. **Length is not limited to 60 s.** 60 s is only a test default in `pipeline/run.ts`. Make "as long as the story needs" (`seconds: 0`) the default, so the story decides unless the user asks otherwise. The website ranges (under 1, 1 to 3, 3 to 5, 5 to 8 minutes, custom) stay optional. Check that long videos hold attention: the Rosetta Stone test ran to about 6 minutes.

2. **Pointing is not only circles, and not only maps.** Annotation works on any image: a person in a photo, a detail in a painting, a word in a document, a part of a machine. Zoom and annotation are separate choices, and most shots need neither. Spark decides from the image and the words.

3. **A full drawing toolset.** Arrow, connecting line, underline, box, highlight, dots, tally marks and numbers appearing one by one, labels, freehand paths. Marks draw themselves in time with the spoken words.

4. **Style also means how the video moves.** A style sets how shots connect as well as how they look. Whiteboard style: one huge canvas, everything drawn or placed as the narration goes, and the camera zooms in, slides across, zooms out to show connections, then goes in elsewhere. Build a canvas and camera that both cut-based and one-take videos can use, so whiteboard is a style file and not a rewrite. `styles/whiteboard.json` exists today.

5. **Simulations where applicable.** A fixed toolset cannot cover everything (waves cancelling, orbits, a virus spreading), so where a simulation would explain something best, Spark writes a small animation program for that moment, ideally running the real rules so the behavior emerges on its own. The user does not like fallbacks: when a program breaks or looks wrong, Spark sees the error or the frames and repairs it, instead of swapping in a still image. On the hosted site it runs locked down with no internet access.

6. **Generated images should not be made of paper.** The ear in the headphones video was built from torn paper, because the collage `artPrefix` is added to every image, and a human editor would not do that. Separate subject from surface: generate a clear subject, and add paper, grain and edges with our own video layers. The director marks each image as a scene, object or diagram, and each style defines how to treat those types. Diagrams stay clean, because their point is understanding. Test: current look against new look on the same subjects, about $0.06.

## Found while reviewing

7. **Accuracy in the review step.** The headphones video says "You erase just the air between the speaker and your eardrum", but headphones cancel sound, not air. The review should catch lines that trade accuracy for poetry.

8. **Image fit.** A fighter jet engine stood in for a passenger plane's engine. The picker should reject a real image of the wrong kind of thing. In John Snow v3 it also rejected an image on the first search, then accepted the same image on the broader search.

9. **Too much of one image.** The map filled 12 of 22 shots in John Snow v4. The user asked for it often, but it gets repetitive.

10. **Title cards.** Three black cards in the first 30 s of John Snow v4 is more text than it should be.

11. **Never generate writing that is meant to be read.** At least 4 shots in the Rosetta video use AI-generated hieroglyphs, including the "Ra-M-S-S" moment where the code gets cracked. Generated writing is gibberish, in a video about reading it. The must-be-real rule should have caught this. General rule for any script, language, document or sign: show it from a real source or draw it ourselves with real characters.

12. **Variety when a video has one main object.** The stone appears a lot in the first third of the Rosetta video. Related to item 9.

13. **Torn-paper look, again.** Several Rosetta images have it. See item 6.

14. **Do long videos hold attention?** Rosetta runs 5:40. Not known until someone watches it.

15. **File size.** The Rosetta video is 378 MB, far too big for the web app. Compress the final video.

16. **Real but silly images.** John Snow v5 opens on a toy model of a horse and cart. It passed every rule because it is a real object. The picker should reject models, toys and replicas unless the narration is about them.

17. **One image repeated when the real ones run out.** The Linear B tablet fills 7 of 15 clips, because Kober, Ventris, the map and the grid were all marked must-be-real and not found. Reuse should not keep picking the same image, and an honest illustration of the idea (not a likeness or a fake document) may be better than a repeat.

18. **Paper layer speckles.** The new `paper.png` shows as dirty specks on pale cards and paper backgrounds. Make it subtler.

19. **Duplicate title cards.** "180,000" appeared twice in Linear B: a filled gap came first, then the director's own title. The duplicate check only looks backward.

20. **Loosely related real images.** A medieval manuscript of the Crucifixion stood in for "the way Latin swaps endings".

21. **Independent review of the moon video (Spark 1.2, with sound): 7.5 of 10.** Narration clear over music, pictures in step, and it understood the explanation. Weak spots: the voice is a little flat and obviously synthetic, captions split awkwardly across cards, and the origin-story part at 0:24 is where a casual viewer might leave.

22. **Not built yet.** A real hosted deploy (the `Dockerfile` is unbuilt), style switching from the page, and simulations with a frame review.

23. **Whiteboard: live board rebuilt.** Empty at first, words written and drawings sketched as they are said, a camera following the thinking. Spark plans scenes and layouts; code does the layout (`pipeline/stages/board.ts`). The user said to make it far better; the latest version needs their review. Drawings now explain better (the moon video). Still weak: arrows in the "cycle" layout cross labels, and a scene can look thin just after the camera arrives.

24. **Generated faces of real people.** Director and critic rules added. On the Taytu re-run the critic caught the Menelik face and the frames now show his real portrait; keep watching for it.

25. **The paper overlay covers photos.** The blotches were a bug and are fixed, but the user questions any layer over photos. Waiting on their call to remove it from images.

26. **Staying on the topic.** The cut swapped "Taytu's role in Adwa" for the siege of Mekele, and a soft rule did not fix it. `prompts/cut.md` now names the subject first and must spend most of its time inside it. Tested on this one video only.

27. **Math on the board.** The Cramer's rule request produced a balloon and a sailboat and no matrix, because the board could only draw pictures. It now has real notation (matrices, determinants, fractions, highlighted columns) and a "work" layout, and abstract topics must show the real thing. Tested on that one request. Code, graphs and tables still have no real rendering.

## Done (Oct 30)

- Default length is story-led (1). Annotation and the drawing toolset on any image (2, 3). Board format and whiteboard motion (4), first version. Clear look by image type (6). Accuracy in the review (7). Picker stricter on kind of thing, models and loose matches, with no second chance for a rejected image (8, 16, 20). Fake writing checked and redone (11). Reuse capped per image, honest illustrations for gaps (9, 12, 17). Compression (15). Paper and grain softened (18). Duplicate titles (19).

- The plan step reads any kind of request, and each stage gets only its part (`c078969`).
- Story-led pacing, readable source cards, no visual spoilers (`c078969`).
- Guided zoom on real images, no fakes of specific real things (`c078969`).
- Rings land more precisely, and text-heavy images are rejected (`18b7649`).
