# Writes a 1080x1920 aged-paper texture used by styles with a paper surface: near white, so it tints an image when
# multiplied over it, with soft blotches and darker, uneven edges.
# Usage: python3 -I make_paper.py <out.png>
import random
import sys
from PIL import Image, ImageChops, ImageFilter

random.seed(2)
W, H = 1080, 1920
# Only broad, soft variation: fine noise reads as dirt on pale areas, and the grain layer already adds texture.
blotch = Image.effect_noise((W // 32, H // 32), 60).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(48))
base = blotch.point(lambda v: 228 + int(v / 255 * 27))
edge = Image.new("L", (W, H), 0)
edge.paste(255, (46, 46, W - 46, H - 46))
rough = Image.effect_noise((W // 8, H // 8), 90).resize((W, H), Image.BICUBIC)
edge = ImageChops.multiply(edge.filter(ImageFilter.GaussianBlur(34)).point(lambda v: min(255, v + 90)), rough.point(lambda v: min(255, v + 150)))
paper = ImageChops.multiply(base, edge.point(lambda v: 150 + int(v / 255 * 105)))
tint = Image.merge("RGB", (paper, paper.point(lambda v: int(v * 0.97)), paper.point(lambda v: int(v * 0.89))))
tint.save(sys.argv[1], optimize=True)
