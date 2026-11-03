# Makes a stand-in for a user's own material: a plain chart exported from a spreadsheet, plus the parts an analysis
# step would find in it (here exact, since we drew it; in the pipeline a vision pass or the chart's data gives them).
# Usage: python3.14 scripts/design-brain/material.py <outDir>
import json, sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
W, H = 1400, 900
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
try:
    f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 30)
    ft = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 40)
except OSError:
    f = ft = ImageFont.load_default()
vals = [38, 42, 40, 37, 44, 41, 39, 43, 96, 118, 124, 121]
x0, y0, x1, y1 = 120, 140, 1340, 800
d.text((x0, 50), "Weekly signups, last 12 weeks", fill="#222", font=ft)
for v in range(0, 141, 20):
    y = y1 - (y1 - y0) * v / 140
    d.line([(x0, y), (x1, y)], fill="#e3e3e3", width=2)
    d.text((x0 - 70, y - 16), str(v), fill="#666", font=f)
bw = (x1 - x0) / len(vals)
boxes = {}
for i, v in enumerate(vals):
    bx0, bx1 = x0 + i * bw + 14, x0 + (i + 1) * bw - 14
    by = y1 - (y1 - y0) * v / 140
    d.rectangle([bx0, by, bx1, y1], fill="#4a7bd0")
    d.text(((bx0 + bx1) / 2 - 10, y1 + 12), str(i + 1), fill="#444", font=f)
    boxes[i + 1] = (bx0, by, bx1, y1)
d.line([(x0, y1), (x1, y1)], fill="#444", width=3)
d.text((x1 - 110, y1 + 50), "week", fill="#666", font=f)
img.save(f"{out}/chart.png")


def fr(b):
    return [round(b[0] / W, 3), round(b[1] / H, 3), round(b[2] / W, 3), round(b[3] / H, 3)]


def span(a, b):
    return (boxes[a][0], min(boxes[k][1] for k in range(a, b + 1)), boxes[b][2], y1)


parts = {
    "title": {"box": fr((x0, 40, 900, 100)), "about": "the chart title"},
    "flat": {"box": fr(span(1, 8)), "about": "weeks 1 to 8, about 40 signups a week"},
    "week9": {"box": fr(boxes[9]), "about": "week 9, the first tall bar, 96 signups"},
    "jump": {"box": fr(span(9, 12)), "about": "weeks 9 to 12, about 120 signups a week"},
}
# What a chart reader returns besides the parts: the numbers behind the bars, read from the data file when the user gave
# one, or digitized from the picture when not, with the plot box so a redrawn chart can start exactly on the original.
data = {"kind": "bars", "title": "Weekly signups, last 12 weeks", "xname": "week", "labels": [str(i + 1) for i in range(len(vals))], "values": vals, "ymax": 140, "plot": fr((x0, y0, x1, y1)), "barFrac": round((bw - 28) / bw, 3)}
material = {"chart": {"file": "chart.png", "size": [W, H], "about": "a bar chart of weekly signups over 12 weeks", "parts": parts, "data": data}}
with open(f"{out}/material.json", "w") as fh:
    json.dump(material, fh, indent=1)
print("ok")
