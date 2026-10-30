# Crops a drawing to its ink, so a picture on the board fills its space instead of floating in white margins.
# Usage: python3 -I trim_white.py <in.jpg> <out.jpg>
import sys
from PIL import Image, ImageChops

img = Image.open(sys.argv[1]).convert("RGB")
ink = ImageChops.difference(img, Image.new("RGB", img.size, (255, 255, 255))).convert("L").point(lambda v: 255 if v > 40 else 0)
box = ink.getbbox() or (0, 0, *img.size)
pad = 20
img.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(img.width, box[2] + pad), min(img.height, box[3] + pad))).save(sys.argv[2], quality=92)
