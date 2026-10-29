# S4: SAM 3.1 cutouts from photos, paintings and illustrations

Date: 2026-10-29. Script: `scripts/spikes/s4-sam-cutouts.ts`. Sources, masks and cutouts: `media/spikes/s4/` (gitignored), log `media/spikes/logs/s4.log`.

**Verdict: PASS with conditions.** Every mask SAM returned had clean edges (hair, beards, clothing, painted brushwork), on photos, paintings and illustrations alike. The risk is concept matching, not edge quality: 2 of 10 first-try phrases returned nothing, and one fixed with a rephrase.

## Method
- 10 images, one noun phrase each: 2 public-domain photos (Einstein portrait, Migrant Mother), 3 public-domain artworks (Van Gogh self-portrait, Vermeer's Milkmaid, Hokusai's Great Wave) from Wikimedia Commons, and 5 Muse Image outputs from S2 and S3.
- `sam-3.1` on `/v1/responses`, image inline as a JPEG data URL, `include_confidence: "true"`, `mask_encoding: "lossless"`. Masks decoded with Meta's `@meta-sam/parser` (`parseImageStream` + `decodeMaskToRaster`), upscaled to the box and used as alpha.

| Image | Phrase | Result | Confidence |
|---|---|---|---|
| Einstein (photo) | man | clean, wild hair kept | 0.96 |
| Migrant Mother (photo) | woman | clean edges, but also returned the child on the left as a second "woman" | 0.85 / 0.65 |
| Van Gogh (painting) | man | clean | 0.97 |
| Vermeer (painting) | woman | clean; the jug she holds is excluded (correct) | 0.93 |
| Hokusai (print) | wave, great wave | nothing | n/a |
| Hokusai (print) | boat | 3 boats, clean | 0.86 |
| Ama close-up (illustration) | woman | clean edges, but the magnifier lens became a hole over her eye | 0.75 |
| Ama in lab (illustration) | woman | clean; flask excluded | 0.70 |
| Anime doctor | man | clean | 0.97 |
| Retro doctor | man | clean | 0.95 |
| Collage | water pump | nothing | n/a |
| Collage | pump / man | both clean, white photo border excluded | 0.53 / 0.96 |

## Findings for the pipeline
- **Phrases:** use short concrete nouns ("man", "pump", "boat"). On zero matches (empty output, not an error), retry with a simpler synonym. Big natural forms like waves may never match; fall back to a full-frame shot.
- **Holes:** objects in front of the subject (a lens, a held item) are cut out of the mask. For person cutouts, fill interior holes before use.
- **Extra objects:** a phrase can return several objects. Take the highest confidence one, or the biggest, unless the shot wants all.
- **Mask size:** lossless masks come back at most 1024 px on the long side, cropped to the box. Upscale to the box size; edges still look clean at 1080x1920.
- **Mask format:** a custom base85 plus context-model range coder. Don't hand-roll it: use `@meta-sam/parser` (installed, v0.1.0). It needs a Responses event stream, so non-streamed replies are wrapped as one delta (see the script).
- **Latency:** usually 2.5 to 13 s, but two calls took 68 s and 118 s (one after an `EPIPE` retry). Run cutouts in parallel and set timeouts.
- `usage` reports 0 tokens and `images_processed: 1`.

## Cost
- 14 calls at $0.0025, about $0.035.
