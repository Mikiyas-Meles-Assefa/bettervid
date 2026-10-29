# SAM 3.1 API
URLs: https://dev.meta.ai/docs/media-segmentation , /docs/sam/overview , /docs/sam/segmenting , /docs/sam/reading-segmentation (retrieved 2026-10-29)
- model sam-3.1 via POST /v1/responses, stream recommended. Concept prompt: input_text short noun phrase, one concept per request. Media input_image or input_video (MP4/MOV H.264/H.265/MPEG-4; no VP9/WebM); file_id or url.
- Object prompts grammar: <Nf>ID<|box;x1;y1;x2;y2;w;h|> or <|point;x;y;w;h|> with leading - for negative points; helpers buildObjectPrompt / build_object_prompt. Cannot mix phrase and object prompts. Max 16 objects. Video up to 15,000 frames. metadata.propagation_direction both|forward|backward; metadata.include_confidence "true"; metadata.mask_encoding lossless(~)|one_bit(!).
- Output text lines: <Nf>id<|box;...|><|mask;x=0;y=0;data=H,W,<enc>payload|>, base85 payload, not RLE; parsers @meta-sam/parser >=0.0.13, python meta-sam-parser >=0.0.6; decodeMaskToRaster gives H*W uint8; COCO RLE/SVG conversion via client libs. Mask raster smaller than frame (e.g. 27x60 example) so upscale.
- Zero matches = empty output, not error. Price $2.50/1k images, $0.20/1k frames (min 50).
- HF facebook/sam3.1: license "other" (SAM license), gated, checkpoints only, Object Multiplex, ~7x faster at 128 objects on H100, code at github.com/facebookresearch/sam3. https://huggingface.co/facebook/sam3.1
