# Bakes a cutout: source image + SAM mask (PGM, box-sized) -> RGBA PNG with a white outline and soft shadow.
# Usage: python3 -I bake_cutout.py <image> <mask.pgm> <left> <top> <right> <bottom> <out.png>
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

src, mask, left, top, right, bottom, out = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7]), sys.argv[7]
img = Image.open(src).convert("RGBA")
box = (left, top, right, bottom)
crop = img.crop(box)
alpha = Image.open(mask).convert("L").resize(crop.size, Image.LANCZOS)
# Fill interior holes (spike S4: objects in front of the subject get cut out of the mask).
filled = alpha.point(lambda v: 255 if v > 127 else 0)
inv = ImageChops.invert(filled)
pad = Image.new("L", (inv.width + 2, inv.height + 2), 255)
pad.paste(inv, (1, 1))
ImageDraw.floodfill(pad, (0, 0), 0)
holes = pad.crop((1, 1, inv.width + 1, inv.height + 1))
alpha = ImageChops.lighter(alpha, holes)
crop.putalpha(alpha)
crop.thumbnail((1000, 1300), Image.LANCZOS)
p = max(16, crop.width // 28)
w, h = crop.width + 4 * p, crop.height + 4 * p
a = Image.new("L", (w, h), 0)
a.paste(crop.split()[3], (2 * p, 2 * p))
outline = a.filter(ImageFilter.MaxFilter(p if p % 2 else p + 1))
shadow = outline.filter(ImageFilter.GaussianBlur(p * 0.6)).point(lambda v: int(v * 0.45))
canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
sh = Image.new("RGBA", (w, h), (0, 0, 0, 255))
sh.putalpha(ImageChops.offset(shadow, p // 2, p // 2 + 4))
canvas = Image.alpha_composite(canvas, sh)
white = Image.new("RGBA", (w, h), (255, 255, 255, 255))
white.putalpha(outline)
canvas = Image.alpha_composite(canvas, white)
layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
layer.paste(crop, (2 * p, 2 * p), crop)
canvas = Image.alpha_composite(canvas, layer)
canvas.crop(canvas.getbbox()).save(out)
