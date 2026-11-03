# Two-row comparison sheet for a moment: top row the baseline stills, bottom row the composed stills, one per second.
# Usage: python3.14 scripts/design-brain/sheet.py projects/design-brain/NAME   (writes NAME/compare.jpg)
import glob
import sys
from PIL import Image, ImageDraw

d = sys.argv[1]
rows = [("baseline", sorted(glob.glob(f"{d}/baseline-frames/*.jpg"))), ("composed", sorted(glob.glob(f"{d}/composed-frames/*.jpg")))]
cw = 200
first = Image.open(rows[0][1][0])
ch = round(first.size[1] * cw / first.size[0])
n = max(len(r[1]) for r in rows)
lab = 22
out = Image.new("RGB", (cw * n + 2, (ch + lab) * 2), "white")
draw = ImageDraw.Draw(out)
for ri, (name, files) in enumerate(rows):
    y = ri * (ch + lab)
    draw.text((4, y + 5), name, fill="black")
    for i, f in enumerate(files):
        draw.text((cw * i + 80, y + 5), f"{i + 0.5:.1f} s", fill="gray")
        out.paste(Image.open(f).resize((cw, ch)), (cw * i, y + lab))
out.save(f"{d}/compare.jpg", quality=85)
print(f"{d}/compare.jpg", out.size)
