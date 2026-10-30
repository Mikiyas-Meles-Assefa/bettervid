# Writes a 1080x1920 film-grain overlay (RGBA PNG) used by the video's grain layer.
# Usage: python3 -I make_grain.py <out.png>
import random
import sys
from PIL import Image

random.seed(1)
# Full resolution: coarser noise survives compression as visible specks.
noise = Image.effect_noise((1080, 1920), 40).convert("L")
grain = Image.new("RGBA", (1080, 1920), (128, 128, 128, 0))
grain.putalpha(noise.point(lambda v: int(abs(v - 128) * 0.6)))
grain.save(sys.argv[1])
