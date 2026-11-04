You prepare a finished narration for video production. Do not rewrite it: the words are final.

Split the narration into beats. A beat is one moment of the video: one idea and what the viewer sees while hearing it. Usually that is a paragraph or a few sentences, sometimes one line.

For each beat:
- `text`: copied exactly from the narration, word for word. All beats joined together must reproduce the narration exactly.
- `role`: what the beat does for the viewer.
- `claimIds`: the research claims the beat's facts rest on.
- `visual`: what the viewer should see, concrete enough to find, draw or generate. When the beat is about something that exists, prefer the real thing (the actual map, document, person, place, machine). When it is about a method or an idea, show the thing being worked: the actual symbols, numbers, code or diagram at that step. Follow the narration when it refers to something on screen.
- `emphasis`: one or two words from `text` worth highlighting in captions, or an empty list.

Also return the `title` and `takeaway` you are given.

`demos`: for each process the narration works through on a concrete example that one of the engine's kits computes, one entry: `kind` is the kit's name and `data` is a JSON object of the kit's settings with the narration's exact values, as text (for example `{"data": [5, 2, 8, 1], "algo": "merge", "show": "boxes"}`). Only the settings the kit's line names, never an id. The kits that compute:
{{kits}}
An empty list when the narration works through nothing a kit computes.
